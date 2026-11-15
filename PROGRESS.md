# PROGRESS — Sistema de gestión de tránsito (SGTU)

Leyenda: `[x]` hecho · `[ ]` pendiente · `[~]` parcial

---

## Ro — Observabilidad (Jaeger / Grafana / Prometheus con logs)

- [x] `logs-queue` (RabbitMQ 2) levantado con la cola `logs_queue` (`infrastructure/logs-queue/`)
- [x] Edge, cv-module y api-rest ya publican logs JSON con `trace_id` en `logs_queue` (hecho por Joaco R / Joaco G, no por Ro)
- [ ] **`monitoring-pipeline` consume `logs_queue`** — hoy `monitoring-pipeline/main.py` solo tiene `/health`
- [ ] Calcular métricas acordadas: clips/min, latencia (`duration_ms`), errores por `stage`, mensajes en DLQ
- [ ] Límite a `logs_queue` (`x-max-length` o TTL en `infrastructure/logs-queue/definitions.json`): sin consumidor crece ~165 msg/min
- [ ] Exponer métricas (endpoint `/metrics` para Prometheus o tabla `metrics` en `results-db`)
- [ ] Prometheus / Grafana / Jaeger en `docker-compose.yml` — no hay ninguno configurado (si no entra, se documenta como trabajo futuro)
- [ ] Alertas: cámara sin `clip_published` N min, `edge_lagging`, `logs_dropped`
- [ ] Evidencias / capturas de observabilidad para el informe

--- 
## Hernán — Frontend React (pantallas, login, visualización) + defensa

- [x] App React + Vite + TS con login (`LoginView`, `AuthContext`, `bffApi.ts`)
- [x] Dashboard con mapa de intersecciones, panel de detalle y gráfico de tráfico (`DashboardView`, `TrafficMap`, `TrafficLineChart`)
- [x] Vista Admin `SystemBackendView` con diagrama de despliegue y polling real a `/api/system/health`
- [x] Modo claro/oscuro
- [x] Consume datos reales de `/api/intersections` y `/history`, con fallback a mocks si el backend está caído
- [x] Logout llama a `POST /logout`
- [x] Rol `Administrador` restringe la vista de sistema
- [~] Estado **"sin datos"**: se muestra la hora del último dato, pero una intersección sin clips en el último minuto no se marca como "sin datos" (se ve como fluida)

--- 
## Joaco R — Mensajería y procesamiento (RabbitMQ, edge-processor, CV)

- [x] Contrato del mensaje en `camera_processing_queue` (README §2.1)
- [x] Claim check: clip en MinIO, metadata por la cola
- [x] `edge-processor`: cámaras simuladas, descarte de frames, downscale, publisher confirms, hilos por zona, `CAMERA_RANGE`
- [x] `cv-module`: worker escalable (`--scale`), ACK manual post-commit, idempotencia por `clip_id`, `DetectorSimulado`
- [x] DLQ nativa (`dlx` + `camera_dlq`)
- [x] Logs JSON a stdout + `logs_queue` asíncronos
- [x] Demos: escalado, worker caído, idempotencia, DLQ, carga (`scripts/`)
- [x] Decisiones D1–D17 (`docs/decisiones-mensajeria.md`), guía de equipo e informe propio en PDF
- [x] Evidencias 02–12 + capturas (`../evidencias/`)

--- 
## Joaco G — Backend (API REST, auth, BD) + pruebas y demo

- [x] `api-rest` como BFF: login/logout/token, `/api/intersections`, `/history`, `/api/cameras`, `/api/system/health`, roles user/admin
- [x] `api-rest` con logs JSON a `logs_queue` (`api-rest/logs.py`) y host desde config
- [x] `auth-service` con sesiones y expiración de tokens en `auth-db`
- [x] `results-db`: tablas `intersections` y `cameras` con seed `int-1..3`, `cam-1..6`
- [x] `visualization-backend`: agregación sobre `results`, CRUD de cámaras e intersecciones
- [x] Decisiones A1–A5 (`docs/decisiones-api-auth-visualizacion.md`)
- [ ] Tabla `metrics` en `results-db` (`init.sql` la menciona pero no existe) — coordinar con Ro
- [ ] Contraseñas en texto plano en `auth-db` (`user123`/`admin123`): hashear o declararlo como simplificación en el informe
- [ ] Correr las demos de `scripts/` sobre el sistema integrado
- [ ] Guion de la demo para la defensa

--- 
## Iago — Informe (arquitectura, diagrama, características SD, uso de IA)

- [ ] Estructura del informe
- [ ] Arquitectura: componentes, puertos, colas y BDs (base: README §1–2)
- [ ] **Diagrama de arquitectura** (frontend → api-rest → auth/visualization → BDs; edge → MinIO + RabbitMQ → cv-module → results-db; logs → monitoring)
- [ ] Características de SD: comunicación, escalabilidad, tolerancia a fallos, concurrencia/consistencia, observabilidad, 12-Factor
- [ ] Integrar el texto de mensajería de Joaco R (`../evidencias/informe-mensajeria.md`) y las evidencias según `../evidencias/INDICE.md`
- [ ] Integrar decisiones de backend (A1–A5) y de observabilidad (cuando Ro las tenga)
- [ ] Trabajo futuro (CV real, store-and-forward, reintentos, retención MinIO, replicación del broker, Prometheus/Jaeger)
- [ ] Sección de uso de IA
- [ ] Pedir a cada integrante sus capturas/resultados finales
