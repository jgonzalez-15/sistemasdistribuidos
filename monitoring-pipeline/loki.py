"""Envío de logs a Loki (HTTP push API), en lotes y desde un hilo aparte. Best-effort.

Decisión O17: el consumidor de logs_queue hace ACK siempre, sin esperar a Loki. Los registros
quedan en un buffer en memoria ACOTADO (LOKI_BUFFER_MAX). Si Loki no responde, el hilo
reintenta con espera creciente (1, 2, 4… hasta 30 s); si el buffer se llena, se descartan los
más viejos (pipeline_loki_dropped_total). Así una caída de Loki (o el perfil de observabilidad
apagado) nunca traba logs_queue ni a los servicios. stdout de cada servicio conserva todo.

Labels de Loki (baja cardinalidad): service, level, event. Todo lo demás queda en la línea JSON
y se consulta con `| json` (trace_id, clip_id, camera_id…).
"""
import json
import threading
import time
from collections import deque

import httpx

import config
import metrics
from stdout_log import log

_buffer = deque()
_lock = threading.Lock()
_hilo = None


def habilitado():
    return bool(config.LOKI_URL)


def encolar(labels, ts_ns, linea):
    """Agrega un registro al buffer (O(1), nunca bloquea). Descarta el más viejo si está lleno."""
    if not habilitado():
        return
    with _lock:
        if len(_buffer) >= config.LOKI_BUFFER_MAX:
            _buffer.popleft()
            metrics.LOKI_DROPPED.inc()
        _buffer.append((labels, ts_ns, linea))
        metrics.LOKI_BUFFER.set(len(_buffer))


def _armar_payload(lote):
    streams = {}
    for labels, ts_ns, linea in lote:
        clave = tuple(sorted(labels.items()))
        streams.setdefault(clave, []).append([str(ts_ns), linea])
    return {"streams": [{"stream": dict(clave), "values": sorted(vals)} for clave, vals in streams.items()]}


def _enviar_lote(cliente):
    with _lock:
        lote = [_buffer[i] for i in range(min(config.LOKI_BATCH_SIZE, len(_buffer)))]
    if not lote:
        return True
    respuesta = cliente.post(f"{config.LOKI_URL.rstrip('/')}/loki/api/v1/push", json=_armar_payload(lote))
    if respuesta.status_code >= 300:
        # 4xx con datos inválidos (p. ej. demasiado viejos): se descartan para no trabar el resto
        if 400 <= respuesta.status_code < 500 and respuesta.status_code != 429:
            log("loki_push_rejected", "WARNING", status=respuesta.status_code, body=respuesta.text[:300],
                dropped=len(lote))
            metrics.LOKI_DROPPED.inc(len(lote))
        else:
            raise httpx.HTTPStatusError(f"Loki respondió {respuesta.status_code}", request=respuesta.request,
                                        response=respuesta)
    with _lock:
        for _ in range(len(lote)):
            if _buffer:
                _buffer.popleft()
        metrics.LOKI_BUFFER.set(len(_buffer))
    return True


def _bucle(parar):
    espera = 1
    caido = False
    with httpx.Client(timeout=5.0) as cliente:
        while not parar.is_set():
            if not _buffer:
                parar.wait(config.LOKI_BATCH_WAIT_S)
                continue
            try:
                _enviar_lote(cliente)
                metrics.LOKI_PUSH.labels("ok").inc()
                if caido:
                    log("loki_reachable", message="Loki volvió a responder; se envían los logs pendientes",
                        pending=len(_buffer))
                caido, espera = False, 1
                if len(_buffer) < config.LOKI_BATCH_SIZE:
                    parar.wait(config.LOKI_BATCH_WAIT_S)
            except Exception as e:  # red, DNS (perfil apagado), 5xx: reintentar sin bloquear a nadie
                metrics.LOKI_PUSH.labels("error").inc()
                if not caido:
                    log("loki_unreachable", "WARNING", error=repr(e)[:200], pending=len(_buffer),
                        message="No se pudo enviar a Loki; se reintenta con espera creciente (best-effort)")
                caido = True
                parar.wait(espera)
                espera = min(espera * 2, 30)


def iniciar(parar):
    global _hilo
    if not habilitado():
        log("loki_disabled", message="LOKI_URL vacío: los logs no se envían a Loki")
        return
    _hilo = threading.Thread(target=_bucle, args=(parar,), name="loki-sender", daemon=True)
    _hilo.start()


def flush(timeout=3.0):
    fin = time.monotonic() + timeout
    while _buffer and time.monotonic() < fin:
        time.sleep(0.1)


def a_linea(record):
    return json.dumps(record, ensure_ascii=False, default=str)
