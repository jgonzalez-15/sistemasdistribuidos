# Simulated Distributed System — Base Template

Every component in this repository is isolated in its own container and configured via environment variables so it can run locally via `docker-compose.yml` or be separated across different physical/virtual machines simply by updating the host/IP environment variables.

---

## 1. Application Components & Configured Ports

| Component | Directory | Language / Stack | Port | Main Entrypoint & Config |
| :--- | :--- | :--- | :--- | :--- |
| **API REST** | `./api-rest` | Python (FastAPI) | `8000` | `api-rest/main.py`, `api-rest/config.py` |
| **Edge Processor** | `./edge-processor` | Python (FastAPI) | `8001` | `edge-processor/main.py`, `edge-processor/config.py` |
| **Computer Vision Module** | `./cv-module` | Python (FastAPI) | `8002` | `cv-module/main.py`, `cv-module/config.py` |
| **Visualization Backend** | `./visualization-backend` | Python (FastAPI) | `8003` | `visualization-backend/main.py`, `visualization-backend/config.py` |
| **Monitoring Metrics Pipeline** | `./monitoring-pipeline` | Python (FastAPI) | `8004` | `monitoring-pipeline/main.py`, `monitoring-pipeline/config.py` |
| **Auth Service** | `./auth-service` | Python (FastAPI) | `8005` | `auth-service/main.py`, `auth-service/config.py` |
| **Frontend** | `./frontend` | React + Vite (TS) | `3000` | `frontend/src/App.tsx`, `frontend/src/config.ts` |

---

## 2. Queues & Databases (All Separated into Dedicated Containers)

- **Camera Processing Queue (`camera-queue` - RabbitMQ Container 1)**:
  - **Ports**: Host `5672` $\rightarrow$ Container `5672` (AMQP), Host `15672` $\rightarrow$ Container `15672` (Management UI — `guest` / `guest`)
  - **Pre-configured Queue** (in `infrastructure/camera-queue/definitions.json`): `camera_processing_queue`
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

## 3. How to Run

### Run Locally (All-in-One via Docker Compose)
1. **Prerequisites**: Only **Docker** and **Docker Compose** are required on the host machine (all Python dependencies and Node packages are installed inside each container's `Dockerfile`).
2. **Start the entire system**:
   ```bash
   docker compose up --build
   ```
3. **Stop the system**:
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
