from fastapi import FastAPI
import pika
import boto3
import psycopg2
import config

app = FastAPI(title="Visualization Backend")


def get_logs_queue_connection():
    credentials = pika.PlainCredentials(config.LOGS_QUEUE_USER, config.LOGS_QUEUE_PASS)
    parameters = pika.ConnectionParameters(
        host=config.LOGS_QUEUE_HOST,
        port=config.LOGS_QUEUE_PORT,
        credentials=credentials,
    )
    return pika.BlockingConnection(parameters)


def get_results_db_connection():
    return psycopg2.connect(
        host=config.RESULTS_DB_HOST,
        port=config.RESULTS_DB_PORT,
        dbname=config.RESULTS_DB_NAME,
        user=config.RESULTS_DB_USER,
        password=config.RESULTS_DB_PASS,
    )


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
