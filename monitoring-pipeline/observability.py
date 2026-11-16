"""Observabilidad común de los servicios Python: métricas Prometheus y endpoint /metrics.

Este archivo es IDÉNTICO en todos los servicios Python (cada servicio es una imagen aparte,
igual que logs.py; ver decisión D15 y O3). scripts/verify_observabilidad.sh comprueba que
las copias no se desvíen.

Principio rector: la observabilidad no puede tirar abajo el producto.
- METRICS_ENABLED=false (o la librería ausente) → todas las métricas son objetos "no-op".
- El middleware HTTP traga y descarta cualquier error propio: nunca cambia la respuesta.
- Las métricas son contadores en memoria: registrar una muestra no hace E/S.

Etiquetas (labels): solo de baja cardinalidad. Nunca clip_id, trace_id, session_id ni URLs
con ids: la ruta se registra como plantilla (por ejemplo /api/intersections/{intersection_id}/history).
"""
import os
import time

METRICS_ENABLED = os.getenv("METRICS_ENABLED", "true").strip().lower() in ("1", "true", "yes", "on")

try:
    import prometheus_client as _prom
except Exception:  # librería ausente: se apagan las métricas, el servicio sigue
    _prom = None
    METRICS_ENABLED = False

# Buckets en segundos pensados para este sistema (HTTP interno y etapas de un clip).
BUCKETS_HTTP = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10)
BUCKETS_RAPIDOS = (0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5)
BUCKETS_LENTOS = (0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120)


class _NoOp:
    """Métrica que no hace nada (METRICS_ENABLED=false)."""

    def labels(self, *args, **kwargs):
        return self

    def __getattr__(self, _nombre):
        return lambda *a, **k: None


_NOOP = _NoOp()


def counter(name, documentation, labelnames=()):
    return _prom.Counter(name, documentation, labelnames) if METRICS_ENABLED else _NOOP


def gauge(name, documentation, labelnames=()):
    return _prom.Gauge(name, documentation, labelnames) if METRICS_ENABLED else _NOOP


def histogram(name, documentation, labelnames=(), buckets=BUCKETS_HTTP):
    return _prom.Histogram(name, documentation, labelnames, buckets=buckets) if METRICS_ENABLED else _NOOP


def register_collector(collector):
    """Registra un collector propio (se evalúa en cada scrape). Errores: se ignoran."""
    if not METRICS_ENABLED:
        return
    try:
        _prom.REGISTRY.register(collector)
    except Exception as e:
        print(f'{{"event": "metrics_collector_error", "level": "WARNING", "message": "{e!r}"}}', flush=True)


# ---------- RED de HTTP (Rate, Errors, Duration) por ruta-plantilla ----------

HTTP_REQUESTS = counter("http_requests_total", "Requests HTTP atendidos",
                        ("method", "route", "status"))
HTTP_DURATION = histogram("http_request_duration_seconds", "Duración de los requests HTTP",
                          ("method", "route"), buckets=BUCKETS_HTTP)
HTTP_IN_PROGRESS = gauge("http_requests_in_progress", "Requests HTTP en curso", ("method",))

_hooks_respuesta = []   # funciones (method, route, status, seconds) que agregan los servicios


def on_response(fn):
    """Registra un hook que se llama al terminar cada request (para métricas propias)."""
    _hooks_respuesta.append(fn)
    return fn


def _route_template(scope):
    route = scope.get("route")
    path = getattr(route, "path", None) if route is not None else None
    if path:
        return path                      # ruta de FastAPI: plantilla con {parámetros}
    if scope.get("endpoint") is not None and not scope.get("path_params"):
        return scope.get("path", "unmatched")   # ruta estática de Starlette (p. ej. /metrics)
    return "unmatched"                   # 404 u otra: nunca la URL cruda (cardinalidad)


class MetricsMiddleware:
    """Middleware ASGI puro (sin BaseHTTPMiddleware): mide sin tocar request ni respuesta."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        method = scope.get("method", "GET")
        t0 = time.perf_counter()
        estado = {"status": 500}

        async def send_wrapper(message):
            if message.get("type") == "http.response.start":
                estado["status"] = message.get("status", 500)
            await send(message)

        try:
            HTTP_IN_PROGRESS.labels(method).inc()
        except Exception:
            pass
        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            try:
                segundos = time.perf_counter() - t0
                route = _route_template(scope)
                status = str(estado["status"])
                HTTP_IN_PROGRESS.labels(method).dec()
                HTTP_REQUESTS.labels(method, route, status).inc()
                HTTP_DURATION.labels(method, route).observe(segundos)
                for hook in _hooks_respuesta:
                    hook(method, route, int(status), segundos)
            except Exception:
                pass  # la medición nunca rompe un request


def setup(app):
    """Engancha el middleware y expone GET /metrics. Llamar una vez, al crear la app FastAPI."""
    if not METRICS_ENABLED:
        return
    from starlette.responses import Response

    app.add_middleware(MetricsMiddleware)

    def metrics_endpoint(request):
        return Response(_prom.generate_latest(), media_type=_prom.CONTENT_TYPE_LATEST)

    app.add_route("/metrics", metrics_endpoint, methods=["GET"], include_in_schema=False)
