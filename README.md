# Simulated Distributed System — Base Template

Every component in this repository is isolated in its own container and configured via environment variables so it can run locally via `docker-compose.yml` or be separated across different physical/virtual machines simply by updating the host/IP environment variables.

---

## 1. Application Components & Configured Ports

| Component | Directory | Language / Stack | Port | Main Entrypoint & Config |
| :--- | :--- | :--- | :--- | :--- |
| **API REST** | `./api-rest` | Python (FastAPI) | `8000` | `api-rest/main.py`, `api-rest/config.py` |
| **Edge Processor** | `./edge-processor` | Python (FastAPI) | `8001` | `edge-processor/main.py`, `edge-processor/config.py` |
| **Computer Vision Module** | `./cv-module` | Python (FastAPI) | `8002` (solo red interna, sin puerto en el host: se escala con `--scale`) | `cv-module/main.py`, `cv-module/config.py` |
| **Visualization Backend** | `./visualization-backend` | Python (FastAPI) | `8003` | `visualization-backend/main.py`, `visualization-backend/config.py` |
| **Monitoring Metrics Pipeline** | `./monitoring-pipeline` | Python (FastAPI) | `8004` | `monitoring-pipeline/main.py`, `monitoring-pipeline/config.py` |
| **Auth Service** | `./auth-service` | Python (FastAPI) | `8005` | `auth-service/main.py`, `auth-service/config.py` |
| **Frontend** | `./frontend` | React + Vite (TS) | `3000` | `frontend/src/App.tsx`, `frontend/src/config.ts` |

---

## 2. Queues & Databases (All Separated into Dedicated Containers)

- **Camera Processing Queue (`camera-queue` - RabbitMQ Container 1)**:
  - **Ports**: Host `5672` $\rightarrow$ Container `5672` (AMQP), Host `15672` $\rightarrow$ Container `15672` (Management UI — `guest` / `guest`)
  - **Pre-configured Queue** (in `infrastructure/camera-queue/definitions.json`): `camera_processing_queue`
  - **Dead-letter queue:** `camera_processing_queue` tiene `x-dead-letter-exchange: dlx`. El exchange `dlx` (fanout) entrega a la cola `camera_dlq`. Un mensaje rechazado con `basic_nack(requeue=False)`, o que vence por TTL, termina en `camera_dlq` con el header `x-death` (motivo y cola de origen).
  - **Si cambiás `definitions.json`**, recreá el broker sin su volumen; si no, queda la topología vieja: `docker compose rm -sfv camera-queue && docker compose up -d camera-queue`. Si al arrancar falla con `.erlang.cookie: eacces`, repetí el mismo comando.
  - Los servicios **no declaran** estas colas con argumentos propios (usan `queue_declare(passive=True)`): la topología vive solo en `definitions.json`.
- **Logs Queue (`logs-queue` - RabbitMQ Container 2)**:
  - **Ports**: Host `5673` $\rightarrow$ Container `5672` (AMQP), Host `15673` $\rightarrow$ Container `15672` (Management UI — `guest` / `guest`)
  - **Pre-configured Queue** (in `infrastructure/logs-queue/definitions.json`): `logs_queue`
- **Auth Database (`auth-db` - PostgreSQL 16)**:
  - **Ports**: Host `5433` $\rightarrow$ Container `5432`
  - **Database / Credentials**: `auth_db` (`postgres` / `postgres`)
  - **Init Script**: `infrastructure/auth-db/init.sql` (`users` table with `username` and `password`)
- **Results Database (`results-db` - PostgreSQL 16)**:
  - **Ports**: Host `5434` $\rightarrow$ Container `5432`
  - **Database / Credentials**: `results_db` (`postgres` / `postgres`)
  - **Init Script**: `infrastructure/results-db/init.sql` (skeleton ready for your schema)
- **Clips Database (`clips-db` - MinIO S3 Object Storage)**:
  - **Ports**: `9000` (S3 API), `9001` (Web Console — default credentials: `minioadmin` / `minioadmin`)
  - Automatically initializes the `clips` bucket directory on startup.

---

## 2.1 Contrato del mensaje en `camera_processing_queue`

El `edge-processor` publica **un mensaje por clip** y el `cv-module` lo consume. El clip en sí no viaja por la cola: se guarda en MinIO (bucket `clips`), y el mensaje solo lleva la metadata y la clave del objeto (patrón *claim check*).

**Cuerpo** (JSON en UTF-8, un objeto por mensaje):

| Campo | Tipo | Descripción |
| :--- | :--- | :--- |
| `clip_id` | string (UUID v4) | Identificador único del clip. Es la **clave de idempotencia**: la entrega es *at-least-once*, así que el mismo `clip_id` puede llegar más de una vez y el resultado se guarda una sola vez. |
| `trace_id` | string | Igual a `clip_id`. Sirve para seguir el clip en los logs de todos los servicios. |
| `camera_id` | string | ID de la cámara (ej. `cam-1`). Tiene que existir en la tabla `cameras`. |
| `intersection_id` | string | ID de la intersección (ej. `int-1`). Tiene que existir en la tabla `intersections`. |
| `timestamp` | string (ISO 8601, UTC, sufijo `Z`) | Momento de captura del clip, no de publicación. |
| `object_key` | string | Clave del clip en el bucket `CLIPS_BUCKET_NAME`, con formato `{camera_id}/{clip_id}.npy`. El nombre del bucket sale de la configuración, no del mensaje. |
| `frames` | int | Cantidad de frames del clip, después de descartar los que no cambiaron. |
| `shape` | [int, int] | `[alto, ancho]` de cada frame, después de reducir la resolución. |

El objeto `.npy` es un único arreglo NumPy `uint8` con forma `(frames, alto, ancho)`.

Ejemplo:

```json
{
  "clip_id": "3f2b8c1e-9a4d-4e7b-8f10-2c6d5a9e1b07",
  "trace_id": "3f2b8c1e-9a4d-4e7b-8f10-2c6d5a9e1b07",
  "camera_id": "cam-1",
  "intersection_id": "int-1",
  "timestamp": "2026-11-15T14:03:22.123Z",
  "object_key": "cam-1/3f2b8c1e-9a4d-4e7b-8f10-2c6d5a9e1b07.npy",
  "frames": 8,
  "shape": [120, 160]
}
```

**Publicación:** default exchange (`""`) con `routing_key = camera_processing_queue`.

**Propiedades AMQP:**

| Propiedad | Valor | Para qué |
| :--- | :--- | :--- |
| `delivery_mode` | `2` | Mensaje persistente. Junto con la cola `durable`, sobrevive a un reinicio del broker. |
| `content_type` | `application/json` | Indica cómo decodificar el cuerpo. |
| `message_id` | `clip_id` | Permite ver el clip en el panel de RabbitMQ y en la DLQ sin abrir el cuerpo. |

**Consumo:** ACK manual. El worker confirma recién después de guardar el resultado.

## 2.2 Edge y worker: configuración

**`edge-processor`** simula cámaras: genera clips con NumPy, descarta los frames sin cambios, reduce la resolución, sube el `.npy` a MinIO y publica la metadata con *publisher confirms*.

| Variable | Default | Para qué |
| :--- | :--- | :--- |
| `CAMERA_IDS` | `cam-1:int-1,…,cam-6:int-3` | Cámaras de esta instancia (`camara:interseccion`). Una instancia por zona. |
| `CAMERA_RANGE` | vacío | Por ejemplo `101-300`: genera `cam-101…cam-300` con 2 cámaras por intersección (`int-((N+1)/2)`). Si tiene valor, reemplaza a `CAMERA_IDS`. |
| `FRAME_INTERVAL` | `5` | Segundos entre clips de una misma cámara. |
| `EDGE_THREADS` | `4` | Hilos por instancia; cada uno tiene su conexión y su grupo de cámaras. |
| `FRAMES_PER_CLIP`, `FRAME_HEIGHT`, `FRAME_WIDTH`, `DOWNSCALE`, `DIFF_THRESHOLD`, `PUBLISH_MAX_RETRIES` | `10`, `240`, `320`, `2`, `2.0`, `4` | Simulación y preprocesamiento. |

Para sumar otra zona sin tocar el compose (otra instancia de edge con sus propias cámaras):
```bash
docker compose run -d -e CAMERA_RANGE=101-200 edge-processor
```

**`cv-module`** consume con `prefetch_count=1` y ACK manual, cuenta vehículos con `DetectorSimulado` (`scipy.ndimage.label`; mediana de los conteos por frame), guarda con `INSERT … ON CONFLICT (clip_id) DO NOTHING` y recién ahí hace ACK. Si algo falla, hace `nack(requeue=False)` y el mensaje va a `camera_dlq`.

| Variable | Default | Para qué |
| :--- | :--- | :--- |
| `DETECTION_THRESHOLD` | `128` | Umbral de brillo para binarizar el frame. |
| `MIN_BLOB_AREA` | `4` | Descarta manchas chicas (ruido). |
| `PROCESSING_DELAY_MS` | `0` | Demora artificial por clip, **solo para la demo de escalado**. Representa el costo de un modelo real. |

**Eventos de log** (JSON en una línea, a stdout): `clip_published`, `clip_processed`, `clip_failed`, `clip_dead_lettered`, `worker_started`, `worker_stopped`, `edge_lagging`, `broker_connect_retry`, `publish_retry` y `worker_reconnecting`.

> Si el puerto 8001 del host está ocupado: `EDGE_PROCESSOR_PORT=18001 docker compose up -d`.

---

## 3. How to Run

### Run Locally (All-in-One via Docker Compose)
1. **Prerequisites**: Only **Docker** and **Docker Compose** are required on the host machine (all Python dependencies and Node packages are installed inside each container's `Dockerfile`).
2. **Start the entire system**:
   ```bash
   docker compose up --build
   ```
3. **Escalar los workers de CV** (competing consumers sobre `camera_processing_queue`):
   ```bash
   docker compose up -d --scale cv-module=3
   ```
   `cv-module` no publica puerto en el host. Para consultar el `/health` de una réplica:
   ```bash
   docker compose exec --index 2 cv-module python -c "import urllib.request;print(urllib.request.urlopen('http://localhost:8002/health').read().decode())"
   ```
4. **Stop the system**:
   ```bash
   docker compose down
   ```

### Separating Components onto Different Computers
- Each component directory has its own `Dockerfile` and `.env.example`.
- Copy the component folder to another machine, copy `.env.example` to `.env`, and replace the container hostnames (e.g., `camera-queue`, `logs-queue`, `auth-db`, `results-db`, `clips-db`, `api-rest`) with the IP addresses or domain names of the machines running those services.
- Build and run the individual container on that machine:
  ```bash
  docker build -t <service-name> .
  docker run --env-file .env -p <port>:<port> <service-name>
  ```
