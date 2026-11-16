"""Métricas Prometheus del visualization-backend: técnicas (consultas a results-db) y de NEGOCIO.

Negocio (tránsito), calculadas en el scrape con caché de VIZ_METRICS_CACHE_S (por defecto 10 s)
para no cargar la base: un scrape cada 15 s hace como mucho una tanda de consultas cada 10 s.
Solo se publican series de intersecciones y cámaras REGISTRADAS en las tablas (cardinalidad
acotada; las cámaras de prueba de las demos no generan series).

- traffic_intersection_vehicles{intersection_id}: promedio de vehículos del último minuto
  (misma regla que GET /intersections).
- traffic_intersection_state{intersection_id}: 0 fluida, 1 moderada, 2 congestionada,
  -1 sin datos en el último minuto (umbrales ≥40 / ≥75 de compute_congestion_level).
- traffic_intersection_clips_last_minute{intersection_id}
- traffic_camera_last_result_timestamp_seconds{camera_id,intersection_id}: epoch del último
  resultado guardado de la cámara en la última hora (0 si no hubo). Heartbeat de punta a punta.

Técnica: viz_query_duration_seconds, duración de cada execute() contra results-db.
"""
import os
import threading
import time

import psycopg2
from psycopg2.extras import RealDictCursor

import config
import db
from observability import BUCKETS_RAPIDOS, histogram, register_collector

QUERY_DURATION = histogram("viz_query_duration_seconds", "Duración de las consultas a results-db",
                           buckets=BUCKETS_RAPIDOS)

_ESTADOS = {"fluido": 0, "moderado": 1, "congestionado": 2}


class _CursorMedido(RealDictCursor):
    """RealDictCursor que mide cada execute(). Mismo resultado que el cursor original."""

    def execute(self, query, vars=None):
        t0 = time.perf_counter()
        try:
            return super().execute(query, vars)
        finally:
            try:
                QUERY_DURATION.observe(time.perf_counter() - t0)
            except Exception:
                pass


_get_db_connection_original = db.get_db_connection


def _get_db_connection_medido():
    conn = _get_db_connection_original()
    try:
        conn.cursor_factory = _CursorMedido
    except Exception:
        pass
    return conn


db.get_db_connection = _get_db_connection_medido


class _MetricasNegocio:
    CACHE_S = float(os.getenv("VIZ_METRICS_CACHE_S", "10"))

    def __init__(self, nivel_congestion):
        self._nivel = nivel_congestion
        self._lock = threading.Lock()
        self._cache = None
        self._cuando = 0.0

    def _consultar(self):
        conn = psycopg2.connect(host=config.RESULTS_DB_HOST, port=config.RESULTS_DB_PORT,
                                dbname=config.RESULTS_DB_NAME, user=config.RESULTS_DB_USER,
                                password=config.RESULTS_DB_PASS, connect_timeout=2)
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT i.id, r.promedio, COALESCE(r.clips, 0)
                    FROM intersections i
                    LEFT JOIN (
                        SELECT intersection_id, ROUND(AVG(vehicle_count), 1) AS promedio, COUNT(*) AS clips
                        FROM results WHERE ts > now() - interval '1 minute'
                        GROUP BY intersection_id
                    ) r ON r.intersection_id = i.id
                """)
                intersecciones = cur.fetchall()
                cur.execute("""
                    SELECT c.id, c.intersection_id,
                           COALESCE((SELECT extract(epoch FROM max(r.ts)) FROM results r
                                     WHERE r.intersection_id = c.intersection_id AND r.camera_id = c.id
                                       AND r.ts > now() - interval '1 hour'), 0)
                    FROM cameras c
                """)
                camaras = cur.fetchall()
            return intersecciones, camaras
        finally:
            conn.close()

    def collect(self):
        from prometheus_client.core import GaugeMetricFamily
        with self._lock:
            if time.monotonic() - self._cuando > self.CACHE_S:
                try:
                    self._cache = self._consultar()
                except Exception:
                    self._cache = None   # base caída: no se publican valores inventados
                self._cuando = time.monotonic()
            datos = self._cache
        if datos is None:
            return
        intersecciones, camaras = datos
        vehiculos = GaugeMetricFamily("traffic_intersection_vehicles",
                                      "Vehículos promedio del último minuto", labels=["intersection_id"])
        estado = GaugeMetricFamily("traffic_intersection_state",
                                   "0 fluida, 1 moderada, 2 congestionada, -1 sin datos",
                                   labels=["intersection_id"])
        clips = GaugeMetricFamily("traffic_intersection_clips_last_minute",
                                  "Clips guardados en el último minuto", labels=["intersection_id"])
        latido = GaugeMetricFamily("traffic_camera_last_result_timestamp_seconds",
                                   "Epoch del último resultado de la cámara (0 = nada en la última hora)",
                                   labels=["camera_id", "intersection_id"])
        for inter_id, promedio, n_clips in intersecciones:
            clips.add_metric([inter_id], n_clips)
            if promedio is None or n_clips == 0:
                estado.add_metric([inter_id], -1)
                continue
            n = int(round(float(promedio)))
            vehiculos.add_metric([inter_id], n)
            estado.add_metric([inter_id], _ESTADOS.get(self._nivel(n), -1))
        for cam_id, inter_id, epoch in camaras:
            latido.add_metric([cam_id, inter_id], float(epoch))
        yield vehiculos
        yield estado
        yield clips
        yield latido


def registrar_negocio(nivel_congestion):
    """Se llama desde main.py pasando compute_congestion_level (una sola fuente de los umbrales)."""
    register_collector(_MetricasNegocio(nivel_congestion))
