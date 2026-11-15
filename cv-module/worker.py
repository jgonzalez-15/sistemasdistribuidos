"""Worker del cv-module: consume clips de `camera_processing_queue`, cuenta vehículos y guarda el resultado.

Varias réplicas (`docker compose up --scale cv-module=N`) consumen la misma cola: patrón
competing consumers. RabbitMQ reparte los mensajes entre ellas.

Garantías:
- prefetch_count=1: cada réplica tiene como máximo un mensaje sin confirmar a la vez.
- ACK manual, recién después de guardar en la base: si el worker muere a mitad de un clip,
  el mensaje no confirmado vuelve a la cola y lo procesa otra réplica (at-least-once).
- Idempotencia en la base (ON CONFLICT DO NOTHING): procesar dos veces el mismo clip no duplica.
- Si un mensaje falla, nack sin reencolar → el dead-letter exchange lo manda a `camera_dlq`.
"""
import json
import socket
import threading
import time
import uuid
from datetime import datetime

import numpy as np
import pika
import pika.exceptions

import config
import db
import storage
from detector import Detector, DetectorSimulado
from logs import log_event

ESPERA_MAXIMA_S = 30


class ErrorEnEtapa(Exception):
    """Error durante el procesamiento de un clip, con la etapa en la que ocurrió."""

    def __init__(self, etapa, error):
        super().__init__(f"{etapa}: {error}")
        self.etapa = etapa
        self.error = error


def parse_message(body: bytes) -> dict:
    """Decodifica el mensaje y valida el contrato. Lanza ValueError con un mensaje claro si no cumple."""
    try:
        datos = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise ValueError(f"el mensaje no es JSON válido: {e}")
    if not isinstance(datos, dict):
        raise ValueError("el mensaje debe ser un objeto JSON")

    faltan = [c for c in ("clip_id", "trace_id", "camera_id", "intersection_id",
                          "timestamp", "object_key", "frames", "shape") if c not in datos]
    if faltan:
        raise ValueError(f"faltan campos del contrato: {', '.join(faltan)}")

    try:
        uuid.UUID(str(datos["clip_id"]))
    except ValueError:
        raise ValueError(f"clip_id no es un uuid: {datos['clip_id']!r}")
    for campo in ("trace_id", "camera_id", "intersection_id", "object_key"):
        if not isinstance(datos[campo], str) or not datos[campo]:
            raise ValueError(f"{campo} debe ser un texto no vacío")
    try:
        # Python 3.11 acepta el sufijo Z de UTC.
        datos["ts"] = datetime.fromisoformat(datos["timestamp"])
    except (TypeError, ValueError):
        raise ValueError(f"timestamp no es ISO 8601: {datos['timestamp']!r}")
    if not isinstance(datos["frames"], int) or datos["frames"] <= 0:
        raise ValueError("frames debe ser un entero positivo")
    forma = datos["shape"]
    if not (isinstance(forma, list) and len(forma) == 2 and all(isinstance(x, int) and x > 0 for x in forma)):
        raise ValueError("shape debe ser [alto, ancho] con enteros positivos")
    return datos


def mediana_redondeada(conteos) -> int:
    """Mediana de los conteos por frame, redondeando .5 hacia arriba.

    (round() de Python redondea al par más cercano: round(2.5) == 2; acá queremos 3.)
    """
    return int(np.floor(np.median(conteos) + 0.5))


class Worker(threading.Thread):
    def __init__(self, detector: Detector = None):
        super().__init__(name="cv-worker", daemon=True)
        self.detector = detector or DetectorSimulado(config.DETECTION_THRESHOLD, config.MIN_BLOB_AREA)
        self.processed_by = socket.gethostname()  # en Docker es el id del contenedor: distingue réplicas
        self.consuming = False
        self._parar = threading.Event()
        self._conexion = None
        self._canal = None

    # ---------- Conexión y ciclo de vida ----------

    def _conectar(self):
        credenciales = pika.PlainCredentials(config.CAMERA_QUEUE_USER, config.CAMERA_QUEUE_PASS)
        parametros = pika.ConnectionParameters(
            host=config.CAMERA_QUEUE_HOST,
            port=config.CAMERA_QUEUE_PORT,
            credentials=credenciales,
            heartbeat=60,
        )
        self._conexion = pika.BlockingConnection(parametros)
        self._canal = self._conexion.channel()
        # Como máximo un mensaje sin ACK por réplica: el reparto es justo entre workers.
        self._canal.basic_qos(prefetch_count=1)
        # passive=True: solo verifica que la cola exista. La declaración real (con el
        # dead-letter exchange) está en infrastructure/camera-queue/definitions.json.
        self._canal.queue_declare(queue=config.CAMERA_QUEUE_NAME, passive=True)
        self._canal.basic_consume(
            queue=config.CAMERA_QUEUE_NAME,
            on_message_callback=self._on_message,
            auto_ack=False,
        )

    def _cerrar_conexion(self):
        # Al cerrar la conexión, RabbitMQ devuelve a la cola los mensajes que quedaron sin ACK.
        if self._conexion is not None and self._conexion.is_open:
            try:
                self._conexion.close()
            except Exception:
                pass
        self._conexion = None
        self._canal = None

    def run(self):
        espera = 1
        while not self._parar.is_set():
            try:
                self._conectar()
                if self._parar.is_set():  # pidieron parar mientras conectábamos
                    break
                espera = 1
                self.consuming = True
                log_event("worker_started", processed_by=self.processed_by,
                          queue=config.CAMERA_QUEUE_NAME,
                          message=f"worker {self.processed_by} consumiendo de {config.CAMERA_QUEUE_NAME}")
                self._canal.start_consuming()  # bloquea hasta stop_consuming() o error de conexión
            except (pika.exceptions.AMQPError, OSError) as e:
                # AMQPError incluye AMQPConnectionError, ConnectionClosedByBroker, StreamLostError y
                # errores de canal. OSError cubre fallas de red/DNS (ej. el broker todavía no arrancó).
                if not self._parar.is_set():
                    log_event("worker_reconnecting", level="WARNING", processed_by=self.processed_by,
                              error=repr(e), retry_in_s=espera,
                              message=f"sin conexión con {config.CAMERA_QUEUE_HOST}, reintento en {espera} s")
            finally:
                self.consuming = False
                self._cerrar_conexion()

            if self._parar.is_set():
                break
            # Espera creciente 1, 2, 4... hasta 30 s. wait() se corta antes si llaman a stop().
            self._parar.wait(espera)
            espera = min(espera * 2, ESPERA_MAXIMA_S)

        log_event("worker_stopped", processed_by=self.processed_by,
                  message=f"worker {self.processed_by} detenido")

    def stop(self):
        """Apagado ordenado (12-Factor IX, desechabilidad).

        Se llama desde otro hilo (el de FastAPI). pika no es thread-safe, así que la única forma
        segura de cortar start_consuming() es pedírselo al hilo de la conexión con
        add_callback_threadsafe. El mensaje en curso termina de procesarse; los que queden sin ACK
        vuelven a la cola cuando se cierra la conexión.
        """
        self._parar.set()
        conexion, canal = self._conexion, self._canal
        if conexion is not None and conexion.is_open and canal is not None:
            try:
                conexion.add_callback_threadsafe(canal.stop_consuming)
            except Exception:
                pass  # la conexión se cerró justo ahora: run() ya va a terminar

    # ---------- Procesamiento de un mensaje ----------

    def _on_message(self, ch, method, properties, body):
        t0 = time.monotonic()
        trace_id = None
        clip_id = None
        try:
            # (a) Leer y validar el mensaje.
            try:
                msg = parse_message(body)
            except Exception as e:
                raise ErrorEnEtapa("parse", e)
            clip_id = msg["clip_id"]
            trace_id = msg["trace_id"]

            # (b) Bajar el clip de MinIO (claim check).
            try:
                clip = storage.download_clip(msg["object_key"])
            except Exception as e:
                raise ErrorEnEtapa("download", e)

            # (c) Contar vehículos en cada frame y resumir el clip con la mediana.
            try:
                conteos = [self.detector.contar(frame) for frame in clip]
                vehicle_count = mediana_redondeada(conteos)
            except Exception as e:
                raise ErrorEnEtapa("detect", e)
            if config.PROCESSING_DELAY_MS > 0:
                time.sleep(config.PROCESSING_DELAY_MS / 1000)  # solo para la demo de escalado

            # (d) Guardar el resultado (idempotente).
            try:
                insertado = db.save_result(
                    clip_id=clip_id,
                    camera_id=msg["camera_id"],
                    intersection_id=msg["intersection_id"],
                    ts=msg["ts"],
                    vehicle_count=vehicle_count,
                    frames_processed=len(clip),
                    processed_by=self.processed_by,
                )
            except Exception as e:
                raise ErrorEnEtapa("db", e)

        except ErrorEnEtapa as fallo:
            # Hoy todo fallo va directo a la DLQ. Mejora futura (extra 2): reintentar N veces
            # con un contador en un header antes de mandarlo a la DLQ.
            if trace_id is None:
                trace_id = _trace_id_si_se_puede(body)
            log_event("clip_failed", level="ERROR", trace_id=trace_id, clip_id=clip_id,
                      duration_ms=(time.monotonic() - t0) * 1000,
                      stage=fallo.etapa, error=repr(fallo.error), processed_by=self.processed_by,
                      message=f"falló el clip en la etapa {fallo.etapa}")
            # requeue=False: RabbitMQ lo manda al dead-letter exchange (dlx) → cola camera_dlq.
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
            log_event("clip_dead_lettered", level="WARNING", trace_id=trace_id, clip_id=clip_id,
                      stage=fallo.etapa, processed_by=self.processed_by,
                      message="mensaje enviado a camera_dlq")
            return

        # (e) Recién ahora, con el resultado guardado, se confirma el mensaje.
        ch.basic_ack(delivery_tag=method.delivery_tag)

        # (f) Log del resultado.
        log_event("clip_processed", trace_id=trace_id, clip_id=clip_id,
                  duration_ms=(time.monotonic() - t0) * 1000,
                  vehicle_count=vehicle_count,
                  camera_id=msg["camera_id"], intersection_id=msg["intersection_id"],
                  processed_by=self.processed_by, duplicate=not insertado,
                  message="clip ya procesado antes (duplicado, no se insertó)" if not insertado
                  else f"clip procesado: {vehicle_count} vehículos")


def _trace_id_si_se_puede(body):
    """Para los logs de error: intenta rescatar el trace_id aunque el mensaje no cumpla el contrato."""
    try:
        datos = json.loads(body)
        if isinstance(datos, dict):
            return datos.get("trace_id") or datos.get("clip_id")
    except Exception:
        pass
    return None
