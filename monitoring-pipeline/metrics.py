"""Métricas Prometheus del monitoring-pipeline (derivadas de los logs que consume de logs_queue).

Cardinalidad: `event` y `service` vienen de los logs. Para que un productor con errores no
genere series sin límite, solo se aceptan los primeros MAX_SERIES pares (service, event)
distintos; el resto se cuenta como event="otro".
"""
import threading

from observability import BUCKETS_LENTOS, counter, gauge, histogram

LOG_EVENTS = counter("log_events_total", "Eventos de log recibidos", ("service", "level", "event"))
PROCESSED = counter("pipeline_logs_processed_total", "Mensajes de logs_queue tratados", ("result",))
LAG = histogram("pipeline_lag_seconds", "Atraso entre el ts del log y su procesamiento en el pipeline",
                buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 300))
LAG_LAST = gauge("pipeline_lag_last_seconds", "Atraso del último log procesado")
CLIP_FAILURES = counter("pipeline_clip_failures_total", "clip_failed por servicio y etapa (desde logs)",
                        ("service", "stage"))
DEAD_LETTERED = counter("pipeline_dead_lettered_total", "clip_dead_lettered (desde logs)")
DURATION_MS = histogram("pipeline_clip_duration_seconds", "duration_ms de clip_processed (desde logs)",
                        buckets=BUCKETS_LENTOS)
CONSUMER_UP = gauge("pipeline_consumer_up", "1 si el pipeline está consumiendo logs_queue")
LOKI_PUSH = counter("pipeline_loki_push_total", "Envíos a Loki por resultado", ("result",))
LOKI_BUFFER = gauge("pipeline_loki_buffer_size", "Logs esperando para enviarse a Loki")
LOKI_DROPPED = counter("pipeline_loki_dropped_total", "Logs descartados del buffer de Loki (Loki caído mucho tiempo)")
METRICS_DB_WRITES = counter("pipeline_metrics_db_writes_total", "Escrituras de agregados en metrics-db", ("result",))

for _r in ("ok", "invalid"):
    PROCESSED.labels(_r)
for _r in ("ok", "error"):
    LOKI_PUSH.labels(_r)
    METRICS_DB_WRITES.labels(_r)

MAX_SERIES = 400
_vistos = set()
_lock = threading.Lock()


def evento_acotado(service, event):
    with _lock:
        if (service, event) in _vistos:
            return event
        if len(_vistos) < MAX_SERIES:
            _vistos.add((service, event))
            return event
    return "otro"
