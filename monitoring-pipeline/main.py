import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI

import agregador
import config
import loki
import observability
from consumer import Consumer

consumer = None
parar = threading.Event()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Al arrancar: consumidor de logs_queue y los hilos de Loki y metrics-db; FastAPI queda para /health y /metrics.
    global consumer
    loki.iniciar(parar)
    agregador.iniciar(parar)
    consumer = Consumer()
    consumer.start()
    yield
    # Al apagar (SIGTERM): apagado ordenado y último envío de lo pendiente.
    consumer.stop()
    consumer.join(timeout=10)
    parar.set()
    loki.flush()


app = FastAPI(title="Monitoring Metrics Pipeline", lifespan=lifespan)
observability.setup(app)                         # GET /metrics + RED de HTTP


@app.get("/health")
def health():
    return {
        "service": config.SERVICE_NAME,
        "status": "ok",
        "port": config.SERVICE_PORT,
        "consuming": consumer is not None and consumer.consuming,
        "loki_enabled": loki.habilitado(),
    }
