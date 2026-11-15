# Decisiones de diseño: API REST (BFF), Auth Service y Visualization Backend

Alcance: `api-rest`, `auth-service`, `auth-db`, `visualization-backend`, `results-db` y su integración con `frontend` y `logs-queue`.

---

## 1. Resumen de cambios implementados

| Componente | Archivo(s) | Cambio principal |
| :--- | :--- | :--- |
| **API REST (BFF)** | `api-rest/logs.py`, `api-rest/main.py` | Logs JSON estandarizados y asíncronos hacia `logs_queue`; soporte de `Authorization: Bearer <token>` y cuerpo JSON; endpoints `/api/intersections`, `/api/intersections/{id}/history`, `/api/cameras`, `/api/system/health`, `/`, `/login`, `/logout`, `/token/state`, `/token/refresh`. |
| **Auth Service** | `auth-service/main.py` | Acepta `user` o `username` en `/login`, devuelve `access_token` además de `token` para compatibilidad con el frontend, y agrega `GET /` para chequeo de estado. |
| **Results DB** | `infrastructure/results-db/init.sql` | Agrega tablas `intersections` y `cameras` (PK de texto `int-N`, `cam-N` según D4) con seed inicial de Montevideo (`int-1`..`int-3`, `cam-1`..`cam-6`) alineado con `edge-processor`. |
| **Visualization Backend** | `visualization-backend/db.py`, `visualization-backend/main.py` | Consulta `results`, `intersections` y `cameras` en `results-db` y devuelve `IntersectionSummary[]` y `IntersectionAnalyticsDetail` en el formato exacto que espera el frontend; expone CRUD de cámaras e intersecciones. |
| **Frontend (BFF Client)** | `frontend/src/services/bffApi.ts`, `frontend/src/context/AuthContext.tsx` | Consume los datos reales devueltos por `/api/intersections` y `/api/intersections/{id}/history` cuando el backend responde, y llama a `POST /logout` al cerrar sesión. |

---

## 2. Decisiones de diseño

### A1. Logs estructurados en JSON con envío asíncrono (`api-rest/logs.py`)
- **Qué se decidió:** Reemplazar el log en texto plano y síncrono por `logs.py`, idéntico en contrato y mecanismo al de `edge-processor` y `cv-module`: una línea JSON por evento a `stdout` y publicación asíncrona en `logs_queue` desde un hilo daemon (`log-shipper`) con buffer acotado en memoria (`10 000` registros).
- **Por qué:** `monitoring-pipeline` consumirá `logs_queue` esperando un único formato JSON (`ts`, `service`, `level`, `event`, `trace_id`, `message`, y campos extra). Además, si `logs-queue` cae, el API REST no puede bloquear ni fallar las peticiones del usuario.
- **Cómo se diferencia cada sesión:** Se incluye `session_id` en el registro y se lo usa como `trace_id` por defecto cuando existe una sesión activa, permitiendo rastrear cada conexión concurrente aunque compartan credenciales (`user` o `admin`).

### A2. Compatibilidad dual de tokens: `Authorization: Bearer` y cuerpo JSON
- **Qué se decidió:** `verify_access`, `/logout`, `/token/state`, `/token/refresh` y los endpoints `/visualization/*` aceptan el token tanto por cabecera `Authorization: Bearer <token>` como por el campo `token` en el cuerpo JSON.
- **Por qué:** El frontend (`bffApi.ts`) envía peticiones `GET` con `Authorization: Bearer <token>`, mientras que las pruebas directas o plantillas `POST` pueden enviar `{ "token": "..." }`.
- **Trade-off aceptado:** Ligera flexibilidad adicional en la firma de los endpoints `POST` de autenticación a cambio de cero fricción entre el frontend y llamadas programáticas.

### A3. Alineación de `/login` con el contrato del Frontend (`access_token` y alias `username`)
- **Qué se decidió:** `LoginBody` acepta tanto `user` como `username`, y la respuesta de `/login` incluye `access_token` (mismo valor que `token`) y `username` (mismo valor que `user`), además de `session_id`, `role` y `expires_at`. `normalize_role` trata `'admin'` / `'Administrador'` como nivel administrador y `'user'` / `'Operador'` como usuario estándar.
- **Por qué:** `bffApi.ts` valida la presencia de `data.access_token` para considerar el login real exitoso; sin ese campo, caía al token JWT simulado.

### A4. Agregación de datos en `visualization-backend` sobre `results-db`
- **Qué se decidió:**
  - `GET /intersections` toma la última lectura por cámara (`DISTINCT ON (intersection_id, camera_id) ... ORDER BY ts DESC`) y suma los vehículos de las cámaras activas de cada intersección.
  - `GET /intersections/{id}/history` agrupa las lecturas por minuto (`date_trunc('minute', ts)`) tomando el último valor de cada cámara en ese minuto y devolviendo los últimos `limit` puntos (por defecto 14, igual que la gráfica del frontend).
  - Los umbrales de congestión (`>= 75` congestionado, `>= 40` moderado, `< 40` fluido) y el cálculo de velocidad promedio estimada y métricas (`peakHour`, `peakVehicles`, `avgVehiclesLast6h`, `patternType`) replican la lógica esperada por `IntersectionAnalyticsDetail`.
- **Por qué:** Mantiene `cv-module` desacoplado (solo inserta filas por clip en `results`) y centraliza la lógica de presentación y agregación en `visualization-backend`.
- **Idempotencia de esquema:** `visualization-backend/db.py` ejecuta `CREATE TABLE IF NOT EXISTS` y `INSERT ... ON CONFLICT DO NOTHING` al iniciar, de modo que funciona incluso si el volumen de `results-db` ya existía antes de actualizar `init.sql`.

### A5. Conexión del Frontend con datos reales y fallback controlado
- **Qué se decidió:** Actualizar `fetchIntersectionsFromBff` y `fetchIntersectionAnalyticsFromBff` en `bffApi.ts` para devolver la respuesta real del backend cuando `api-rest` responde `200 OK`, manteniendo el fallback a mocks si el backend está apagado, y conectar `logout()` en `AuthContext.tsx` con `POST /logout`.
- **Por qué:** Permite evaluar el flujo completo end-to-end (`frontend` → `api-rest` → `auth-service`/`visualization-backend` → `auth-db`/`results-db`) sin romper la evaluación standalone del frontend.

---

## 3. Mapa de endpoints de `api-rest` (`:8000`)

| Método y Ruta | Acceso | Descripción | Destino |
| :--- | :--- | :--- | :--- |
| `GET /` | Público | Ping de disponibilidad (usado por `LoginView`). | Local |
| `GET /health` | Público | Estado del servicio `api-rest`. | Local |
| `POST /login` | Público | Autentica credenciales y crea `session_id` + token. | `auth-service` |
| `POST /logout` | Token (Header/Body) | Invalida la sesión específica en `auth-db`. | `auth-service` |
| `GET / POST /token/state` | Token | Consulta validez/tiempo restante (y refresca si `refresh=true`). | `auth-service` |
| `POST /token/refresh` | Token | Refresca la expiración del token actual. | `auth-service` |
| `GET /api/intersections` | User / Admin | Resumen actual de intersecciones y conteos desde `results-db`. | `visualization-backend` |
| `GET /api/intersections/{id}/history` | User / Admin | Serie temporal y métricas analíticas de una intersección. | `visualization-backend` |
| `GET /api/cameras` | User / Admin | Lista cámaras registradas en `results-db`. | `visualization-backend` |
| `POST /api/cameras` | Admin | Registra o actualiza una cámara (`cam-N` → `int-N`). | `visualization-backend` |
| `POST /api/intersections` | Admin | Registra o actualiza una intersección (`int-N`). | `visualization-backend` |
| `GET /api/system/health` | Admin | Consulta `/health` de todos los microservicios backend. | Todos los servicios |
| `POST /visualization/user` | User / Admin | Plantilla genérica (`GET`/`POST`/`PUT`/`PATCH`/`DELETE`) hacia `visualization-backend`. | `visualization-backend` |
| `POST /visualization/admin` | Admin | Plantilla genérica solo para administradores hacia `visualization-backend`. | `visualization-backend` |
