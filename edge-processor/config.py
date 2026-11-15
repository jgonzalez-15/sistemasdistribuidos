import os
from dotenv import load_dotenv

load_dotenv()

SERVICE_NAME = os.getenv("SERVICE_NAME", "edge-processor")
SERVICE_HOST = os.getenv("SERVICE_HOST", "0.0.0.0")
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8001"))

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

# Clips DB (MinIO / S3 Object Storage) Configuration
CLIPS_DB_ENDPOINT = os.getenv("CLIPS_DB_ENDPOINT", "http://clips-db:9000")
CLIPS_DB_ACCESS_KEY = os.getenv("CLIPS_DB_ACCESS_KEY", "minioadmin")
CLIPS_DB_SECRET_KEY = os.getenv("CLIPS_DB_SECRET_KEY", "minioadmin")
CLIPS_BUCKET_NAME = os.getenv("CLIPS_BUCKET_NAME", "clips")

# Simulación de cámaras del edge
# Formato "camara:interseccion,camara:interseccion,..."
CAMERA_IDS = os.getenv(
    "CAMERA_IDS",
    "cam-1:int-1,cam-2:int-1,cam-3:int-2,cam-4:int-2,cam-5:int-3,cam-6:int-3",
)
# Si no está vacío (ej. "101-300"), reemplaza a CAMERA_IDS y genera cam-N
# con 2 cámaras por intersección: int-((N+1)//2)
CAMERA_RANGE = os.getenv("CAMERA_RANGE", "")

FRAME_INTERVAL = float(os.getenv("FRAME_INTERVAL", "5"))       # segundos entre clips de una cámara
FRAMES_PER_CLIP = int(os.getenv("FRAMES_PER_CLIP", "10"))
FRAME_HEIGHT = int(os.getenv("FRAME_HEIGHT", "240"))
FRAME_WIDTH = int(os.getenv("FRAME_WIDTH", "320"))
DOWNSCALE = int(os.getenv("DOWNSCALE", "2"))                   # factor de reducción de resolución
DIFF_THRESHOLD = float(os.getenv("DIFF_THRESHOLD", "2.0"))     # diferencia media mínima para conservar un frame
EDGE_THREADS = int(os.getenv("EDGE_THREADS", "4"))
PUBLISH_MAX_RETRIES = int(os.getenv("PUBLISH_MAX_RETRIES", "4"))


def parse_cameras():
    """Devuelve la lista de cámaras a simular como [(camera_id, intersection_id), ...]."""
    if CAMERA_RANGE.strip():
        inicio, fin = CAMERA_RANGE.strip().split("-")
        return [(f"cam-{n}", f"int-{(n + 1) // 2}") for n in range(int(inicio), int(fin) + 1)]

    cameras = []
    for par in CAMERA_IDS.split(","):
        par = par.strip()
        if not par:
            continue
        camera_id, intersection_id = par.split(":")
        cameras.append((camera_id.strip(), intersection_id.strip()))
    return cameras


# Peer Service URLs
CV_MODULE_URL = os.getenv("CV_MODULE_URL", "http://cv-module:8002")
API_REST_URL = os.getenv("API_REST_URL", "http://api-rest:8000")
