"""Lectura de clips desde MinIO (API S3) con boto3.

Patrón claim check: la cola trae solo la metadata y la clave (`object_key`); el clip en sí
se baja de acá.
"""
from io import BytesIO

import boto3
import numpy as np

import config

_s3 = boto3.client(
    "s3",
    endpoint_url=config.CLIPS_DB_ENDPOINT,
    aws_access_key_id=config.CLIPS_DB_ACCESS_KEY,
    aws_secret_access_key=config.CLIPS_DB_SECRET_KEY,
    region_name="us-east-1",
)


def cargar_clip(datos: bytes) -> np.ndarray:
    """Convierte los bytes de un .npy en un arreglo y valida su forma (frames, alto, ancho) uint8."""
    # allow_pickle=False: un .npy con objetos Python podría ejecutar código al cargarse.
    clip = np.load(BytesIO(datos), allow_pickle=False)
    if clip.ndim != 3:
        raise ValueError(f"el clip debe tener 3 dimensiones (frames, alto, ancho) y tiene {clip.ndim}")
    if clip.dtype != np.uint8:
        raise ValueError(f"el clip debe ser uint8 y es {clip.dtype}")
    return clip


def download_clip(key: str) -> np.ndarray:
    """Baja el clip `key` del bucket de clips y lo devuelve como arreglo NumPy."""
    respuesta = _s3.get_object(Bucket=config.CLIPS_BUCKET_NAME, Key=key)
    return cargar_clip(respuesta["Body"].read())
