"""Logs estructurados del edge: una línea JSON por evento."""
import json
from datetime import datetime, timezone

import config


def now_iso():
    """Fecha y hora actual en UTC, ISO 8601 con milisegundos y sufijo Z."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _emit(record: dict):
    """Envía el registro a su destino. Por ahora, solo stdout."""
    print(json.dumps(record, ensure_ascii=False), flush=True)
    # Punto 7: además publicar en logs_queue


def log_event(event, level="INFO", trace_id=None, clip_id=None, duration_ms=None, message="", **extra):
    """Arma el registro con el formato acordado por el equipo y lo emite."""
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
