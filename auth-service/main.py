from fastapi import FastAPI
import pika
import psycopg2
import config

app = FastAPI(title="Auth Service")


def get_auth_db_connection():
    return psycopg2.connect(
        host=config.AUTH_DB_HOST,
        port=config.AUTH_DB_PORT,
        dbname=config.AUTH_DB_NAME,
        user=config.AUTH_DB_USER,
        password=config.AUTH_DB_PASS,
    )


def get_logs_queue_connection():
    credentials = pika.PlainCredentials(config.LOGS_QUEUE_USER, config.LOGS_QUEUE_PASS)
    parameters = pika.ConnectionParameters(
        host=config.LOGS_QUEUE_HOST,
        port=config.LOGS_QUEUE_PORT,
        credentials=credentials,
    )
    return pika.BlockingConnection(parameters)


@app.get("/health")
def health():
    return {"service": config.SERVICE_NAME, "status": "ok", "port": config.SERVICE_PORT}
