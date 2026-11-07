import os
from dotenv import load_dotenv

load_dotenv()

SERVICE_NAME = os.getenv("SERVICE_NAME", "api-rest")
SERVICE_HOST = os.getenv("SERVICE_HOST", "0.0.0.0")
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8000"))

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
AUTH_SERVICE_URL = os.getenv("AUTH_SERVICE_URL", "http://auth-service:8005")
EDGE_PROCESSOR_URL = os.getenv("EDGE_PROCESSOR_URL", "http://edge-processor:8001")
CV_MODULE_URL = os.getenv("CV_MODULE_URL", "http://cv-module:8002")
VISUALIZATION_BACKEND_URL = os.getenv("VISUALIZATION_BACKEND_URL", "http://visualization-backend:8003")
MONITORING_PIPELINE_URL = os.getenv("MONITORING_PIPELINE_URL", "http://monitoring-pipeline:8004")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
