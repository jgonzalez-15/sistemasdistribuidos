"""Consumidor de logs_queue: valida, limpia y enriquece cada log; deriva métricas; lo manda a Loki
y a los agregados por minuto. Mismo estilo que el worker de cv-module (ACK manual, reconexión con
espera creciente, apagado ordenado con add_callback_threadsafe).

ACK SIEMPRE después de procesar en memoria (O17): ni Loki ni metrics-db pueden trabar la cola.
Un mensaje inválido también se confirma (se cuenta como `invalid` y se manda a Loki marcado),
porque reencolarlo lo haría dar vueltas para siempre (mismo criterio que D12).
"""
import json
import re
import threading
import uuid
from datetime import datetime, timezone

import pika
import pika.exceptions

import agregador
import config
import loki
import metrics
from stdout_log import log

ESPERA_MAXIMA_S = 30
CLAVES_SENSIBLES = re.compile(r"pass(word)?|token|secret|authorization|cookie", re.IGNORECASE)
NIVELES = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
_SEGURO = re.compile(r"[^a-zA-Z0-9_.:-]")


def _ts(record):
    try:
        ts = datetime.fromisoformat(str(record.get("ts")))
        return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _limpiar(valor, profundidad=0):
    """Enmascara claves sensibles (defensa en profundidad: hoy ningún servicio las loguea)."""
    if isinstance(valor, dict) and profundidad < 4:
        return {k: ("***" if CLAVES_SENSIBLES.search(str(k)) else _limpiar(v, profundidad + 1))
                for k, v in valor.items()}
    return valor


def _label(valor, defecto):
    texto = _SEGURO.sub("_", str(valor or defecto))[:64]
    return texto or defecto


def procesar(body: bytes):
    """Trata un mensaje. Devuelve el registro enriquecido (para tests); nunca lanza."""
    ahora = datetime.now(timezone.utc)
    try:
        record = json.loads(body)
        if not isinstance(record, dict) or not record.get("service") or not record.get("event"):
            raise ValueError("no es un objeto JSON con service y event")
        valido = True
    except (ValueError, UnicodeDecodeError) as e:
        record = {"ts": ahora.isoformat(), "service": "desconocido", "level": "WARNING", "event": "log_invalido",
                  "message": f"Mensaje inválido en {config.LOGS_QUEUE_NAME}: {e}", "raw": body[:500].decode("utf-8", "replace")}
        valido = False

    record = _limpiar(record)
    nivel = str(record.get("level") or "INFO").upper()
    record["level"] = nivel if nivel in NIVELES else "INFO"
    ts = _ts(record) or ahora

    # Enriquecimiento: trace_hex = trace_id sin guiones cuando es un UUID (clip_id). Es el formato
    # de un trace id de OpenTelemetry/Jaeger: lo usa el "derived field" de Grafana (log → traza).
    trace_id = record.get("trace_id")
    if record.get("otel_trace_id"):
        record["trace_hex"] = record["otel_trace_id"]
    elif trace_id:
        try:
            record["trace_hex"] = uuid.UUID(str(trace_id)).hex
        except ValueError:
            pass
    record["pipeline_received_at"] = ahora.isoformat(timespec="milliseconds").replace("+00:00", "Z")

    servicio = _label(record.get("service"), "desconocido")
    evento = metrics.evento_acotado(servicio, _label(record.get("event"), "sin_evento"))
    metrics.LOG_EVENTS.labels(servicio, record["level"], evento).inc()
    metrics.PROCESSED.labels("ok" if valido else "invalid").inc()
    atraso = max(0.0, (ahora - ts).total_seconds())
    metrics.LAG.observe(atraso)
    metrics.LAG_LAST.set(atraso)
    if record.get("event") == "clip_failed":
        metrics.CLIP_FAILURES.labels(servicio, _label(record.get("stage"), "desconocida")).inc()
    elif record.get("event") == "clip_dead_lettered":
        metrics.DEAD_LETTERED.inc()
    elif record.get("event") == "clip_processed" and isinstance(record.get("duration_ms"), (int, float)):
        metrics.DURATION_MS.observe(record["duration_ms"] / 1000)

    agregador.registrar(record, ts)
    loki.encolar({"service": servicio, "level": record["level"], "event": evento},
                 int(ts.timestamp() * 1e9), loki.a_linea(record))
    return record


class Consumer(threading.Thread):
    def __init__(self):
        super().__init__(name="logs-consumer", daemon=True)
        self.consuming = False
        self._parar = threading.Event()
        self._conexion = None
        self._canal = None
        metrics.CONSUMER_UP.set_function(lambda: 1 if self.consuming else 0)

    def _conectar(self):
        credenciales = pika.PlainCredentials(config.LOGS_QUEUE_USER, config.LOGS_QUEUE_PASS)
        self._conexion = pika.BlockingConnection(pika.ConnectionParameters(
            host=config.LOGS_QUEUE_HOST, port=config.LOGS_QUEUE_PORT, credentials=credenciales, heartbeat=60))
        self._canal = self._conexion.channel()
        self._canal.basic_qos(prefetch_count=config.PIPELINE_PREFETCH)
        # passive=True: la cola (y su policy de límites) la define infrastructure/logs-queue/definitions.json
        self._canal.queue_declare(queue=config.LOGS_QUEUE_NAME, passive=True)
        self._canal.basic_consume(queue=config.LOGS_QUEUE_NAME, on_message_callback=self._on_message, auto_ack=False)

    def _on_message(self, ch, method, properties, body):
        try:
            procesar(body)
        except Exception as e:  # nunca debería pasar: procesar() no lanza; igual se confirma
            log("log_processing_error", "ERROR", error=repr(e)[:200])
        ch.basic_ack(delivery_tag=method.delivery_tag)

    def _cerrar(self):
        try:
            if self._conexion is not None and self._conexion.is_open:
                self._conexion.close()
        except Exception:
            pass
        self._conexion, self._canal = None, None

    def run(self):
        espera = 1
        while not self._parar.is_set():
            try:
                self._conectar()
                if self._parar.is_set():
                    break
                espera = 1
                self.consuming = True
                log("pipeline_started", queue=config.LOGS_QUEUE_NAME,
                    message=f"consumiendo {config.LOGS_QUEUE_NAME} (Loki: {config.LOKI_URL or 'apagado'})")
                self._canal.start_consuming()
            except (pika.exceptions.AMQPError, OSError) as e:
                if not self._parar.is_set():
                    log("pipeline_reconnecting", "WARNING", error=repr(e)[:200], retry_in_s=espera,
                        message=f"sin conexión con {config.LOGS_QUEUE_HOST}, reintento en {espera} s")
            finally:
                self.consuming = False
                self._cerrar()
            if self._parar.is_set():
                break
            self._parar.wait(espera)
            espera = min(espera * 2, ESPERA_MAXIMA_S)
        log("pipeline_stopped", message="consumidor de logs detenido")

    def stop(self):
        self._parar.set()
        conexion, canal = self._conexion, self._canal
        if conexion is not None and conexion.is_open and canal is not None:
            try:
                conexion.add_callback_threadsafe(canal.stop_consuming)
            except Exception:
                pass

