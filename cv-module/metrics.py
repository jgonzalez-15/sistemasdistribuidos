"""Métricas Prometheus propias del cv-module (cada réplica expone las suyas en GET /metrics).

Prometheus descubre todas las réplicas por DNS (dns_sd_configs sobre `cv-module`), así que el
label `instance` distingue réplicas. worker_info{processed_by} relaciona esa instancia con el
hostname que se guarda en results.processed_by.

Semántica de worker_clips_total{result}:
- ok: guardado por primera vez. duplicate: ya estaba (ON CONFLICT DO NOTHING).
- failed: falló en alguna etapa. dead_lettered: además se confirmó el nack hacia camera_dlq
  (es un subconjunto de failed; ok + duplicate + failed = mensajes tratados).
"""
from observability import BUCKETS_LENTOS, BUCKETS_RAPIDOS, counter, gauge, histogram

CLIPS = counter("worker_clips_total", "Clips tratados por resultado", ("result",))
FAILURES = counter("worker_failures_total", "Clips fallidos por etapa (parse|download|detect|db)", ("stage",))
REDELIVERED = counter("worker_redelivered_total", "Mensajes recibidos con redelivered=true")
STAGE_DURATION = histogram("worker_stage_duration_seconds", "Duración de cada etapa del procesamiento",
                           ("stage",), buckets=BUCKETS_RAPIDOS)
END_TO_END = histogram("worker_end_to_end_latency_seconds",
                       "Desde la captura en el edge (timestamp del mensaje) hasta guardado en la base",
                       buckets=BUCKETS_LENTOS)
VEHICLES = histogram("worker_vehicles_counted", "Vehículos contados por clip",
                     buckets=(0, 5, 10, 20, 30, 40, 50, 60, 75, 100, 150))
BROKER_RECONNECTS = counter("worker_broker_reconnects_total", "Reconexiones al broker camera-queue")
CONSUMER_UP = gauge("worker_consumer_up", "1 si la réplica está consumiendo de la cola")
INFO = gauge("worker_info", "Identidad de la réplica (valor siempre 1)", ("processed_by",))

# Series en 0 desde el arranque: si un contador "nace" en 1 (primer fallo), Prometheus no ve el
# salto 0→1 y increase()/rate() no lo cuentan (falso negativo en las alertas de DLQ).
for _r in ("ok", "duplicate", "failed", "dead_lettered"):
    CLIPS.labels(_r)
for _s in ("parse", "download", "detect", "db"):
    FAILURES.labels(_s)
