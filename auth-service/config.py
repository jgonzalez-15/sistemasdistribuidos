import os
from dotenv import load_dotenv

load_dotenv()

SERVICE_NAME = os.getenv("SERVICE_NAME", "auth-service")
SERVICE_HOST = os.getenv("SERVICE_HOST", "0.0.0.0")
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8005"))

# Auth DB (PostgreSQL) Configuration
AUTH_DB_HOST = os.getenv("AUTH_DB_HOST", "auth-db")
AUTH_DB_PORT = int(os.getenv("AUTH_DB_PORT", "5432"))
AUTH_DB_NAME = os.getenv("AUTH_DB_NAME", "auth_db")
AUTH_DB_USER = os.getenv("AUTH_DB_USER", "postgres")
AUTH_DB_PASS = os.getenv("AUTH_DB_PASS", "postgres")

# Token / Session Configuration
TOKEN_EXPIRATION_MINUTES = int(os.getenv("TOKEN_EXPIRATION_MINUTES", "30"))

# Logs Queue (RabbitMQ Instance 2)
LOGS_QUEUE_HOST = os.getenv("LOGS_QUEUE_HOST", "logs-queue")
LOGS_QUEUE_PORT = int(os.getenv("LOGS_QUEUE_PORT", "5672"))
LOGS_QUEUE_USER = os.getenv("LOGS_QUEUE_USER", "guest")
LOGS_QUEUE_PASS = os.getenv("LOGS_QUEUE_PASS", "guest")
LOGS_QUEUE_NAME = os.getenv("LOGS_QUEUE_NAME", "logs_queue")

# Peer Service URLs
API_REST_URL = os.getenv("API_REST_URL", "http://api-rest:8000")

# Contraseñas de los usuarios de desarrollo del seed (se guardan hasheadas, ver passwords.py).
# Solo se usan al crear el usuario; cambiarlas después no modifica un usuario existente.
AUTH_SEED_USER_PASSWORD = os.getenv("AUTH_SEED_USER_PASSWORD", "user123")
AUTH_SEED_ADMIN_PASSWORD = os.getenv("AUTH_SEED_ADMIN_PASSWORD", "admin123")
