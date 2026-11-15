import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI

import config
import logs
from edge import run_edge_threads

stop_event = threading.Event()
threads = []


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Al arrancar: lanzar los hilos que simulan las cámaras
    threads.extend(run_edge_threads(stop_event))
    yield
    # Al apagar: avisar a los hilos y esperarlos un momento
    stop_event.set()
    for t in threads:
        t.join(timeout=5)
    logs.flush()        # publicar en logs_queue los últimos eventos (worker_stopped)


app = FastAPI(title="Edge Processor", lifespan=lifespan)


@app.get("/health")
def health():
    return {
        "service": config.SERVICE_NAME,
        "status": "ok",
        "port": config.SERVICE_PORT,
        "threads_alive": sum(1 for t in threads if t.is_alive()),
        "threads_total": len(threads),
        "cameras": len(config.parse_cameras()),
    }
