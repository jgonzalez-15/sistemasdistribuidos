#!/usr/bin/env python3
"""Genera los dashboards y las reglas de alerta de Grafana (provisioning como código).

Uso (desde la raíz del repo, solo Python 3 estándar):
    python3 observability/grafana/generar.py

Escribe:
    observability/grafana/dashboards/*.json                  (dashboards, se cargan solos)
    observability/grafana/provisioning/alerting/reglas.json  (reglas de alerta)

Los JSON generados se versionan: Grafana los lee al arrancar, sin clicks en la UI.
Editar ESTE archivo y regenerar; no editar los JSON a mano.
"""
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
PROM = {"type": "prometheus", "uid": "prometheus"}
LOKI = {"type": "loki", "uid": "loki"}
JAEGER = {"type": "jaeger", "uid": "jaeger"}

# ======================================================================
# Helpers de paneles
# ======================================================================
_id = [0]


def _nid():
    _id[0] += 1
    return _id[0]


def target(expr, legend="", ref="A", ds=PROM, instant=False):
    t = {"datasource": ds, "expr": expr, "refId": ref, "legendFormat": legend}
    if instant:
        t["instant"] = True
        t["range"] = False
    return t


def ts(title, targets, x, y, w=12, h=8, unit="short", desc="", stack=False, thresholds=None, minv=None):
    fc = {"unit": unit, "custom": {"lineWidth": 2, "fillOpacity": 10, "showPoints": "never",
                                   "stacking": {"mode": "normal" if stack else "none"}}}
    if minv is not None:
        fc["min"] = minv
    if thresholds:
        fc["thresholds"] = {"mode": "absolute", "steps": thresholds}
        fc["custom"]["thresholdsStyle"] = {"mode": "line+area"}
    return {"id": _nid(), "type": "timeseries", "title": title, "description": desc, "datasource": PROM,
            "gridPos": {"x": x, "y": y, "w": w, "h": h}, "targets": targets,
            "fieldConfig": {"defaults": fc, "overrides": []},
            "options": {"legend": {"displayMode": "table", "placement": "bottom", "calcs": ["lastNotNull", "max"]},
                        "tooltip": {"mode": "multi", "sort": "desc"}}}


def stat(title, targets, x, y, w=4, h=4, unit="short", desc="", mappings=None, steps=None, color_mode="background"):
    return {"id": _nid(), "type": "stat", "title": title, "description": desc, "datasource": PROM,
            "gridPos": {"x": x, "y": y, "w": w, "h": h}, "targets": targets,
            "fieldConfig": {"defaults": {"unit": unit, "mappings": mappings or [],
                                         "thresholds": {"mode": "absolute",
                                                        "steps": steps or [{"color": "green", "value": None}]}},
                            "overrides": []},
            "options": {"colorMode": color_mode, "graphMode": "none", "textMode": "auto",
                        "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False}}}


def table(title, targets, x, y, w=12, h=8, desc="", unit="short", steps=None, transformations=None):
    return {"id": _nid(), "type": "table", "title": title, "description": desc, "datasource": PROM,
            "gridPos": {"x": x, "y": y, "w": w, "h": h}, "targets": targets,
            "fieldConfig": {"defaults": {"unit": unit, "custom": {"cellOptions": {"type": "color-background"}},
                                         "thresholds": {"mode": "absolute",
                                                        "steps": steps or [{"color": "green", "value": None}]}},
                            "overrides": []},
            "transformations": transformations or [], "options": {"showHeader": True}}


def state_timeline(title, targets, x, y, w=24, h=6, desc="", mappings=None):
    return {"id": _nid(), "type": "state-timeline", "title": title, "description": desc, "datasource": PROM,
            "gridPos": {"x": x, "y": y, "w": w, "h": h}, "targets": targets,
            "fieldConfig": {"defaults": {"mappings": mappings or [], "color": {"mode": "thresholds"},
                                         "thresholds": {"mode": "absolute", "steps": [{"color": "green", "value": None}]}},
                            "overrides": []},
            "options": {"showValue": "never", "mergeValues": True, "rowHeight": 0.8}}


def row(title, y):
    return {"id": _nid(), "type": "row", "title": title, "collapsed": False,
            "gridPos": {"x": 0, "y": y, "w": 24, "h": 1}, "panels": []}


def text(content, x, y, w=24, h=3):
    return {"id": _nid(), "type": "text", "title": "", "gridPos": {"x": x, "y": y, "w": w, "h": h},
            "options": {"mode": "markdown", "content": content}}


UPDOWN = [{"type": "value", "options": {"0": {"text": "CAÍDO", "color": "red"},
                                        "1": {"text": "OK", "color": "green"}}}]
UPDOWN_STEPS = [{"color": "red", "value": None}, {"color": "green", "value": 1}]
ESTADO_TRANSITO = [{"type": "value", "options": {
    "-1": {"text": "sin datos", "color": "#808080"}, "0": {"text": "fluida", "color": "green"},
    "1": {"text": "moderada", "color": "yellow"}, "2": {"text": "congestionada", "color": "red"}}}]

ANOTACIONES_BASE = [
    {"builtIn": 1, "datasource": {"type": "grafana", "uid": "-- Grafana --"}, "enable": True, "hide": True,
     "iconColor": "rgba(0, 211, 255, 1)", "name": "Annotations & Alerts", "type": "dashboard"},
    {"datasource": PROM, "enable": True, "iconColor": "purple", "name": "Cambio de réplicas de cv-module",
     "expr": 'changes(count(up{job="cv-module"} == 1)[1m:15s]) > 0', "step": "30s",
     "titleFormat": "Cambió la cantidad de workers", "textFormat": "réplicas UP cambió en el último minuto"},
]


def dashboard(uid, title, desc, panels, tags, anotaciones=None, variables=None, refresh="10s", desde="now-1h"):
    return {"uid": uid, "title": title, "description": desc, "tags": ["sgtu"] + tags, "timezone": "browser",
            "editable": True, "graphTooltip": 1, "refresh": refresh, "schemaVersion": 39,
            "time": {"from": desde, "to": "now"}, "panels": panels,
            "templating": {"list": variables or []},
            "annotations": {"list": ANOTACIONES_BASE + (anotaciones or [])},
            "links": [{"title": "Dashboards SGTU", "type": "dashboards", "tags": ["sgtu"], "asDropdown": True}]}


# ======================================================================
# Dashboard 1 — Salud técnica (público: equipo de operación / SRE)
# ======================================================================
def d_salud():
    _id[0] = 0
    p = [text("**Salud técnica del SGTU** — público: operación/SRE. ¿Está todo arriba? ¿La API responde rápido y "
              "sin errores? ¿Hay algún contenedor sin recursos? Cada servicio se mide dos veces: *scrape* de "
              "`/metrics` (`up`) y *probe* de `/health` (`probe_success`, exige `\"status\": \"ok\"`).", 0, 0, h=2)]
    p.append(row("Estado de los servicios y las bases", 2))
    p.append(stat("Probes /health y TCP (1 = OK)", [target('min by (service) (probe_success)', "{{service}}", instant=True)],
                  0, 3, w=16, h=5, mappings=UPDOWN, steps=UPDOWN_STEPS,
                  desc="blackbox_exporter: HTTP /health de cada servicio (y cada réplica de cv-module) y conexión TCP a bases y brokers."))
    p.append(stat("Réplicas de cv-module UP", [target('count(up{job="cv-module"} == 1) or vector(0)', instant=True)],
                  16, 3, w=4, h=5, steps=[{"color": "red", "value": None}, {"color": "green", "value": 1}],
                  desc="Descubiertas por DNS (dns_sd_configs). Escalar con --scale cv-module=N."))
    p.append(stat("Canary (flujo de usuario)", [target('min(canary_check_success)', instant=True)],
                  20, 3, w=4, h=5, mappings=UPDOWN, steps=UPDOWN_STEPS,
                  desc="Monitoreo sintético: login → /api/intersections → /api/system/health → logout cada 30 s."))
    p.append(ts("Targets de Prometheus caídos (up == 0)", [target('sum by (job) (up == 0)', "{{job}}")], 0, 8, w=12, h=6,
                desc="Vacío = todo bien. Un target caído es un servicio o exporter que no responde /metrics."))
    p.append(ts("Canary: duración por paso (p95)", [target(
        'histogram_quantile(0.95, sum by (le, check) (rate(canary_check_duration_seconds_bucket[5m])))', "{{check}}")],
        12, 8, w=12, h=6, unit="s"))

    p.append(row("API REST (BFF) — RED: rate, errors, duration", 14))
    sin_ruido = 'route!~"/metrics|/health"'
    p.append(ts("Requests por segundo por ruta", [target(
        f'sum by (route) (rate(http_requests_total{{service="api-rest",{sin_ruido}}}[$__rate_interval]))', "{{route}}")],
        0, 15, w=8, unit="reqps"))
    p.append(ts("Errores 5xx (% de requests)", [target(
        f'100 * (sum(rate(http_requests_total{{service="api-rest",status=~"5..",{sin_ruido}}}[5m])) or vector(0)) '
        f'/ clamp_min(sum(rate(http_requests_total{{service="api-rest",{sin_ruido}}}[5m])), 1e-9)', "5xx %"),
        target(f'sum by (status) (rate(http_requests_total{{service="api-rest",status=~"4..",{sin_ruido}}}[5m]))', "{{status}}/s", "B")],
        8, 15, w=8, unit="short", minv=0,
        thresholds=[{"color": "transparent", "value": None}, {"color": "red", "value": 5}],
        desc="Alerta: > 5 % sostenido. La serie B muestra 401/403 por segundo (accesos denegados)."))
    p.append(ts("Ejemplo PromQL: latencia p50/p95/p99 con rate(...[5m]) e histogram_quantile", [
        target(f'histogram_quantile(0.50, sum by (le) (rate(http_request_duration_seconds_bucket{{service="api-rest",{sin_ruido}}}[5m])))', "p50"),
        target(f'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{{service="api-rest",{sin_ruido}}}[5m])))', "p95", "B"),
        target(f'histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket{{service="api-rest",{sin_ruido}}}[5m])))', "p99", "C")],
        16, 15, w=8, unit="s", thresholds=[{"color": "transparent", "value": None}, {"color": "orange", "value": 2}],
        desc="rate(x_bucket[5m]) = muestras por segundo en cada bucket en los últimos 5 min; histogram_quantile estima el percentil a partir de esos buckets. Alerta: p95 > 2 s."))
    p.append(ts("Latencia p95 por ruta", [target(
        f'histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket{{service="api-rest",{sin_ruido}}}[5m])))', "{{route}}")],
        0, 23, w=12, unit="s"))
    p.append(ts("Llamadas a otros servicios (p95 por upstream)", [target(
        'histogram_quantile(0.95, sum by (le, upstream) (rate(api_upstream_duration_seconds_bucket[5m])))', "{{upstream}}")],
        12, 23, w=12, unit="s", desc="auth = verificación de token en cada request; viz = datos del dashboard."))

    p.append(row("Todos los servicios HTTP y autenticación", 31))
    p.append(ts("Requests por segundo por servicio", [target(
        f'sum by (service) (rate(http_requests_total{{{sin_ruido}}}[$__rate_interval]))', "{{service}}")], 0, 32, w=8, unit="reqps"))
    p.append(ts("Logins por resultado y sesiones activas", [
        target('sum by (result) (rate(auth_login_total[5m])) * 60', "login {{result}}/min"),
        target('auth_active_sessions', "sesiones activas", "B")], 8, 32, w=8))
    p.append(ts("Accesos denegados (401/403) por minuto", [target(
        'sum by (status) (rate(api_access_denied_total[5m])) * 60', "{{status}}")], 16, 32, w=8))

    p.append(row("Recursos (cAdvisor opcional: perfil `cadvisor`) y bases", 40))
    filtro = 'container_label_com_docker_compose_service!="", container_label_com_docker_compose_project=~"$proyecto"'
    p.append(ts("CPU por contenedor (núcleos)", [target(
        f'sum by (container_label_com_docker_compose_service) (rate(container_cpu_usage_seconds_total{{{filtro}}}[$__rate_interval]))',
        "{{container_label_com_docker_compose_service}}")], 0, 41, w=12, unit="short",
        desc="Requiere el perfil `cadvisor`. Sin él, ver 'Memoria residente por proceso'."))
    p.append(ts("Memoria por contenedor (working set)", [target(
        f'sum by (container_label_com_docker_compose_service) (container_memory_working_set_bytes{{{filtro}}})',
        "{{container_label_com_docker_compose_service}}")], 12, 41, w=12, unit="bytes"))
    p.append(ts("Memoria residente por proceso Python (sin cAdvisor)", [target(
        'sum by (service) (process_resident_memory_bytes{service!~"prometheus|blackbox"})', "{{service}}")], 0, 49, w=12, unit="bytes"))
    p.append(ts("Conexiones a PostgreSQL (% de max_connections)", [target(
        '100 * sum by (service) (pg_stat_activity_count) / max by (service) (pg_settings_max_connections)', "{{service}}")],
        12, 49, w=12, unit="percent", thresholds=[{"color": "transparent", "value": None}, {"color": "orange", "value": 80}]))
    variables = [{"name": "proyecto", "label": "Proyecto Compose", "type": "query", "datasource": PROM,
                  "query": {"query": "label_values(container_last_seen, container_label_com_docker_compose_project)",
                            "refId": "v"},
                  "includeAll": True, "allValue": ".+", "current": {"text": "All", "value": "$__all"},
                  "refresh": 2, "description": "Filtra los contenedores de cAdvisor por proyecto de Compose."}]
    return dashboard("sgtu-salud", "SGTU · Salud técnica", "Servicios, API (RED), recursos y bases", p,
                     ["salud"], variables=variables)


# ======================================================================
# Dashboard 2 — Pipeline de procesamiento (público: equipo de desarrollo / mensajería)
# ======================================================================
def d_pipeline():
    _id[0] = 0
    cola = 'queue="camera_processing_queue"'
    p = [text("**Pipeline de procesamiento** — público: desarrollo. Edge → MinIO → `camera_processing_queue` → "
              "cv-module → results-db. Si entra más de lo que sale, la cola crece; si algo falla, va a `camera_dlq`.", 0, 0, h=2)]
    p.append(row("Flujo: lo que entra vs lo que sale", 2))
    p.append(ts("Clips publicados vs procesados (por segundo)", [
        target('sum(rate(edge_clips_published_total[$__rate_interval]))', "publicados (edge)"),
        target('sum(rate(worker_clips_total{result=~"ok|duplicate"}[$__rate_interval]))', "procesados (workers)", "B"),
        target('sum(rate(worker_clips_total{result="failed"}[$__rate_interval]))', "fallidos", "C")], 0, 3, w=12, unit="ops"))
    p.append(ts("camera_processing_queue: listos, sin ACK y consumidores", [
        target(f'rabbitmq_detailed_queue_messages_ready{{{cola}}}', "listos"),
        target(f'rabbitmq_detailed_queue_messages_unacked{{{cola}}}', "sin ACK", "B"),
        target(f'rabbitmq_detailed_queue_consumers{{{cola}}}', "consumidores", "C")], 12, 3, w=12,
        thresholds=[{"color": "transparent", "value": None}, {"color": "orange", "value": 100}],
        desc="Alerta: > 100 listos sostenido 2 min (warning); 0 consumidores (crítica)."))
    p.append(stat("Listos en la cola", [target(f'rabbitmq_detailed_queue_messages_ready{{{cola}}}', instant=True)],
                  0, 11, steps=[{"color": "green", "value": None}, {"color": "orange", "value": 100}]))
    p.append(stat("Consumidores", [target(f'rabbitmq_detailed_queue_consumers{{{cola}}}', instant=True)],
                  4, 11, steps=[{"color": "red", "value": None}, {"color": "green", "value": 1}]))
    p.append(stat("Mensajes en camera_dlq", [target('rabbitmq_detailed_queue_messages{queue="camera_dlq"}', instant=True)],
                  8, 11, steps=[{"color": "green", "value": None}, {"color": "orange", "value": 1}]))
    p.append(stat("Tiempo estimado para vaciar la cola", [target(
        f'sum(rabbitmq_detailed_queue_messages_ready{{{cola}}}) / clamp_min(sum(rate(worker_clips_total[1m])), 0.001)', instant=True)],
        12, 11, unit="s", steps=[{"color": "green", "value": None}, {"color": "orange", "value": 30}],
        desc="Antigüedad aproximada del mensaje más nuevo: listos / ritmo de procesamiento. (RabbitMQ no expone la edad del primer mensaje sin timestamps.)"))
    p.append(stat("Réplicas consumiendo", [target('sum(worker_consumer_up) or vector(0)', instant=True)],
                  16, 11, steps=[{"color": "red", "value": None}, {"color": "green", "value": 1}]))
    p.append(stat("Zonas del edge atrasadas", [target('sum(edge_lagging) or vector(0)', instant=True)],
                  20, 11, steps=[{"color": "green", "value": None}, {"color": "orange", "value": 1}]))

    p.append(row("Latencia", 15))
    p.append(ts("Latencia extremo a extremo (captura → guardado)", [
        target('histogram_quantile(0.50, sum by (le) (rate(worker_end_to_end_latency_seconds_bucket[5m])))', "p50"),
        target('histogram_quantile(0.95, sum by (le) (rate(worker_end_to_end_latency_seconds_bucket[5m])))', "p95", "B"),
        target('histogram_quantile(0.99, sum by (le) (rate(worker_end_to_end_latency_seconds_bucket[5m])))', "p99", "C")],
        0, 16, w=12, unit="s", thresholds=[{"color": "transparent", "value": None}, {"color": "orange", "value": 30}],
        desc="Reloj del worker − timestamp de captura del edge. En Compose comparten reloj; en producción habría deriva (NTP). Alerta: p95 > 30 s durante 5 min."))
    p.append(ts("Duración por etapa del worker (p95)", [target(
        'histogram_quantile(0.95, sum by (le, stage) (rate(worker_stage_duration_seconds_bucket[5m])))', "{{stage}}")],
        12, 16, w=12, unit="s"))

    p.append(row("Calidad: duplicados, reentregas y fallos", 24))
    p.append(ts("Duplicados, reentregas y dead-lettered (por minuto)", [
        target('sum(rate(worker_clips_total{result="duplicate"}[5m])) * 60', "duplicados descartados"),
        target('sum(rate(worker_redelivered_total[5m])) * 60', "reentregados (redelivered)", "B"),
        target('sum(rate(worker_clips_total{result="dead_lettered"}[5m])) * 60', "a la DLQ", "C")], 0, 25, w=12))
    p.append(ts("Fallos por etapa (worker y edge, por minuto)", [
        target('sum by (stage) (rate(worker_failures_total[5m])) * 60', "worker {{stage}}"),
        target('sum by (stage) (rate(edge_publish_failures_total[5m])) * 60', "edge {{stage}}", "B"),
        target('sum(rate(edge_publish_retries_total[5m])) * 60', "edge reintentos de publicación", "C")], 12, 25, w=12))
    p.append(ts("Clips por réplica (por segundo)", [target(
        'sum by (instance) (rate(worker_clips_total[$__rate_interval])) * on (instance) group_left (processed_by) max by (instance, processed_by) (worker_info)',
        "{{processed_by}}")], 0, 33, w=12, unit="ops", stack=True,
        desc="Competing consumers: con varias réplicas el trabajo se reparte. processed_by = hostname guardado en results."))
    p.append(ts("Edge: duración de la ronda (p95) y atraso", [
        target('histogram_quantile(0.95, sum by (le) (rate(edge_round_duration_seconds_bucket[5m])))', "ronda p95"),
        target('max(edge_lagging)', "edge_lagging (0/1)", "B")], 12, 33, w=12, unit="s",
        thresholds=[{"color": "transparent", "value": None}, {"color": "orange", "value": 5}],
        desc="edge_lagging = 1 si una ronda superó FRAME_INTERVAL (5 s)."))

    p.append(row("Broker de logs y monitoring-pipeline", 41))
    p.append(ts("logs_queue: profundidad y consumidores", [
        target('rabbitmq_detailed_queue_messages_ready{queue="logs_queue"}', "listos"),
        target('rabbitmq_detailed_queue_consumers{queue="logs_queue"}', "consumidores", "B")], 0, 42, w=12))
    p.append(ts("Brokers: conexiones y memoria", [
        target('sum by (service) (rabbitmq_connections)', "{{service}} conexiones"),
        target('sum by (service) (rabbitmq_process_resident_memory_bytes) / 1e6', "{{service}} MB", "B")], 12, 42, w=12))
    return dashboard("sgtu-pipeline", "SGTU · Pipeline de procesamiento", "Edge → cola → workers → base", p, ["pipeline"])


# ======================================================================
# Dashboard 3 — Tránsito (público: operador de tránsito / negocio)
# ======================================================================
def d_transito():
    _id[0] = 0
    p = [text("**Tránsito** — público: operador de la Intendencia. Estado de cada intersección con la misma regla "
              "del dashboard web (≥ 40 moderada, ≥ 75 congestionada, promedio del último minuto) y cámaras que dejaron de reportar.", 0, 0, h=2)]
    p.append(stat("Estado por intersección", [target('traffic_intersection_state', "{{intersection_id}}", instant=True)],
                  0, 2, w=12, h=5, mappings=ESTADO_TRANSITO,
                  steps=[{"color": "#808080", "value": None}, {"color": "green", "value": 0},
                         {"color": "yellow", "value": 1}, {"color": "red", "value": 2}]))
    p.append(stat("Vehículos (promedio último minuto)", [target('traffic_intersection_vehicles', "{{intersection_id}}", instant=True)],
                  12, 2, w=12, h=5, steps=[{"color": "green", "value": None}, {"color": "yellow", "value": 40},
                                           {"color": "red", "value": 75}]))
    p.append(state_timeline("Historia del estado por intersección", [target('traffic_intersection_state', "{{intersection_id}}")],
                            0, 7, mappings=ESTADO_TRANSITO,
                            desc="Alerta (info): una intersección congestionada de forma continua más de 10 min."))
    p.append(ts("Vehículos por intersección", [target('traffic_intersection_vehicles', "{{intersection_id}}")], 0, 13, w=12,
                thresholds=[{"color": "transparent", "value": None}, {"color": "yellow", "value": 40}, {"color": "red", "value": 75}]))
    p.append(ts("Clips por minuto por intersección (zona)", [target(
        'sum by (intersection_id) (rate(edge_clips_published_total{intersection_id=~"int-[1-3]"}[$__rate_interval])) * 60',
        "{{intersection_id}}")], 12, 13, w=12))
    p.append(table("Cámaras: segundos desde el último resultado guardado", [target(
        'time() - traffic_camera_last_result_timestamp_seconds', "", instant=True)], 0, 21, w=12, h=8, unit="s",
        steps=[{"color": "green", "value": None}, {"color": "orange", "value": 60}, {"color": "red", "value": 120}],
        desc="Heartbeat de punta a punta (desde results-db). Alerta crítica: > 120 s.",
        transformations=[{"id": "labelsToFields", "options": {}},
                         {"id": "organize", "options": {"excludeByName": {"Time": True, "instance": True, "job": True,
                                                                          "service": True, "__name__": True},
                                                        "renameByName": {"Value": "segundos sin datos"}}}]))
    p.append(ts("Bucket `clips` en MinIO", [target('minio_bucket_usage_total_bytes{bucket="clips"}', "tamaño"),
                                            target('minio_bucket_usage_object_total{bucket="clips"}', "objetos", "B")],
                12, 21, w=12, unit="bytes",
                desc="Sin retención (deuda conocida, D10/D17): crece ~0,6 GB/min en la prueba de carga. Alerta: > 5 GB. El conteo de objetos usa el eje derecho."))
    p[-1]["fieldConfig"]["overrides"] = [{"matcher": {"id": "byName", "options": "objetos"},
                                          "properties": [{"id": "unit", "value": "short"},
                                                         {"id": "custom.axisPlacement", "value": "right"}]}]
    return dashboard("sgtu-transito", "SGTU · Tránsito", "Estado del tránsito por intersección", p, ["negocio"],
                     refresh="30s", desde="now-3h")


# ======================================================================
# Reglas de alerta (Grafana Alerting)
# ======================================================================
def regla(uid, titulo, expr, op, umbral, para, severidad, resumen, descripcion, runbook, ds=PROM,
          rango=600, sin_datos="OK", panel_dash=None, tipo_query="prometheus"):
    modelo = {"refId": "A", "expr": expr, "instant": True, "range": False, "intervalMs": 15000, "maxDataPoints": 43200}
    if tipo_query == "loki":
        modelo = {"refId": "A", "expr": expr, "queryType": "instant", "instant": True, "range": False}
    anotaciones = {"summary": resumen, "description": descripcion, "runbook": runbook}
    if panel_dash:  # link al dashboard que hay que mirar primero (se ve en la notificación)
        anotaciones["dashboard"] = f"http://localhost:3001/d/{panel_dash}"
    return {
        "uid": uid, "title": titulo, "condition": "C",
        "data": [
            {"refId": "A", "relativeTimeRange": {"from": rango, "to": 0}, "datasourceUid": ds["uid"], "model": modelo},
            {"refId": "C", "datasourceUid": "__expr__",
             "model": {"refId": "C", "type": "threshold", "expression": "A",
                       "conditions": [{"evaluator": {"type": op, "params": [umbral]}}]}},
        ],
        "for": para, "noDataState": sin_datos, "execErrState": "Error",
        "labels": {"severity": severidad, "sistema": "sgtu"}, "annotations": anotaciones,
        "isPaused": False,
    }


def reglas():
    criticas = [
        regla("svc-probe-caido", "Servicio o base caída (probe)", 'min by (service, instance) (probe_success)', "lt", 1, "1m",
              "critical", "{{ $labels.service }} no responde ({{ $labels.instance }})",
              "El probe de blackbox (/health con \"status\": \"ok\", o TCP para bases y brokers) falla hace más de 1 min.",
              "1) Dashboard Salud técnica → 'Probes'. 2) docker compose ps / docker compose logs <servicio>. "
              "3) Si es viz con 'degraded', mirar results-db. 4) Explore → Loki {service=\"<servicio>\"}.", panel_dash="sgtu-salud"),
        regla("svc-scrape-caido", "Target de Prometheus caído", 'max by (job, instance) (up{job!~"blackbox.*"})', "lt", 1, "1m",
              "critical", "Prometheus no puede leer /metrics de {{ $labels.job }} ({{ $labels.instance }})",
              "up == 0 hace más de 1 min: el proceso no responde o la red interna falla.",
              "1) Status → Targets en Prometheus (lastError). 2) docker compose ps. 3) Logs del servicio.",
              panel_dash="sgtu-salud"),
        regla("cv-sin-workers", "Sin workers de CV", 'count(up{job="cv-module"} == 1) or vector(0)', "lt", 1, "30s",
              "critical", "No hay ninguna réplica de cv-module viva",
              "Prometheus no descubre ninguna réplica UP de cv-module: nadie procesa clips y la cola va a crecer.",
              "1) docker compose ps cv-module. 2) docker compose up -d --scale cv-module=1. 3) Logs de la réplica (worker_stopped / worker_reconnecting).",
              panel_dash="sgtu-pipeline"),
        regla("cola-sin-consumidores", "camera_processing_queue sin consumidores",
              'rabbitmq_detailed_queue_consumers{queue="camera_processing_queue"}', "lt", 1, "1m",
              "critical", "camera_processing_queue no tiene consumidores",
              "Ningún worker está suscrito a la cola de trabajo hace más de 1 min (worker caído o desconectado del broker).",
              "1) Pipeline → 'Consumidores'. 2) Loki: {service=\"cv-module\", event=~\"worker_.*\"}. 3) Panel de RabbitMQ :15672 → Queues.",
              panel_dash="sgtu-pipeline"),
        regla("camara-sin-datos", "Cámara sin resultados", 'max by (camera_id, intersection_id) (time() - traffic_camera_last_result_timestamp_seconds)',
              "gt", 120, "30s", "critical", "{{ $labels.camera_id }} ({{ $labels.intersection_id }}) sin resultados hace más de 2 min",
              "Heartbeat de punta a punta desde results-db: la cámara no tiene resultados guardados recientes. Puede fallar el edge, la cola, el worker o la base.",
              "1) Tránsito → tabla de cámaras. 2) ¿El edge publica? Pipeline → 'publicados vs procesados'. 3) Loki {service=\"edge-processor\"} |= \"<camera_id>\". 4) Seguir un clip_id en Jaeger.",
              panel_dash="sgtu-transito"),
        regla("canary-falla", "Monitoreo sintético fallando", 'min by (check) (canary_check_success)', "lt", 1, "1m",
              "critical", "El canary falla en el paso {{ $labels.check }}",
              "El recorrido de usuario (login → intersecciones → health → logout) falla hace más de 1 min aunque los servicios puedan responder /health.",
              "1) Salud técnica → 'Canary'. 2) docker logs canary (canary_check_failed con status). 3) RED de la API y Loki {service=\"api-rest\", level=\"ERROR\"}.",
              panel_dash="sgtu-salud"),
    ]
    warnings = [
        regla("cola-backlog", "Backlog en camera_processing_queue", 'rabbitmq_detailed_queue_messages_ready{queue="camera_processing_queue"}',
              "gt", 100, "2m", "warning", "La cola de trabajo tiene {{ $values.A }} mensajes listos",
              "Más de 100 mensajes listos sostenido 2 min: entra más de lo que los workers procesan (P6/P9: con 1 worker y demora artificial crece ~2,5 msg/s).",
              "1) Pipeline → 'publicados vs procesados' y 'Clips por réplica'. 2) Escalar: docker compose up -d --scale cv-module=3. 3) Revisar latencia por etapa (¿base lenta?).",
              panel_dash="sgtu-pipeline"),
        regla("dlq-nuevos", "Mensajes nuevos en camera_dlq", 'delta(rabbitmq_detailed_queue_messages{queue="camera_dlq"}[5m])',
              "gt", 0, "0s", "warning", "Llegaron mensajes a camera_dlq en los últimos 5 min",
              "Clips que fallaron (parse/download/detect/db) y se mandaron a la DLQ sin reintentos (D12).",
              "1) Pipeline → 'Fallos por etapa'. 2) Loki {event=\"clip_failed\"} | json → ver stage y error. 3) Seguir el trace_id en Jaeger. 4) rabbitmqadmin get queue=camera_dlq (header x-death).",
              panel_dash="sgtu-pipeline"),
        regla("edge-lagging", "Edge atrasado", 'max by (instance) (max_over_time(edge_lagging[2m]))', "gt", 0, "1m",
              "warning", "Una zona del edge tarda más que el intervalo entre clips",
              "edge_lagging = 1: una ronda de un hilo superó FRAME_INTERVAL (5 s). Las cámaras de esa zona mandan clips con atraso.",
              "1) Pipeline → 'Edge: duración de la ronda'. 2) CPU del edge (Salud técnica). 3) ¿publish_retry? (broker lento). 4) Repartir cámaras en más zonas (D10).",
              panel_dash="sgtu-pipeline"),
        regla("latencia-e2e", "Latencia extremo a extremo alta",
              'histogram_quantile(0.95, sum by (le) (rate(worker_end_to_end_latency_seconds_bucket[5m])))',
              "gt", 30, "5m", "warning", "p95 de captura→guardado = {{ $values.A }} s",
              "El dato del dashboard llega con más de 30 s de atraso (6 intervalos de captura). Normal: < 1 s.",
              "1) ¿Hay backlog? Pipeline → cola. 2) Duración por etapa. 3) Una traza de clip lento en Jaeger (dónde se fue el tiempo).",
              panel_dash="sgtu-pipeline"),
        regla("api-5xx", "API: tasa de errores 5xx alta",
              'sum(rate(http_requests_total{service="api-rest",status=~"5..",route!~"/metrics|/health"}[5m])) / clamp_min(sum(rate(http_requests_total{service="api-rest",route!~"/metrics|/health"}[5m])), 1e-9)',
              "gt", 0.05, "2m", "warning", "Más del 5 % de los requests de la API terminan en 5xx",
              "Errores del lado del servidor (auth o viz caídos, base caída).",
              "1) Salud técnica → 'Errores 5xx' y 'Llamadas a otros servicios'. 2) Loki {service=\"api-rest\", level=\"ERROR\"}. 3) Traza del request en Jaeger.",
              panel_dash="sgtu-salud"),
        regla("api-latencia", "API: latencia p95 alta",
              'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{service="api-rest",route!~"/metrics|/health"}[5m])))',
              "gt", 2, "5m", "warning", "p95 de la API = {{ $values.A }} s",
              "La API tarda más de 2 s en el percentil 95.",
              "1) Latencia p95 por ruta. 2) p95 por upstream (¿auth o viz?). 3) viz_query_duration_seconds. 4) Trazas lentas en Jaeger.",
              panel_dash="sgtu-salud"),
        regla("pg-caido", "PostgreSQL caído (exporter)", 'min by (service) (pg_up)', "lt", 1, "1m", "warning",
              "{{ $labels.service }}: postgres_exporter no puede conectarse",
              "pg_up = 0: la base no acepta conexiones del exporter.",
              "1) docker compose ps results-db auth-db. 2) docker compose logs <base>. 3) Probe TCP en Salud técnica.",
              panel_dash="sgtu-salud"),
        regla("pg-conexiones", "PostgreSQL: conexiones altas",
              'sum by (service) (pg_stat_activity_count) / max by (service) (pg_settings_max_connections)', "gt", 0.8, "2m",
              "warning", "{{ $labels.service }} usa más del 80 % de max_connections",
              "Cada request abre su conexión (sin pool): con mucha carga se puede agotar max_connections.",
              "1) Conexiones a PostgreSQL. 2) ¿Muchas réplicas o requests? 3) Agregar pool de conexiones (trabajo futuro).",
              panel_dash="sgtu-salud"),
        regla("minio-bucket", "Bucket de clips muy grande", 'max(minio_bucket_usage_total_bytes{bucket="clips"})', "gt", 5e9, "5m",
              "warning", "El bucket clips ocupa más de 5 GB",
              "No hay retención de clips (deuda conocida, D10/D17): el disco se va a llenar.",
              "1) Tránsito → 'Bucket clips'. 2) Política de expiración (mc ilm) o borrar clips viejos ya procesados.",
              panel_dash="sgtu-transito"),
        regla("contenedor-memoria", "Contenedor cerca de su límite de memoria",
              'max by (container_label_com_docker_compose_service) (container_memory_working_set_bytes{container_label_com_docker_compose_service!=""} / (container_spec_memory_limit_bytes{container_label_com_docker_compose_service!=""} > 0))',
              "gt", 0.85, "5m", "warning", "{{ $labels.container_label_com_docker_compose_service }} usa más del 85 % de su mem_limit",
              "Requiere cAdvisor (perfil cadvisor). Solo aplica a contenedores con mem_limit.",
              "1) Salud técnica → 'Memoria por contenedor'. 2) Subir mem_limit o bajar retención (Prometheus/Loki/Jaeger).",
              panel_dash="sgtu-salud"),
        regla("canary-trabado", "Canary sin ejecutar", 'time() - max(canary_last_run_timestamp_seconds)', "gt", 120, "1m",
              "warning", "El canary no completa un recorrido hace más de 2 min",
              "El contenedor canary está caído o trabado: el monitoreo sintético no está midiendo.",
              "docker compose ps canary / docker logs canary.", panel_dash="sgtu-salud", sin_datos="Alerting"),
    ]
    info = [
        regla("congestion-sostenida", "Intersección congestionada de forma sostenida",
              'min_over_time(traffic_intersection_state[10m])', "gt", 1.5, "0s", "info",
              "{{ $labels.intersection_id }} congestionada hace más de 10 min",
              "Aviso al operador de tránsito (no es una falla técnica): la intersección estuvo congestionada todo el período.",
              "Tránsito → 'Historia del estado'. Coordinar con el operador (semáforos, desvíos).", rango=900,
              panel_dash="sgtu-transito"),
    ]
    return [("SGTU · Críticas", "30s", criticas), ("SGTU · Advertencias", "30s", warnings), ("SGTU · Negocio", "1m", info)]


def provisioning_alertas(grupos):
    return {"apiVersion": 1, "groups": [
        {"orgId": 1, "name": nombre, "folder": "SGTU", "interval": intervalo, "rules": rs}
        for nombre, intervalo, rs in grupos]}


def main():
    dashboards = {"salud.json": d_salud(), "pipeline.json": d_pipeline(), "transito.json": d_transito()}
    for nombre, d in dashboards.items():
        (BASE / "dashboards" / nombre).write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
    (BASE / "provisioning" / "alerting" / "reglas.json").write_text(
        json.dumps(provisioning_alertas(reglas()), indent=2, ensure_ascii=False) + "\n")
    print("OK:", ", ".join(dashboards), "+ reglas.json")


if __name__ == "__main__":
    main()
