# Informe — sección "Observabilidad" (borrador)

> Borrador para reemplazar la sección de observabilidad del informe final. **Todos los números salen de corridas reales del 15–16/11/2026** en macOS Intel con Docker Desktop (8 CPU / 8 GB para Docker). Lo que no se llegó a probar figura en "Trabajo futuro". Decisiones detalladas: `docs/decisiones-observabilidad.md` (O1–O21).

## 1. Monitoreo vs. observabilidad
- **Monitoreo** (verbo): detectar *qué* falla. Lo hacen las 22 reglas de alerta de Grafana, los *probes* de salud y el canary.
- **Observabilidad** (propiedad del sistema): poder entender *por qué* falla a partir de lo que el sistema emite (métricas, logs y, como trabajo futuro, trazas), sin agregar código nuevo para cada pregunta.

## 2. Qué se implementó

| Pilar | Implementación | Dónde |
| :--- | :--- | :--- |
| Métricas | `/metrics` (Prometheus) en los 6 servicios Python: RED por ruta-plantilla, edge, worker, auth, API y **negocio** (estado y vehículos por intersección, heartbeat por cámara). Exporters: RabbitMQ (por cola), PostgreSQL ×3, MinIO, blackbox (health HTTP y TCP) y cAdvisor (opcional). Prometheus descubre **cada réplica** de `cv-module` por DNS. | `*/metrics.py`, `*/observability.py`, `observability/prometheus/` |
| Logs | JSON a stdout y a `logs_queue` (sin cambios, D15). El **monitoring-pipeline** consume la cola, valida, enmascara, enriquece y envía a **Loki**. Agregados por minuto en **metrics-db**. `logs_queue` acotada por policy. | `monitoring-pipeline/`, `observability/loki/`, `infrastructure/logs-queue/` |
| Visualización | Grafana 100 % provisionada: dashboards *Salud técnica* (operación), *Pipeline* (desarrollo), *Tránsito* (negocio) y *Logs*. Anotaciones desde Prometheus y desde Loki. | `observability/grafana/` |
| Alertas | 22 reglas (críticas, advertencias, logs y negocio) con umbral, *pending period*, severidad y runbook. Contact point: webhook. | `observability/grafana/provisioning/alerting/` |
| Salud | Probes de `/health` de cada servicio y de cada réplica, TCP a las 3 bases y los 2 brokers, `pg_up`, y **monitoreo sintético** (canary cada 30 s: login → intersecciones → health → logout). | `observability/blackbox/`, `observability/canary/` |

El stack es **opt-in** (`docker compose --profile observability up -d --build`). `docker compose up` levanta el sistema base igual que antes (verificado: las demos pasan con el perfil apagado).

## 3. Resultados medidos

| Qué | Resultado |
| :--- | :--- |
| Targets de Prometheus | 30 targets UP; con `--scale cv-module=3` aparecen 3 targets de cv-module sin tocar la configuración. |
| Métricas por cola | `camera_processing_queue`, `camera_dlq` y `logs_queue` por separado (`/metrics/detailed`). |
| Latencia extremo a extremo | p95 ≈ 0,2 s en reposo; ≈ 22 s durante la demo de worker caído (3 s por clip). |
| Drenado de `logs_queue` | 37 925 mensajes acumulados sin consumidor → 0 en ~30 s al arrancar el pipeline; 43 718 logs procesados, 0 inválidos, 0 descartados, 0 errores de push a Loki. |
| Metrics DB | ~72 clips/min con 6 cámaras (= 6 × 60/5), p95 de `duration_ms` 214–416 ms. |
| Alerta worker caído (2 corridas) | `docker compose stop cv-module` → *Sin workers de CV* y *camera_processing_queue sin consumidores* (críticas) en Firing y notificadas al webhook a los 92 s y a los 88 s; con `docker compose start cv-module` pasaron a *resolved* a los 56 s y a los 58 s. |
| Alerta DLQ | `demo_dlq.sh` → la alerta por métrica (RabbitMQ) y la alerta por **logs** (LogQL `clip_dead_lettered`) llegaron al webhook a los 13 s. |
| Alerta real encontrada | La alerta de memoria detectó a Grafana al 90 % de su límite de 384 MB (se subió a 512 MB). |
| Validación de consultas | 58 consultas PromQL y 17 LogQL de los dashboards validadas contra las APIs: 0 errores. |
| Costo en RAM del stack F1 | Prometheus ~100 MB; blackbox, cAdvisor, canary y exporters ~17–27 MB cada uno (cAdvisor). |
| Verificador | `scripts/verify_observabilidad.sh`: **45 OK, 0 fallas** (targets UP con 3 réplicas, Grafana provisionada, Loki con logs de los 5 servicios, `logs_queue` con policy y drenada, emitidos == recibidos: 144 `clip_published` en stdout = 144 en Loki en una ventana de 2 min). |
| Fail-safe | Con `METRICS_ENABLED=false`, `/metrics` da 404 y `/health` 200 en todos los servicios. Sin Loki, el pipeline sigue consumiendo (ACK siempre). |

## 4. Tabla de pruebas (continúa la existente)

| Prueba | Qué demuestra | Resultado | Script / cómo |
| :--- | :--- | :--- | :--- |
| P10 | Línea base intacta con observabilidad | Las 4 demos y la prueba de carga pasan con el perfil encendido después de F1, F2 y F3 (escalado 239/227/226; worker caído 54 = 54 y 132 = 132; DLQ con `x-death`; idempotencia 1 fila). | `scripts/demo_*.sh`, `prueba_carga.sh` |
| P11 | Sistema base sin el perfil | `demo_idempotencia` y `demo_dlq` pasan con el stack de observabilidad detenido. | `docker compose stop <servicios del perfil>` |
| P12 | Descubrimiento de réplicas | 3 réplicas → 3 targets UP y 3 probes OK. | `--scale cv-module=3` + Prometheus Targets |
| P13 | Alerta de worker caído y resolución | Firing a los 92 s / 88 s; resolved a los 56 s / 58 s (2 corridas). | `docker compose stop/start cv-module` |
| P14 | Alertas de DLQ por métrica y por logs | Ambas en el webhook a los 13 s. | `demo_dlq.sh` + `docker logs alert-receiver` |
| P15 | Pipeline drena `logs_queue` | 37 925 → 0 en ~30 s. | `rabbitmqctl list_queues` |
| P17 | Verificación automática de la observabilidad | 45 OK, 0 fallas. | `scripts/verify_observabilidad.sh` |
| P16 | Contadores visibles desde el primer fallo | Antes del arreglo (O12), `increase()` no veía la DLQ; después, `failed` = 1 en `download`. | `demo_dlq.sh` + PromQL |

## 5. Mini-relato de incidente (monitoreo → observabilidad)
**Worker caído.**
1. Alerta *Sin workers de CV* (crítica): esto es **monitoreo**.
2. Dashboard *Pipeline* → "Consumidores" = 0 y "Listos" creciendo.
3. Loki: `{service="cv-module", event=~"worker_.*"}` muestra `worker_stopped` y la hora exacta.
4. Causa raíz: la réplica se detuvo, no se cayó el broker (`probe_success{service="camera-queue"}` = 1). Esto es **observabilidad**.

**Clip a la DLQ.**
1. Alertas *Mensajes nuevos en camera_dlq* (métrica) y *Logs: clips enviados a la DLQ* (LogQL).
2. Dashboard *Pipeline* → "Fallos por etapa" = `download`.
3. Loki: `{event="clip_failed"} | json` → `stage="download"`, `error="NoSuchKey…"` y el `clip_id`.
4. Causa raíz: el `object_key` no existe en MinIO, porque el clip nunca se subió.

## 6. 12-Factor XI y AOD
- **Factor XI (logs como flujo de eventos):** se mantiene: cada proceso escribe a stdout y no gestiona archivos. El enrutamiento (cola → pipeline → Loki) es infraestructura aparte.
- **AOD:** el *Monitoring Metrics Pipeline* y la *Metrics DB*, que estaban punteados, pasan a implementados. Se agregan Prometheus, Grafana, Loki, blackbox, exporters, canary y alert-receiver.

## 7. Limitaciones y trabajo futuro (honesto)
- **Trazas distribuidas (OpenTelemetry → Collector → Jaeger, F4): trabajo futuro.** El código está en la rama `wip/trazas` (commit `8133931`), sin probar y sin integrar. Los logs ya llevan `trace_hex` (= `clip_id` sin guiones) para enlazarlos con las trazas cuando se integre.
- **No hechos:** `demo_observabilidad.sh` (demo guiada de las 4 alertas), la medición del costo de la instrumentación (carga con y sin el perfil, una corrida detrás de la otra), la prueba de clon limpio y los bonus (Alertmanager, SLO, exemplars, k6).
- **Prueba de carga — resultado NO CONCLUYENTE:** el throughput fue ~63 clips/s en la línea base (sin observabilidad) y ~35 clips/s en la corrida de F2, pero el host estaba saturado (load average ~450, `com.docker.backend` ~370 % de CPU incluso sin pruebas corriendo). Por eso la diferencia **no** se atribuye a la instrumentación. En todas las corridas hubo 0 clips fallidos y la cola se vació al escalar. La prueba de carga de F3 se interrumpió sin terminar. Medir el costo exige una corrida A/B (con y sin el perfil, una detrás de la otra) en un host sin saturar.
- Las zonas extra del edge (`docker compose run`) no se descubren por DNS (O7).
- cAdvisor no está probado en Windows.
- MinIO sin retención. Prometheus 3 días y Loki 48 h (pensado para laptops).
- `demo_worker_caido.sh` falla en una segunda corrida si no existe la réplica `-1` (hallazgo, no se modificó el script).

## 8. Uso de IA
Se usó un asistente de programación basado en IA para explorar el repositorio, proponer el plan por fases y escribir la configuración y el código de observabilidad. El equipo aprobó el plan y fijó las decisiones abiertas: ACK siempre con push best-effort, Metrics DB propia, logs en auth/viz, versiones exactas de MinIO y `requests`, y cAdvisor opcional. Los resultados de este informe salen de corridas reales; los problemas encontrados en las pruebas (contadores que nacían en 1, probe del frontend, socket de containerd para cAdvisor, memoria de Grafana) se corrigieron y quedaron documentados.
