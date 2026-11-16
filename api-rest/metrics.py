"""Métricas Prometheus propias de api-rest (BFF).

- RED por ruta-plantilla: lo da observability.py (http_requests_total, http_request_duration_seconds).
- api_access_denied_total{status}: respuestas 401 (token inválido/vencido) y 403 (rol insuficiente)
  en las rutas protegidas. Se derivan del status de la respuesta, sin tocar la lógica de permisos.
- api_upstream_duration_seconds{upstream,status}: duración de cada llamada saliente a
  auth-service / visualization-backend / health checks. Se mide envolviendo
  requests.Session.request (por donde pasan requests.get/post/request), sin modificar main.py.
"""
import time
from urllib.parse import urlsplit

import requests

import config
from observability import BUCKETS_HTTP, counter, histogram, on_response

ACCESS_DENIED = counter("api_access_denied_total", "Accesos rechazados (401/403) en rutas protegidas",
                        ("route", "status"))
UPSTREAM_DURATION = histogram("api_upstream_duration_seconds",
                              "Duración de las llamadas de api-rest a otros servicios",
                              ("upstream", "status"), buckets=BUCKETS_HTTP)

_RUTAS_PUBLICAS = {"/", "/health", "/login", "/metrics"}


@on_response
def _contar_denegados(method, route, status, seconds):
    if status in (401, 403) and route not in _RUTAS_PUBLICAS:
        ACCESS_DENIED.labels(route, str(status)).inc()


def _hosts():
    """host:puerto → nombre corto del upstream (label de baja cardinalidad)."""
    nombres = {
        config.AUTH_SERVICE_URL: "auth",
        config.VISUALIZATION_BACKEND_URL: "viz",
        config.EDGE_PROCESSOR_URL: "edge",
        config.CV_MODULE_URL: "cv",
        config.MONITORING_PIPELINE_URL: "monitoring",
    }
    return {urlsplit(url).netloc: nombre for url, nombre in nombres.items() if url}


_UPSTREAMS = _hosts()
_request_original = requests.sessions.Session.request


def _request_medido(self, method, url, *args, **kwargs):
    t0 = time.perf_counter()
    status = "error"
    try:
        respuesta = _request_original(self, method, url, *args, **kwargs)
        status = str(respuesta.status_code)
        return respuesta
    finally:
        try:
            upstream = _UPSTREAMS.get(urlsplit(str(url)).netloc, "other")
            UPSTREAM_DURATION.labels(upstream, status).observe(time.perf_counter() - t0)
        except Exception:
            pass


requests.sessions.Session.request = _request_medido
