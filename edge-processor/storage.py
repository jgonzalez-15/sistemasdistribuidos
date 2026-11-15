"""Subida de clips a MinIO (compatible con S3) usando boto3."""
import io

import boto3
import numpy as np

import config


class ClipStorage:
    """Cliente de MinIO. Cada hilo crea el suyo (no se comparte entre hilos)."""

    def __init__(self):
        self.client = boto3.client(
            "s3",
            endpoint_url=config.CLIPS_DB_ENDPOINT,
            aws_access_key_id=config.CLIPS_DB_ACCESS_KEY,
            aws_secret_access_key=config.CLIPS_DB_SECRET_KEY,
            region_name="us-east-1",
        )

    def upload_clip(self, key, array):
        """Guarda el arreglo como .npy en memoria y lo sube al bucket de clips."""
        buffer = io.BytesIO()
        np.save(buffer, array)
        self.client.put_object(Bucket=config.CLIPS_BUCKET_NAME, Key=key, Body=buffer.getvalue())
