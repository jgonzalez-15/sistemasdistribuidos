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
