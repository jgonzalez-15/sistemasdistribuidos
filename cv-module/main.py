from contextlib import asynccontextmanager

from fastapi import FastAPI

import config
import logs
import observability
from worker import Worker

worker = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Al arrancar: el consumidor corre en un hilo de fondo, FastAPI queda libre para /health.
    global worker
    worker = Worker()
    worker.start()
    yield
    # Al apagar (docker stop manda SIGTERM → uvicorn → acá): apagado ordenado del worker.
    worker.stop()
    worker.join(timeout=10)
    logs.flush()        # publicar en logs_queue los últimos eventos (worker_stopped)


app = FastAPI(title="Computer Vision Module", lifespan=lifespan)
observability.setup(app)                         # GET /metrics + RED de HTTP


@app.get("/health")
def health():
    return {
        "service": config.SERVICE_NAME,
        "status": "ok",
        "port": config.SERVICE_PORT,
        "worker_alive": worker is not None and worker.is_alive(),
        "consuming": worker is not None and worker.consuming,
        "processed_by": worker.processed_by if worker is not None else None,
    }
