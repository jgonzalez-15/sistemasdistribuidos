import os
from dotenv import load_dotenv

load_dotenv()

SERVICE_NAME = os.getenv("SERVICE_NAME", "cv-module")
SERVICE_HOST = os.getenv("SERVICE_HOST", "0.0.0.0")
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8002"))

# Camera Processing Queue (RabbitMQ Instance 1)
CAMERA_QUEUE_HOST = os.getenv("CAMERA_QUEUE_HOST", "camera-queue")
CAMERA_QUEUE_PORT = int(os.getenv("CAMERA_QUEUE_PORT", "5672"))
CAMERA_QUEUE_USER = os.getenv("CAMERA_QUEUE_USER", "guest")
CAMERA_QUEUE_PASS = os.getenv("CAMERA_QUEUE_PASS", "guest")
CAMERA_QUEUE_NAME = os.getenv("CAMERA_QUEUE_NAME", "camera_processing_queue")

# Logs Queue (RabbitMQ Instance 2)
LOGS_QUEUE_HOST = os.getenv("LOGS_QUEUE_HOST", "logs-queue")
LOGS_QUEUE_PORT = int(os.getenv("LOGS_QUEUE_PORT", "5672"))
LOGS_QUEUE_USER = os.getenv("LOGS_QUEUE_USER", "guest")
LOGS_QUEUE_PASS = os.getenv("LOGS_QUEUE_PASS", "guest")
LOGS_QUEUE_NAME = os.getenv("LOGS_QUEUE_NAME", "logs_queue")

# Results DB (PostgreSQL) Configuration
RESULTS_DB_HOST = os.getenv("RESULTS_DB_HOST", "results-db")
RESULTS_DB_PORT = int(os.getenv("RESULTS_DB_PORT", "5432"))
RESULTS_DB_NAME = os.getenv("RESULTS_DB_NAME", "results_db")
RESULTS_DB_USER = os.getenv("RESULTS_DB_USER", "postgres")
RESULTS_DB_PASS = os.getenv("RESULTS_DB_PASS", "postgres")

# Clips DB (MinIO / S3 Object Storage) Configuration
CLIPS_DB_ENDPOINT = os.getenv("CLIPS_DB_ENDPOINT", "http://clips-db:9000")
CLIPS_DB_ACCESS_KEY = os.getenv("CLIPS_DB_ACCESS_KEY", "minioadmin")
CLIPS_DB_SECRET_KEY = os.getenv("CLIPS_DB_SECRET_KEY", "minioadmin")
CLIPS_BUCKET_NAME = os.getenv("CLIPS_BUCKET_NAME", "clips")

# Peer Service URLs
EDGE_PROCESSOR_URL = os.getenv("EDGE_PROCESSOR_URL", "http://edge-processor:8001")
VISUALIZATION_BACKEND_URL = os.getenv("VISUALIZATION_BACKEND_URL", "http://visualization-backend:8003")
API_REST_URL = os.getenv("API_REST_URL", "http://api-rest:8000")

# Detector simulado (CV): un píxel con valor > DETECTION_THRESHOLD se considera "vehículo",
# y se descartan las manchas con menos de MIN_BLOB_AREA píxeles (ruido).
DETECTION_THRESHOLD = int(os.getenv("DETECTION_THRESHOLD", "128"))
MIN_BLOB_AREA = int(os.getenv("MIN_BLOB_AREA", "4"))

# Demora artificial (milisegundos) por clip, solo para las demos: con 0 el worker procesa tan rápido
# que la cola nunca se llena; con, por ejemplo, 2000 se ve cómo la cola baja más rápido al pasar
# de 1 a 3 réplicas (`docker compose up --scale cv-module=3`). En uso normal dejarla en 0.
# Debe quedar bastante por debajo del heartbeat de RabbitMQ (60 s), porque durante la espera
# el hilo no atiende la conexión.
PROCESSING_DELAY_MS = int(os.getenv("PROCESSING_DELAY_MS", "0"))
