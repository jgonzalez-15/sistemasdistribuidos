"""Agregados por minuto en la Metrics DB (PostgreSQL `metrics-db`), calculados desde los logs.

Tablas (se crean al iniciar, idempotente, como hacen auth-service y visualization-backend):
- metrics_minute: por minuto (según el `ts` del log), clips publicados/procesados/duplicados/
  fallidos/dead-lettered, p95 y promedio de duration_ms de clip_processed, logs y errores.
- metrics_failures_minute: fallos por minuto, servicio y etapa (clip_failed.stage).

Para qué, si ya está Prometheus (O18): histórico consultable por SQL más allá de la retención
de 3 días de Prometheus, y sin depender del perfil de observabilidad (el pipeline y metrics-db
son parte del sistema base, como en la arquitectura original).

Tolerancia a fallos: los minutos se escriben cuando ya cerraron (+ un margen para logs atrasados).
Si la base no responde, quedan en memoria (como mucho MAX_MINUTOS_PENDIENTES) y se reintenta;
el consumo de logs_queue nunca espera a la base. Un log que llega tarde a un minuto ya escrito
se suma con un UPSERT (los contadores quedan exactos; el p95 de ese minuto queda como el máximo
de los lotes, una aproximación conservadora).
"""
import math
import threading
import time
from datetime import datetime, timezone

import psycopg2

import config
import metrics
from stdout_log import log

MARGEN_S = 30                 # se espera este margen después de que cierra el minuto
MAX_MINUTOS_PENDIENTES = 180  # si la base está caída 3 h, se descartan los minutos más viejos

ESQUEMA = """
CREATE TABLE IF NOT EXISTS metrics_minute (
    minute               TIMESTAMPTZ PRIMARY KEY,
    clips_published      INTEGER NOT NULL DEFAULT 0,
    clips_processed      INTEGER NOT NULL DEFAULT 0,
    clips_duplicate      INTEGER NOT NULL DEFAULT 0,
    clips_failed         INTEGER NOT NULL DEFAULT 0,
    clips_dead_lettered  INTEGER NOT NULL DEFAULT 0,
    duration_p95_ms      INTEGER,
    duration_avg_ms      INTEGER,
    logs_total           INTEGER NOT NULL DEFAULT 0,
    logs_error           INTEGER NOT NULL DEFAULT 0,
    logs_dropped         INTEGER NOT NULL DEFAULT 0,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS metrics_failures_minute (
    minute   TIMESTAMPTZ NOT NULL,
    service  TEXT        NOT NULL,
    stage    TEXT        NOT NULL,
    count    INTEGER     NOT NULL DEFAULT 0,
    PRIMARY KEY (minute, service, stage)
);
"""

UPSERT = """
INSERT INTO metrics_minute (minute, clips_published, clips_processed, clips_duplicate, clips_failed,
    clips_dead_lettered, duration_p95_ms, duration_avg_ms, logs_total, logs_error, logs_dropped, updated_at)
VALUES (%(minute)s, %(published)s, %(processed)s, %(duplicate)s, %(failed)s, %(dead_lettered)s,
    %(p95)s, %(avg)s, %(logs)s, %(errors)s, %(dropped)s, now())
ON CONFLICT (minute) DO UPDATE SET
    clips_published     = metrics_minute.clips_published + EXCLUDED.clips_published,
    clips_processed     = metrics_minute.clips_processed + EXCLUDED.clips_processed,
    clips_duplicate     = metrics_minute.clips_duplicate + EXCLUDED.clips_duplicate,
    clips_failed        = metrics_minute.clips_failed + EXCLUDED.clips_failed,
    clips_dead_lettered = metrics_minute.clips_dead_lettered + EXCLUDED.clips_dead_lettered,
    duration_p95_ms     = GREATEST(metrics_minute.duration_p95_ms, EXCLUDED.duration_p95_ms),
    duration_avg_ms     = COALESCE(EXCLUDED.duration_avg_ms, metrics_minute.duration_avg_ms),
    logs_total          = metrics_minute.logs_total + EXCLUDED.logs_total,
    logs_error          = metrics_minute.logs_error + EXCLUDED.logs_error,
    logs_dropped        = metrics_minute.logs_dropped + EXCLUDED.logs_dropped,
    updated_at          = now()
"""

UPSERT_FALLOS = """
INSERT INTO metrics_failures_minute (minute, service, stage, count) VALUES (%s, %s, %s, %s)
ON CONFLICT (minute, service, stage) DO UPDATE SET count = metrics_failures_minute.count + EXCLUDED.count
"""


def _nuevo_minuto():
    return {"published": 0, "processed": 0, "duplicate": 0, "failed": 0, "dead_lettered": 0,
            "logs": 0, "errors": 0, "dropped": 0, "duraciones": [], "fallos": {}}


_minutos = {}
_lock = threading.Lock()
_esquema_ok = False


def _minuto_de(ts):
    return ts.replace(second=0, microsecond=0)


def registrar(record, ts):
    """Suma un log al minuto que le corresponde. Solo memoria: nunca bloquea al consumidor."""
    servicio, evento = record.get("service"), record.get("event")
    with _lock:
        m = _minutos.setdefault(_minuto_de(ts), _nuevo_minuto())
        m["logs"] += 1
        if record.get("level") == "ERROR":
            m["errors"] += 1
        if evento == "clip_published":
            m["published"] += 1
        elif evento == "clip_processed":
            if record.get("duplicate"):
                m["duplicate"] += 1
            else:
                m["processed"] += 1
                if isinstance(record.get("duration_ms"), (int, float)):
                    m["duraciones"].append(record["duration_ms"])
        elif evento == "clip_failed":
            m["failed"] += 1
            clave = (str(servicio), str(record.get("stage") or "desconocida"))
            m["fallos"][clave] = m["fallos"].get(clave, 0) + 1
        elif evento == "clip_dead_lettered":
            m["dead_lettered"] += 1
        elif evento == "logs_dropped":
            m["dropped"] += int(record.get("dropped") or 0)


def _p95(valores):
    if not valores:
        return None
    ordenados = sorted(valores)
    return int(ordenados[max(0, math.ceil(0.95 * len(ordenados)) - 1)])


def _conectar():
    return psycopg2.connect(host=config.METRICS_DB_HOST, port=config.METRICS_DB_PORT, dbname=config.METRICS_DB_NAME,
                            user=config.METRICS_DB_USER, password=config.METRICS_DB_PASS, connect_timeout=3)


def _escribir(listos):
    global _esquema_ok
    conn = _conectar()
    try:
        with conn, conn.cursor() as cur:
            if not _esquema_ok:
                cur.execute(ESQUEMA)
                _esquema_ok = True
            for minuto, m in listos:
                d = m["duraciones"]
                cur.execute(UPSERT, {"minute": minuto, "published": m["published"], "processed": m["processed"],
                                     "duplicate": m["duplicate"], "failed": m["failed"],
                                     "dead_lettered": m["dead_lettered"], "p95": _p95(d),
                                     "avg": int(sum(d) / len(d)) if d else None, "logs": m["logs"],
                                     "errors": m["errors"], "dropped": m["dropped"]})
                for (servicio, etapa), n in m["fallos"].items():
                    cur.execute(UPSERT_FALLOS, (minuto, servicio, etapa, n))
    finally:
        conn.close()


def _volcar():
    """Escribe los minutos cerrados. Si la base falla, los devuelve a memoria para reintentar."""
    limite = datetime.fromtimestamp(time.time() - 60 - MARGEN_S, timezone.utc)
    with _lock:
        listos = sorted((k, v) for k, v in _minutos.items() if k <= _minuto_de(limite))
        for k, _ in listos:
            del _minutos[k]
    if not listos:
        return True
    try:
        _escribir(listos)
        metrics.METRICS_DB_WRITES.labels("ok").inc()
        return True
    except Exception as e:
        metrics.METRICS_DB_WRITES.labels("error").inc()
        with _lock:
            for k, v in listos:          # devolver para reintentar (se suman si llegaron más logs)
                actual = _minutos.setdefault(k, _nuevo_minuto())
                for campo in ("published", "processed", "duplicate", "failed", "dead_lettered", "logs",
                              "errors", "dropped"):
                    actual[campo] += v[campo]
                actual["duraciones"].extend(v["duraciones"])
                for clave, n in v["fallos"].items():
                    actual["fallos"][clave] = actual["fallos"].get(clave, 0) + n
            while len(_minutos) > MAX_MINUTOS_PENDIENTES:
                del _minutos[min(_minutos)]
        log("metrics_db_unavailable", "WARNING", error=repr(e)[:200], pending_minutes=len(_minutos),
            message="No se pudo escribir en metrics-db; se reintenta en el próximo ciclo")
        return False


def _bucle(parar):
    while not parar.wait(config.METRICS_DB_FLUSH_S):
        _volcar()
    _volcar()


def iniciar(parar):
    if not config.METRICS_DB_HOST:
        log("metrics_db_disabled", message="METRICS_DB_HOST vacío: no se guardan agregados por minuto")
        return
    threading.Thread(target=_bucle, args=(parar,), name="metrics-db-writer", daemon=True).start()
