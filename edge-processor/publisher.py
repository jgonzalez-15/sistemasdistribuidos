"""Publicación de la metadata de cada clip en camera_processing_queue (RabbitMQ, pika).

Una instancia por hilo: BlockingConnection de pika no es thread-safe.
"""
import json
import time

import pika
import pika.exceptions

import config
from logs import log_event

MAX_CONNECT_WAIT = 30   # tope de la espera entre intentos de conexión (segundos)


class Publisher:
    def __init__(self):
        self.connection = None
        self.channel = None

    def _connect_once(self):
        """Un intento de conexión: abre canal, activa publisher confirms y verifica la cola."""
        credentials = pika.PlainCredentials(config.CAMERA_QUEUE_USER, config.CAMERA_QUEUE_PASS)
        params = pika.ConnectionParameters(
            host=config.CAMERA_QUEUE_HOST,
            port=config.CAMERA_QUEUE_PORT,
            credentials=credentials,
            heartbeat=60,
        )
        self.connection = pika.BlockingConnection(params)
        self.channel = self.connection.channel()
        # Publisher confirms: el broker confirma (ack) cada mensaje que guardó
        self.channel.confirm_delivery()
        # passive=True: solo verifica que la cola exista (la crea definitions.json con su DLQ)
        self.channel.queue_declare(queue=config.CAMERA_QUEUE_NAME, passive=True)

    def connect(self, stop_event=None):
        """Conecta reintentando sin límite, con espera creciente 1, 2, 4... hasta 30 s.

        El broker puede tardar en arrancar (depends_on del compose no espera a que esté listo).
        Si se pasa stop_event y se activa, deja de intentar y devuelve False.
        """
        espera = 1
        intento = 1
        while True:
            try:
                self._connect_once()
                return True
            except (pika.exceptions.AMQPError, OSError) as e:
                log_event("broker_connect_retry", level="WARNING",
                          message=f"No se pudo conectar a RabbitMQ (intento {intento}): {e!r}. "
                                  f"Reintento en {espera} s", attempt=intento)
            if stop_event is not None:
                if stop_event.wait(espera):
                    return False
            else:
                time.sleep(espera)
            espera = min(espera * 2, MAX_CONNECT_WAIT)
            intento += 1

    def publish(self, message: dict) -> bool:
        """Publica el mensaje como dice el contrato. True si el broker lo confirmó."""
        body = json.dumps(message).encode("utf-8")
        props = pika.BasicProperties(
            delivery_mode=2,                    # persistente: sobrevive a un reinicio del broker
            content_type="application/json",
            message_id=message["clip_id"],
        )
        espera = 1
        for intento in range(1, config.PUBLISH_MAX_RETRIES + 1):
            try:
                if self.connection is None or self.connection.is_closed:
                    self._connect_once()
                # Con confirm_delivery, si el broker no confirma pika lanza
                # UnroutableError (no hay cola) o NackError (el broker lo rechazó)
                self.channel.basic_publish(
                    exchange="",
                    routing_key=config.CAMERA_QUEUE_NAME,
                    body=body,
                    properties=props,
                    mandatory=True,
                )
                return True
            except (pika.exceptions.AMQPError, OSError) as e:
                log_event("publish_retry", level="WARNING", trace_id=message["clip_id"],
                          clip_id=message["clip_id"],
                          message=f"Falló la publicación (intento {intento}): {e!r}",
                          attempt=intento)
                self._close_quietly()
                if intento < config.PUBLISH_MAX_RETRIES:
                    time.sleep(espera)
                    espera *= 2
        return False

    def _close_quietly(self):
        """Cierra la conexión si quedó abierta, ignorando errores (para reconectar limpio)."""
        try:
            if self.connection is not None and self.connection.is_open:
                self.connection.close()
        except Exception:
            pass
        self.connection = None
        self.channel = None

    def close(self):
        self._close_quietly()
