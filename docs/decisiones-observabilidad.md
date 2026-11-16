# Decisiones de diseño: observabilidad

Alcance: métricas, logs, trazas, visualización y alertas del SGTU (`monitoring-pipeline`,
`docker-compose.observability.yml`, `observability/` y la instrumentación de cada servicio).
Formato igual que D1–D17: motivo, costo aceptado y alternativa descartada.

Principio rector (heredado de D15): **la observabilidad no puede tirar abajo el producto.**

Estado: F1 (métricas), F2 (Grafana y alertas) y F3 (logs) implementadas. F4–F5: las decisiones se agregan al cerrar cada fase.

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

## O13. Grafana 100 % provisionada, dashboards generados por código
- **Qué:** datasources, dashboards, reglas de alerta, contact point y política de notificación se cargan desde `observability/grafana/provisioning` al arrancar. Los dashboards y las reglas los genera `observability/grafana/generar.py` (Python estándar) y se versionan los JSON resultantes.
- **Por qué:** cero clicks: cualquier compañero obtiene los mismos dashboards con `up`. Un generador evita cientos de líneas de JSON repetido y permite revisar las consultas en un solo lugar.
- **Verificado:** las 58 consultas de los dashboards se validaron contra la API de Prometheus (0 errores de sintaxis). Grafana 13 exige `__panelId__` si se usa `__dashboardUid__` en una regla, así que las reglas llevan una anotación `dashboard` con el link directo.
- **Costo aceptado:** los dashboards no se editan desde la UI (`allowUiUpdates: false`). Para cambiarlos hay que editar el generador; esto evita que el repo y la UI diverjan.
- **Alternativa descartada:** crear los dashboards en la UI y exportarlos. No es reproducible ni revisable.

## O14. Tres dashboards por público
- **Salud técnica** (operación): probes, réplicas, canary, RED de la API con un panel de ejemplo de PromQL (`rate(...[5m])` + `histogram_quantile`), upstreams, logins, recursos y conexiones a las bases.
- **Pipeline de procesamiento** (desarrollo): publicados vs procesados, cola (listos, sin ACK, consumidores), DLQ, tiempo estimado para vaciar la cola, latencia extremo a extremo p50/p95/p99, etapas, duplicados, reentregas, reparto por réplica y edge.
- **Tránsito** (negocio): estado por intersección con la misma regla y colores del dashboard web, historia del estado, cámaras sin datos y tamaño del bucket.
- **Anotaciones:** las alertas de Grafana y un "cambio de réplicas de cv-module" calculado con PromQL. Las anotaciones desde logs se agregan en F3.

## O15. Alerting de Grafana con pending period, severidad y runbook
- **Qué:** 18 reglas en 3 grupos (Críticas, Advertencias, Negocio). Cada una tiene umbral, *pending period* (`for`), label `severity`, `summary`, `description`, `runbook` (qué mirar primero) y link al dashboard.
- **Umbrales y por qué:**
  - Probe o target caído > 1 min.
  - Sin workers o cola sin consumidores (crítica, 30 s / 1 min).
  - Backlog > 100 listos durante 2 min: con 1 worker y demora artificial la cola crece ~2,5 msg/s (D17), así que 100 se supera en ~40 s.
  - DLQ: cualquier mensaje nuevo en 5 min.
  - Cámara sin resultados > 120 s (24 intervalos de 5 s).
  - Latencia extremo a extremo p95 > 30 s durante 5 min (normal medido: ~0,2 s; en la demo de worker caído llegó a 22 s).
  - API: 5xx > 5 % y p95 > 2 s.
  - PostgreSQL: caído o conexiones > 80 %.
  - Bucket > 5 GB.
  - Memoria de contenedor > 85 % de su `mem_limit`.
  - Congestión sostenida > 10 min (info).
- **Contact point:** webhook a `alert-receiver`, que imprime cada notificación (`docker logs -f alert-receiver`). La URL es configurable (`ALERT_WEBHOOK_URL`): sirve para Slack, Discord o cualquier webhook propio sin cambiar código.
- **Verificado:** con `docker compose stop cv-module`, *Sin workers de CV* y *camera_processing_queue sin consumidores* pasaron a Firing a los 92 s y llegaron al webhook. Al volver a arrancarlo se resolvieron (notificación `resolved`) a los 56 s.
- **Alternativa descartada (por ahora):** Alertmanager con reglas en Prometheus. El curso muestra el alerting de Grafana (contact point, pending period, UI unificada) y además permite alertas sobre logs (LogQL) en el mismo lugar. Alertmanager queda como bonus.

## O16. Logs a Loki a través del monitoring-pipeline (no scrapeando stdout)
- **Qué:** los servicios siguen escribiendo JSON a stdout y publicándolo en `logs_queue` (D15, sin cambios). El `monitoring-pipeline` consume la cola, **valida** (objeto JSON con `service` y `event`), **limpia** (enmascara claves tipo `password`/`token`/`authorization`), **enriquece** (`trace_hex` = `trace_id` sin guiones, que es el formato de trace id de OpenTelemetry, y `pipeline_received_at`) y hace *push* a Loki en lotes.
- **Labels de Loki:** solo `service`, `level` y `event` (baja cardinalidad). `trace_id`, `clip_id`, `camera_id`, etc. quedan en la línea y se filtran con `| json`. Se apagaron los labels automáticos de Loki 3 (`service_name`, `detected_level`), que los duplicaban.
- **Por qué:** respeta la arquitectura original (logs → cola → pipeline → almacenamiento) y **drena** `logs_queue`, que antes crecía sin límite. Antes de F3 había 37 925 mensajes acumulados; con el pipeline la cola llegó a 0 en ~30 s (medido).
- **Alternativa descartada:** Grafana Alloy (Promtail está discontinuado) leyendo stdout de Docker. Es otro agente con acceso al socket de Docker, deja `logs_queue` sin consumir y duplica el camino que ya existe.
- **Por qué Loki y no ELK:** Loki indexa solo los labels (no el texto), así que entra en ~100 MB de RAM y se integra con Grafana (Explore, anotaciones, alertas LogQL). Elasticsearch necesita una JVM con 1–2 GB, que no entra en una laptop junto con todo el sistema. El costo aceptado es que las búsquedas de texto libre son más lentas (*grep* sobre los chunks), lo cual con 48 h de retención es aceptable.

## O17. ACK siempre; push a Loki best-effort con buffer acotado
- **Qué:** el consumidor hace ACK de cada mensaje después de procesarlo en memoria, sin esperar a Loki ni a la base. Los logs para Loki van a un buffer en memoria de hasta `LOKI_BUFFER_MAX` (20 000). Si Loki no responde, se reintenta con espera creciente (1→30 s); si el buffer se llena, se descartan los más viejos (`pipeline_loki_dropped_total`).
- **Por qué:** la observabilidad no puede trabar el producto ni la cola. Con el perfil apagado (sin Loki), el pipeline sigue consumiendo y calculando métricas y agregados.
- **Costo aceptado:** durante una caída larga de Loki se pierden logs **en Loki**. stdout de cada servicio los conserva y las métricas derivadas no se pierden.
- **Alternativa descartada:** ACK solo cuando Loki confirma. No pierde logs, pero con Loki caído la cola crece hasta el tope y empieza a descartar igual (por la policy), así que es lo mismo con más acoplamiento.
- El pipeline escribe **sus propios** logs solo a stdout (`stdout_log.py`): si los publicara en `logs_queue` se consumiría a sí mismo.

## O18. Metrics DB propia (`metrics-db`) con agregados por minuto
- **Qué:** contenedor `postgres:16-alpine` (puerto 5435, `mem_limit` 128 MB) en el compose **base**, porque el pipeline es parte del sistema base. El pipeline crea el esquema de forma idempotente y escribe por minuto (según el `ts` del log): clips publicados, procesados, duplicados, fallidos y dead-lettered, p95 y promedio de `duration_ms`, logs totales y de error, `logs_dropped` (`metrics_minute`), y fallos por servicio y etapa (`metrics_failures_minute`).
- **Por qué:** Prometheus guarda 3 días. La Metrics DB da un histórico consultable por SQL para el informe, independiente del perfil de observabilidad, y es el componente "Metrics DB" del AOD original. Medido: ~72 clips/min con 6 cámaras, que es exactamente 6 × 60/5.
- **Tolerancia a fallos:** un minuto se escribe cuando ya cerró (+30 s de margen). Si la base no responde, queda en memoria (hasta 180 minutos) y se reintenta. Un log atrasado se suma con UPSERT: los contadores quedan exactos y el p95 queda como el máximo de los lotes (aproximación conservadora).
- **Alternativa descartada:** una tabla en `results-db`. Mezcla dominios y depende de la base de Joaco G.

## O19. Logs estructurados también en auth-service y visualization-backend
- **Qué:** `logs.py` copiado de api-rest (mismo contrato y mismo shipper). Los eventos se emiten desde los *hooks* de respuesta del middleware, **sin tocar los endpoints**: `auth_started`, `auth_login` (resultado y duración; **sin usuario, contraseña ni token**), `auth_request_failed` (5xx), `viz_started`, `viz_request_failed` (5xx) y `viz_metrics_query_failed` (solo al cambiar de estado, para no inundar).
- **Por qué:** sin esto esos dos servicios no aparecían en Loki (solo usaban `print`).

## O20. `logs_queue` acotada con una policy de RabbitMQ (no con x-arguments)
- **Qué:** policy `logs-queue-limites` en `infrastructure/logs-queue/definitions.json`: `max-length` 50 000, `overflow: drop-head` (descarta los más viejos) y `message-ttl` 24 h.
- **Por qué:** los argumentos `x-max-length`/`x-message-ttl` son parte de la declaración de la cola. Cambiarlos sobre una cola existente da `PRECONDITION_FAILED` y obliga a borrarla. Una **policy** se aplica a una cola existente sin recrearla, y los shippers (que declaran con `passive=True`) no se enteran. Se aplicó con `docker compose restart logs-queue` (recarga `definitions.json`) y se verificó con `rabbitmqctl list_queues name policy`. Sin reiniciar: `docker compose exec logs-queue rabbitmqctl set_policy logs-queue-limites "^logs_queue$" '{"max-length":50000,"overflow":"drop-head","message-ttl":86400000}' --apply-to queues`.
- **Costo aceptado:** si el pipeline está caído más de lo que tardan en entrar 50 000 logs (~5 h a 165 msg/min en reposo), se pierden los más viejos de la cola. stdout los conserva.

## O21. Alertas basadas en logs y anotaciones desde Loki
- **Alertas LogQL:** `clip_dead_lettered` en 5 min, `logs_dropped` en 10 min, ráfaga de `ERROR` por servicio (> 20 en 5 min) y el pipeline sin consumir (por métrica). **Verificado:** después de `demo_dlq.sh`, *Logs: clips enviados a la DLQ* (LogQL) y *Mensajes nuevos en camera_dlq* (métrica de RabbitMQ) llegaron al webhook a los 13 s.
- **Anotaciones automáticas** en todos los dashboards: arranque y parada de workers y del pipeline, `clip_dead_lettered`/`logs_dropped`, y `edge_lagging` (apagada por defecto: con carga son cientos).
- **Dashboard *SGTU · Logs*:** volumen por nivel, errores por servicio, `clip_failed` por etapa (`| json`), eventos más frecuentes y el panel de logs con variables `service`/`level`/`event` y búsqueda libre.
- **Hallazgo:** la alerta de memoria de contenedor detectó a Grafana al 90 % de su límite de 384 MB; se subió a 512 MB.
