"""Structured JSON logging for auth-service, matching the team's logs_queue standard.

Copia de api-rest/logs.py (mismo contrato y mismo log-shipper asíncrono; decisión O19).

Each event goes to two destinations:
1. stdout, immediately (12-Factor XI).
2. logs_queue (RabbitMQ `logs-queue`), asynchronously via a background `log-shipper` thread,
   so a RabbitMQ outage never blocks API requests.
"""
import json
import queue
import threading
import time
from datetime import datetime, timezone

import pika
import pika.exceptions

import config

LOG_BUFFER_SIZE = 10000
MAX_WAIT_SECONDS = 30

_queue = queue.Queue(maxsize=LOG_BUFFER_SIZE)
_lock = threading.Lock()
_thread = None
_dropped = 0


def now_iso() -> str:
    """Current UTC timestamp in ISO 8601 format with milliseconds and Z suffix."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def log_event(
    event: str,
    level: str = "INFO",
    trace_id: str | None = None,
    session_id: str | None = None,
    duration_ms: float | None = None,
    message: str = "",
    **extra,
):
    """Build a structured JSON log record and emit it to stdout and logs_queue."""
    effective_trace_id = trace_id if trace_id is not None else session_id
    record = {
        "ts": now_iso(),
        "service": config.SERVICE_NAME,
        "level": level,
        "event": event,
        "trace_id": effective_trace_id,
    }
    if session_id is not None:
        record["session_id"] = session_id
    if duration_ms is not None:
        record["duration_ms"] = int(round(duration_ms))
    record["message"] = message
    record.update(extra)
    _emit(record)


def _emit(record: dict):
    global _dropped
    line = json.dumps(record, ensure_ascii=False, default=str)
    print(line, flush=True)
    _ensure_thread()
    try:
        _queue.put_nowait(line)
    except queue.Full:
        with _lock:
            _dropped += 1


def _ensure_thread():
    global _thread
    with _lock:
        if _thread is None or not _thread.is_alive():
            _thread = threading.Thread(target=_shipper, name="log-shipper", daemon=True)
            _thread.start()


def _internal_warning(event: str, message: str, level: str = "WARNING", **extra):
    record = {
        "ts": now_iso(),
        "service": config.SERVICE_NAME,
        "level": level,
        "event": event,
        "trace_id": None,
        "message": message,
    }
    record.update(extra)
    print(json.dumps(record, ensure_ascii=False, default=str), flush=True)


def _connect():
    credentials = pika.PlainCredentials(config.LOGS_QUEUE_USER, config.LOGS_QUEUE_PASS)
    params = pika.ConnectionParameters(
        host=config.LOGS_QUEUE_HOST,
        port=config.LOGS_QUEUE_PORT,
        credentials=credentials,
        heartbeat=60,
    )
    connection = pika.BlockingConnection(params)
    channel = connection.channel()
    channel.queue_declare(queue=config.LOGS_QUEUE_NAME, passive=True)
    return connection, channel


def _close(connection):
    try:
        if connection is not None and connection.is_open:
            connection.close()
    except Exception:
        pass


def _shipper():
    """Background thread that drains the in-memory queue and publishes to logs_queue."""
    global _dropped
    connection, channel = None, None
    pending = None
    wait_seconds = 1
    properties = pika.BasicProperties(delivery_mode=2, content_type="application/json")

    while True:
        try:
            if pending is None:
                try:
                    pending = _queue.get(timeout=5)
                except queue.Empty:
                    if connection is not None and connection.is_open:
                        connection.process_data_events(time_limit=0)
                    continue

            if connection is None or connection.is_closed:
                connection, channel = _connect()

            channel.basic_publish(
                exchange="",
                routing_key=config.LOGS_QUEUE_NAME,
                body=pending.encode("utf-8"),
                properties=properties,
            )
            pending = None
            wait_seconds = 1

            with _lock:
                lost, _dropped = _dropped, 0
            if lost:
                log_event(
                    "logs_dropped",
                    level="WARNING",
                    message=f"Dropped {lost} log records because the in-memory buffer was full",
                    dropped=lost,
                )
        except (pika.exceptions.AMQPError, OSError) as e:
            _internal_warning(
                "log_shipper_retry",
                f"Failed to publish to {config.LOGS_QUEUE_NAME}: {e!r}. Retrying in {wait_seconds}s",
                pending_in_memory=_queue.qsize(),
            )
            _close(connection)
            connection, channel = None, None
            time.sleep(wait_seconds)
            wait_seconds = min(wait_seconds * 2, MAX_WAIT_SECONDS)


def flush(timeout: float = 3.0):
    """Wait briefly on shutdown for pending logs to be published."""
    deadline = time.monotonic() + timeout
    while not _queue.empty() and time.monotonic() < deadline:
        time.sleep(0.1)
