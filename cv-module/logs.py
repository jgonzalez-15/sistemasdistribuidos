"""Logs estructurados del cv-module: una línea JSON por evento (formato acordado, punto 6).

Eventos del worker: worker_started, worker_stopped, clip_processed, clip_failed, clip_dead_lettered.
"""
import json
from datetime import datetime, timezone

import config


def _ahora_iso() -> str:
    """Hora actual en UTC, ISO 8601 con milisegundos y sufijo Z (ej. 2026-11-15T14:03:22.123Z)."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _emit(record: dict) -> None:
    # Hoy el log sale solo por stdout (12-Factor XI: los logs son un flujo de eventos).
    # Punto 7: además publicar en logs_queue
    print(json.dumps(record, ensure_ascii=False, default=str), flush=True)


def log_event(event, level="INFO", trace_id=None, clip_id=None, duration_ms=None, message="", **extra):
    """Arma el registro con las claves acordadas y lo emite."""
    record = {
        "ts": _ahora_iso(),
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
