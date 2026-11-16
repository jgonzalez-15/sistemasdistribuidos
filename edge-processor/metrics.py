"""Métricas Prometheus propias del edge-processor (se exponen en GET /metrics).

Nombres: prefijo edge_, snake_case y unidad en el nombre (_total, _seconds, _bytes).
Labels permitidos: camera_id e intersection_id (cardinalidad acotada por la cantidad de cámaras).
"""
import threading

from observability import BUCKETS_RAPIDOS, counter, gauge, histogram

CLIPS_PUBLISHED = counter("edge_clips_published_total",
                          "Clips subidos a MinIO y publicados (confirmados por el broker)",
                          ("camera_id", "intersection_id"))
PUBLISH_RETRIES = counter("edge_publish_retries_total",
                          "Reintentos de publicación en camera_processing_queue")
PUBLISH_FAILURES = counter("edge_publish_failures_total",
                           "Clips perdidos en el edge, por etapa (upload|publish|process)", ("stage",))
FRAMES_DISCARDED = counter("edge_frames_discarded_total",
                           "Frames descartados por no tener cambios (preprocesamiento)")
ROUND_DURATION = histogram("edge_round_duration_seconds",
                           "Duración de una ronda de un hilo del edge (todas sus cámaras)",
                           buckets=(0.05, 0.1, 0.25, 0.5, 1, 2, 3, 4, 5, 7.5, 10, 20))
CLIP_SIZE = histogram("edge_clip_size_bytes", "Tamaño del arreglo de cada clip subido a MinIO",
                      buckets=(25e3, 50e3, 100e3, 150e3, 200e3, 300e3, 400e3, 600e3, 1e6))
CLIP_DURATION = histogram("edge_clip_duration_seconds",
                          "Tiempo de generar, preprocesar, subir y publicar un clip",
                          buckets=BUCKETS_RAPIDOS)
LAST_CLIP_TS = gauge("edge_last_clip_timestamp_seconds",
                     "Momento (epoch) del último clip publicado por cámara: heartbeat",
                     ("camera_id",))
CAMERAS = gauge("edge_cameras", "Cámaras que simula esta instancia del edge")

# edge_lagging: 1 si algún hilo de esta instancia (zona) tardó más que FRAME_INTERVAL en su última ronda.
_atrasos = {}
_lock = threading.Lock()
LAGGING = gauge("edge_lagging", "1 si la última ronda de algún hilo de esta zona superó el intervalo")


def _lagging_actual():
    with _lock:
        return max(_atrasos.values(), default=0)


LAGGING.set_function(_lagging_actual)


def set_lagging(hilo, atrasado):
    with _lock:
        _atrasos[hilo] = 1 if atrasado else 0

# Series en 0 desde el arranque (si nacen en 1, increase()/rate() no ven el primer fallo).
for _s in ("upload", "publish", "process"):
    PUBLISH_FAILURES.labels(_s)
