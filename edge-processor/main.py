from fastapi import FastAPI
import pika
import boto3
import config

app = FastAPI(title="Edge Processor")


def get_camera_queue_connection():
    credentials = pika.PlainCredentials(config.CAMERA_QUEUE_USER, config.CAMERA_QUEUE_PASS)
    parameters = pika.ConnectionParameters(
        host=config.CAMERA_QUEUE_HOST,
        port=config.CAMERA_QUEUE_PORT,
        credentials=credentials,
    )
    return pika.BlockingConnection(parameters)


def get_logs_queue_connection():
    credentials = pika.PlainCredentials(config.LOGS_QUEUE_USER, config.LOGS_QUEUE_PASS)
    parameters = pika.ConnectionParameters(
        host=config.LOGS_QUEUE_HOST,
        port=config.LOGS_QUEUE_PORT,
        credentials=credentials,
    )
    return pika.BlockingConnection(parameters)


def get_clips_storage_client():
    return boto3.client(
        "s3",
        endpoint_url=config.CLIPS_DB_ENDPOINT,
        aws_access_key_id=config.CLIPS_DB_ACCESS_KEY,
        aws_secret_access_key=config.CLIPS_DB_SECRET_KEY,
    )


@app.get("/health")
def health():
    return {"service": config.SERVICE_NAME, "status": "ok", "port": config.SERVICE_PORT}
