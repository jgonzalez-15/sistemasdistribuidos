"""Logs propios del monitoring-pipeline: una línea JSON por evento, SOLO a stdout.

A diferencia de los demás servicios, el pipeline NO publica sus logs en logs_queue: si lo
hiciera, consumiría sus propios logs y cada aviso (por ejemplo "Loki no responde") generaría
más mensajes en un bucle. Mismo formato que logs.py (ts, service, level, event, trace_id, message).
"""
import json
from datetime import datetime, timezone

import config


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def log(event, level="INFO", message="", **extra):
    record = {"ts": now_iso(), "service": config.SERVICE_NAME, "level": level, "event": event,
              "trace_id": None, "message": message}
    record.update(extra)
    print(json.dumps(record, ensure_ascii=False, default=str), flush=True)
