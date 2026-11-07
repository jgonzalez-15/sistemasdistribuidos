from fastapi import FastAPI
import pika
import config

app = FastAPI(title="Monitoring Metrics Pipeline")


def get_logs_queue_connection():
    credentials = pika.PlainCredentials(config.LOGS_QUEUE_USER, config.LOGS_QUEUE_PASS)
    parameters = pika.ConnectionParameters(
        host=config.LOGS_QUEUE_HOST,
        port=config.LOGS_QUEUE_PORT,
        credentials=credentials,
    )
    return pika.BlockingConnection(parameters)


def get_camera_queue_connection():
    credentials = pika.PlainCredentials(config.CAMERA_QUEUE_USER, config.CAMERA_QUEUE_PASS)
    parameters = pika.ConnectionParameters(
        host=config.CAMERA_QUEUE_HOST,
        port=config.CAMERA_QUEUE_PORT,
        credentials=credentials,
    )
    return pika.BlockingConnection(parameters)


@app.get("/health")
def health():
    return {"service": config.SERVICE_NAME, "status": "ok", "port": config.SERVICE_PORT}
