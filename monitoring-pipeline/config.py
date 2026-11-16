import os
from dotenv import load_dotenv

load_dotenv()

SERVICE_NAME = os.getenv("SERVICE_NAME", "monitoring-pipeline")
SERVICE_HOST = os.getenv("SERVICE_HOST", "0.0.0.0")
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8004"))

# Logs Queue (RabbitMQ Instance 2)
LOGS_QUEUE_HOST = os.getenv("LOGS_QUEUE_HOST", "logs-queue")
LOGS_QUEUE_PORT = int(os.getenv("LOGS_QUEUE_PORT", "5672"))
LOGS_QUEUE_USER = os.getenv("LOGS_QUEUE_USER", "guest")
LOGS_QUEUE_PASS = os.getenv("LOGS_QUEUE_PASS", "guest")
LOGS_QUEUE_NAME = os.getenv("LOGS_QUEUE_NAME", "logs_queue")

# Camera Processing Queue (RabbitMQ Instance 1)
CAMERA_QUEUE_HOST = os.getenv("CAMERA_QUEUE_HOST", "camera-queue")
CAMERA_QUEUE_PORT = int(os.getenv("CAMERA_QUEUE_PORT", "5672"))
CAMERA_QUEUE_USER = os.getenv("CAMERA_QUEUE_USER", "guest")
CAMERA_QUEUE_PASS = os.getenv("CAMERA_QUEUE_PASS", "guest")
CAMERA_QUEUE_NAME = os.getenv("CAMERA_QUEUE_NAME", "camera_processing_queue")

# Peer Service URLs
EDGE_PROCESSOR_URL = os.getenv("EDGE_PROCESSOR_URL", "http://edge-processor:8001")
CV_MODULE_URL = os.getenv("CV_MODULE_URL", "http://cv-module:8002")
VISUALIZATION_BACKEND_URL = os.getenv("VISUALIZATION_BACKEND_URL", "http://visualization-backend:8003")
API_REST_URL = os.getenv("API_REST_URL", "http://api-rest:8000")
AUTH_SERVICE_URL = os.getenv("AUTH_SERVICE_URL", "http://auth-service:8005")

# ---- Observabilidad: destino de los logs y agregados (O16–O18) ----
# Loki (perfil observability). Vacío = no se envía; el consumo de logs_queue sigue igual.
LOKI_URL = os.getenv("LOKI_URL", "http://loki:3100")
LOKI_BATCH_SIZE = int(os.getenv("LOKI_BATCH_SIZE", "500"))         # registros por push
LOKI_BATCH_WAIT_S = float(os.getenv("LOKI_BATCH_WAIT_S", "1"))     # espera máxima entre pushes
LOKI_BUFFER_MAX = int(os.getenv("LOKI_BUFFER_MAX", "20000"))       # tope del buffer en memoria (best-effort)
PIPELINE_PREFETCH = int(os.getenv("PIPELINE_PREFETCH", "500"))

# Metrics DB (PostgreSQL metrics-db): agregados por minuto. Vacío = no se guardan.
METRICS_DB_HOST = os.getenv("METRICS_DB_HOST", "metrics-db")
METRICS_DB_PORT = int(os.getenv("METRICS_DB_PORT", "5432"))
METRICS_DB_NAME = os.getenv("METRICS_DB_NAME", "metrics_db")
METRICS_DB_USER = os.getenv("METRICS_DB_USER", "postgres")
METRICS_DB_PASS = os.getenv("METRICS_DB_PASS", "postgres")
METRICS_DB_FLUSH_S = float(os.getenv("METRICS_DB_FLUSH_S", "15"))
