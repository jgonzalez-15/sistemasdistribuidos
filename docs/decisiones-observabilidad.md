# Decisiones de diseño: observabilidad

Alcance: métricas, logs, trazas, visualización y alertas del SGTU (`monitoring-pipeline`,
`docker-compose.observability.yml`, `observability/` y la instrumentación de cada servicio).
Formato igual que D1–D17: motivo, costo aceptado y alternativa descartada.

Principio rector (heredado de D15): **la observabilidad no puede tirar abajo el producto.**

Estado: **F1 (métricas) implementada.** F2–F5 en curso; las decisiones de esas fases se agregan al cerrarlas.

---

## O1. Stack opt-in en un perfil de Compose, incluido con `include:`
- **Qué:** todo lo nuevo vive en `docker-compose.observability.yml` con `profiles: ["observability"]`. `docker-compose.yml` lo incluye con una sola línea (`include:`).
- **Por qué:** `docker compose up` sigue levantando solo el sistema base (liviano), y `docker compose --profile observability up -d --build` levanta todo con un solo comando. Los `demo_*.sh` no pasan `--profile`, así que nunca recrean ni apagan el stack de observabilidad.
- **Costo aceptado:** requiere Docker Compose ≥ 2.20 (`include:`). Probado con 2.34.
- **Alternativa descartada:** archivo override con `-f`. Obliga a recordar el `-f` en cada comando, y los scripts existentes (que no lo pasan) recrearían edge y cv sin la configuración de observabilidad.

## O2. Métricas siempre activas y con switch `METRICS_ENABLED`
- **Qué:** cada servicio Python expone `GET /metrics` (formato Prometheus). Con `METRICS_ENABLED=false` las métricas pasan a ser objetos *no-op* y `/metrics` no existe (probado: 404, `/health` sigue en 200).
- **Por qué:** registrar una muestra es una operación en memoria, sin E/S. Prometheus hace *pull*: si no está levantado, nadie consulta `/metrics` y el costo es casi nulo.
- **Costo aceptado:** una dependencia más por imagen (`prometheus-client==0.26.0`, la misma versión en todos los servicios).
- **Alternativa descartada:** *push* (Pushgateway). Acopla el servicio a la disponibilidad del colector, al revés del principio rector.

## O3. Helper común `observability.py` copiado en cada servicio
- **Qué:** `observability.py` es **idéntico** en los seis servicios Python (igual que `logs.py`, D15). Las métricas propias de cada servicio van en un `metrics.py` aparte.
- **Por qué:** se respeta "un servicio = una imagen independiente": cada build context es la carpeta del servicio.
- **Costo aceptado:** código duplicado. Se mitiga comprobando que las copias sean idénticas (`md5`; lo automatiza `scripts/verify_observabilidad.sh`).
- **Alternativa descartada:** un paquete compartido con build context en la raíz. Cambia los Dockerfiles y los contextos de build de todos los servicios.

## O4. RED de HTTP con middleware ASGI propio, con la ruta como plantilla
- **Qué:** `http_requests_total{method,route,status}`, `http_request_duration_seconds{method,route}` y `http_requests_in_progress`. `route` es la **plantilla** de FastAPI (`/api/intersections/{intersection_id}/history`), nunca la URL con ids; una ruta inexistente se registra como `unmatched`.
- **Por qué:** cardinalidad acotada. El middleware es ASGI puro, no lee ni modifica el request ni la respuesta, y cualquier error propio se traga.
- **Alternativa descartada:** `prometheus-fastapi-instrumentator`. Hace lo mismo con una dependencia más y menos control sobre los labels.

## O5. Métricas sin tocar la lógica de los servicios de los compañeros
- **api-rest:** `api_access_denied_total{route,status}` se deriva del status 401/403 de la respuesta. `api_upstream_duration_seconds{upstream,status}` se mide envolviendo `requests.Session.request` (por ahí pasan `requests.get/post/request`). `main.py` solo suma dos líneas (`import` y `observability.setup(app)`).
- **auth-service:** `auth_login_total{result}` (ok, invalid, bad_request, error) se deriva del status de `POST /login`. `auth_active_sessions` se calcula en el scrape con caché de 15 s (misma regla que `/token/state`).
- **visualization-backend:** `viz_query_duration_seconds` mide cada `execute()` con un `RealDictCursor` que mide el tiempo y devuelve el mismo resultado.
- **Costo aceptado:** dos *monkeypatch* documentados (`requests.Session.request` y `db.get_db_connection`), que es la misma técnica que usa la instrumentación automática de OpenTelemetry.
- **Alternativa descartada:** agregar un contador al lado de cada `log_event` en `api-rest/main.py`. Son muchas más líneas cambiadas en código ajeno.

## O6. Métricas de negocio en el Visualization Backend, con caché
- **Qué:** `traffic_intersection_vehicles`, `traffic_intersection_state` (0 fluida, 1 moderada, 2 congestionada, −1 sin datos), `traffic_intersection_clips_last_minute` y `traffic_camera_last_result_timestamp_seconds{camera_id}`.
- **Por qué:** el estado sale de `results-db` con **la misma regla** que `GET /intersections` (promedio del último minuto y los umbrales de `compute_congestion_level`, que se pasa como función: una sola fuente de los umbrales). La caché de 10 s evita consultar la base en cada scrape. Solo se publican intersecciones y cámaras **registradas**, así que las cámaras de prueba de las demos no generan series.
- **El heartbeat de cámara** sale de la base (resultado guardado), no solo del edge (`edge_last_clip_timestamp_seconds`): detecta de punta a punta una cámara que no llega a guardarse, se caiga el edge, la cola o el worker.
- **Costo aceptado:** con la base caída, esas métricas desaparecen en ese scrape (no se inventa un valor) y la alerta de base caída lo cubre.

## O7. Descubrimiento de réplicas por DNS (`dns_sd_configs`)
- **Qué:** Prometheus resuelve `cv-module` (registro A) y obtiene **una IP por réplica**: con `--scale cv-module=3` aparecen 3 targets sin tocar nada (probado). Los `/health` de cada réplica se prueban con blackbox sobre la misma lista. `worker_info{processed_by}` relaciona cada `instance` con el hostname que se guarda en `results.processed_by`.
- **Limitación encontrada (probada):** los contenedores creados con `docker compose run ... edge-processor` (zonas extra, D10) **no reciben el alias DNS** del servicio, así que Prometheus no los descubre. Su efecto de negocio sí se ve (resultados y heartbeat en la base). Solución futura: `file_sd_configs` con la lista de zonas, o zonas declaradas como servicios propios.
- **Alternativa descartada:** `docker_sd_configs`. Exige montar el socket de Docker en Prometheus.

## O8. Exporters: plugin nativo de RabbitMQ, postgres_exporter, MinIO, blackbox y cAdvisor opcional
- **RabbitMQ:** el plugin `rabbitmq_prometheus` ya viene habilitado en `rabbitmq:3.13-management-alpine` (no hubo que cambiar la configuración de los brokers). El endpoint por defecto solo da **agregados**; para métricas **por cola** se usa `/metrics/detailed?family=queue_coarse_metrics&family=queue_consumer_count`, y así `camera_processing_queue`, `camera_dlq` y `logs_queue` aparecen por separado (verificado). Las *redeliveries* por cola solo existen por canal (`channel_queue_metrics`, label de alta cardinalidad), así que se usa `worker_redelivered_total`.
- **PostgreSQL:** un `postgres_exporter` por base (`pg_up`, conexiones, `max_connections`), más un probe TCP con blackbox. Así las **bases** también tienen health check.
- **MinIO:** `/minio/v2/metrics/cluster` y `/minio/v2/metrics/bucket` (`minio_bucket_usage_total_bytes{bucket="clips"}`) con `MINIO_PROMETHEUS_AUTH_TYPE=public`, solo en la red interna de desarrollo.
- **blackbox_exporter:** `/health` de cada servicio exigiendo HTTP 200 **y** `"status": "ok"` en el cuerpo (un viz sin base responde `degraded` y cuenta como falla). El frontend (Vite) rechaza con 403 un `Host` desconocido, así que el probe manda `Host: localhost:3000` en vez de cambiar la configuración del frontend.
- **cAdvisor (perfil `cadvisor`, opcional):** CPU y memoria por contenedor. En Docker Desktop para macOS **funciona** montando `/var/run/docker.sock` y `/run/containerd/containerd.sock` (montar `/var/run` entero trae el directorio de macOS y no el de la VM; probado). Es opcional porque depende del SO (no probado en Windows) y porque el acceso al socket equivale a controlar el daemon.

## O9. Monitoreo sintético (canary)
- **Qué:** el contenedor `canary` recorre cada 30 s el camino de un usuario: `POST /login` → `GET /api/intersections` → `GET /api/system/health` → `POST /logout`. Expone `canary_check_success{check}`, `canary_check_duration_seconds{check}` y `canary_runs_total{result}`.
- **Por qué:** los health checks dicen que cada pieza responde; el canary dice que **el flujo de punta a punta** funciona. El logout evita acumular sesiones activas en `auth-db`. Nunca imprime la contraseña ni el token.
- **Costo aceptado:** unos 4 requests cada 30 s y entradas en los logs de la API (`login_request`, etc.).

## O10. Versiones fijas
- Imágenes nuevas verificadas en las releases oficiales (2026-11-15): Prometheus `v3.16.0`, blackbox_exporter `v0.29.1`, postgres_exporter `v0.20.1`, cAdvisor `v0.60.6` (ghcr.io).
- **Imágenes existentes que estaban sin fijar:** `elestio/minio:latest` se fijó por **digest** a la imagen exacta que corría (`sha256:25348a25…`, MinIO `RELEASE.2025-09-07T16-13-09Z`), porque elestio solo publica el tag `latest`. `requests` en api-rest se fijó a la versión instalada (`2.34.2`).

## O11. Auditoría de niveles de log
- Se revisaron los niveles de todos los eventos de edge, cv-module y api-rest. Están bien asignados: ERROR para fallos (`clip_failed`, `*_error`), WARNING para condiciones degradadas o rechazos esperables (`edge_lagging`, `publish_retry`, `access_denied`, `token_verification_failed`) e INFO para el flujo normal.
- **Única corrección:** `visualization_error` pasa a ERROR cuando viz responde 5xx (falla del servidor) y queda WARNING en 4xx (pedido inválido). El nombre del evento no cambia.

## O12. Contadores con label inicializados en 0
- **Qué:** al arrancar, cada servicio crea en 0 las series de sus valores de label conocidos (`worker_clips_total{result}`, `worker_failures_total{stage}`, `edge_publish_failures_total{stage}`, `auth_login_total{result}`, `canary_runs_total{result}`).
- **Por qué (encontrado probando):** en la primera corrida de `demo_dlq.sh` con Prometheus, el fallo **no** aparecía en `increase(worker_clips_total[15m])`. La serie `failed` nacía directamente en 1 con el primer fallo y la réplica fue reemplazada al poco tiempo por la demo de escalado, así que Prometheus nunca vio el salto 0→1. Para una alerta de DLQ es un falso negativo. Con la inicialización, la misma demo da `failed` y `dead_lettered` = 1 en la etapa `download` (verificado).

## Hallazgos sobre los scripts existentes (sin modificarlos)
- `scripts/demo_worker_caido.sh` mata siempre `<proyecto>-cv-module-1`. Si en una corrida anterior esa réplica fue eliminada y después se escaló, Compose numera las nuevas desde el número libre siguiente (-3, -4…) y el script termina con `Error: No such object`. **No depende de la observabilidad:** pasa en cualquier segunda corrida. Se resuelve recreando los workers antes de la demo (`docker compose rm -sf cv-module && docker compose up -d cv-module`). Se le avisa a quien mantiene el script; una mejora sería elegir la víctima con `docker compose ps -q cv-module | head -1`.
- En este equipo (macOS Intel, Docker Desktop, 8 CPU / 8 GB para Docker), `prueba_carga.sh` registra rondas atrasadas del edge (`edge_lagging`): 131 en la línea base, **sin** el stack de observabilidad. D17 reporta 0 en otra máquina: es una característica del hardware, no un efecto de la instrumentación.
