"""Logs estructurados: una línea JSON por evento, con el formato acordado por el equipo.

Cada evento va a dos destinos:
1. stdout, siempre y en el momento (12-Factor XI: los logs son un flujo de eventos).
2. logs_queue (RabbitMQ `logs-queue`), de forma ASÍNCRONA, para el monitoring-pipeline.

El envío a logs_queue no puede frenar al servicio: si logs-queue se cae, el procesamiento
de clips tiene que seguir. Por eso log_event solo deja el registro en una cola en memoria
acotada, y un hilo aparte ("log-shipper") la vacía publicando en RabbitMQ.
Si la cola en memoria se llena (caída larga de logs-queue), se descartan los registros
nuevos y se informa cuántos con el evento `logs_dropped`. stdout nunca pierde nada.

Este archivo es idéntico en edge-processor y cv-module (cada uno es una imagen aparte).
"""
import json
import queue
import threading
import time
from datetime import datetime, timezone

import pika
import pika.exceptions

import config

LOG_BUFFER_SIZE = 10000      # registros que se guardan en memoria mientras logs-queue no responde
MAX_ESPERA = 30              # tope de la espera entre reconexiones (segundos)

_cola = queue.Queue(maxsize=LOG_BUFFER_SIZE)
_lock = threading.Lock()
_hilo = None
_descartados = 0             # registros que no entraron en la cola desde el último aviso


def now_iso():
    """Fecha y hora actual en UTC, ISO 8601 con milisegundos y sufijo Z."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def log_event(event, level="INFO", trace_id=None, clip_id=None, duration_ms=None, message="", **extra):
    """Arma el registro con el formato acordado y lo emite."""
    record = {
        "ts": now_iso(),
        "service": config.SERVICE_NAME,
        "level": level,
        "event": event,
        "trace_id": trace_id,
    }
    if clip_id is not None:
        record["clip_id"] = clip_id
    if duration_ms is not None:
        record["duration_ms"] = int(round(duration_ms))
    record["message"] = message
    record.update(extra)
    _emit(record)


def _emit(record: dict):
    """stdout en el momento + encolar para logs_queue (sin bloquear nunca)."""
    global _descartados
    linea = json.dumps(record, ensure_ascii=False, default=str)
    print(linea, flush=True)
    _asegurar_hilo()
    try:
        _cola.put_nowait(linea)
    except queue.Full:
        with _lock:
            _descartados += 1


def _asegurar_hilo():
    """Arranca el hilo que publica en logs_queue la primera vez que se loguea algo."""
    global _hilo
    with _lock:
        if _hilo is None or not _hilo.is_alive():
            _hilo = threading.Thread(target=_shipper, name="log-shipper", daemon=True)
            _hilo.start()


def _aviso_interno(event, message, level="WARNING", **extra):
    """Mensaje del propio log-shipper: solo a stdout (si fuera a la cola, se llamaría a sí mismo)."""
    record = {"ts": now_iso(), "service": config.SERVICE_NAME, "level": level,
              "event": event, "trace_id": None, "message": message}
    record.update(extra)
    print(json.dumps(record, ensure_ascii=False, default=str), flush=True)


def _conectar():
    credenciales = pika.PlainCredentials(config.LOGS_QUEUE_USER, config.LOGS_QUEUE_PASS)
    params = pika.ConnectionParameters(host=config.LOGS_QUEUE_HOST, port=config.LOGS_QUEUE_PORT,
                                       credentials=credenciales, heartbeat=60)
    conexion = pika.BlockingConnection(params)
    canal = conexion.channel()
    # passive=True: solo verifica que exista (la define infrastructure/logs-queue/definitions.json)
    canal.queue_declare(queue=config.LOGS_QUEUE_NAME, passive=True)
    return conexion, canal


def _cerrar(conexion):
    try:
        if conexion is not None and conexion.is_open:
            conexion.close()
    except Exception:
        pass


def _shipper():
    """Hilo que vacía la cola en memoria y publica cada registro en logs_queue.

    Si la publicación falla, conserva el registro pendiente y reconecta con espera creciente
    (1, 2, 4... hasta 30 s), así no se pierde el registro que se estaba enviando.
    """
    global _descartados
    conexion, canal = None, None
    pendiente = None
    espera = 1
    propiedades = pika.BasicProperties(delivery_mode=2, content_type="application/json")
    while True:
        try:
            if pendiente is None:
                try:
                    pendiente = _cola.get(timeout=5)
                except queue.Empty:
                    # Sin logs para mandar: atender el heartbeat para que el broker no corte la conexión
                    if conexion is not None and conexion.is_open:
                        conexion.process_data_events(time_limit=0)
                    continue

            if conexion is None or conexion.is_closed:
                conexion, canal = _conectar()

            canal.basic_publish(exchange="", routing_key=config.LOGS_QUEUE_NAME,
                                body=pendiente.encode("utf-8"), properties=propiedades)
            pendiente = None
            espera = 1

            # Si en algún momento se descartaron registros, avisarlo (también a logs_queue)
            with _lock:
                perdidos, _descartados = _descartados, 0
            if perdidos:
                log_event("logs_dropped", level="WARNING",
                          message=f"Se descartaron {perdidos} registros: la cola de logs en memoria estaba llena",
                          dropped=perdidos)
        except (pika.exceptions.AMQPError, OSError) as e:
            _aviso_interno("log_shipper_retry",
                           f"No se pudo publicar en {config.LOGS_QUEUE_NAME}: {e!r}. Reintento en {espera} s",
                           pending_in_memory=_cola.qsize())
            _cerrar(conexion)
            conexion, canal = None, None
            time.sleep(espera)
            espera = min(espera * 2, MAX_ESPERA)


def flush(timeout=3.0):
    """Al apagar: espera un poco a que se publiquen los logs pendientes (worker_stopped, etc.)."""
    fin = time.monotonic() + timeout
    while not _cola.empty() and time.monotonic() < fin:
        time.sleep(0.1)
