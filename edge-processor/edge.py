"""Lógica del edge: hilos que simulan cámaras, preprocesan, suben a MinIO y publican la metadata."""
import threading
import time
import uuid

import config
from logs import log_event, now_iso
from preprocess import preprocess
from publisher import Publisher
from simulator import CameraSimulator
from storage import ClipStorage


def process_clip(camera_id, intersection_id, simulator, storage, publisher):
    """Genera, preprocesa, sube y publica un clip de una cámara."""
    clip_id = str(uuid.uuid4())
    t0 = time.monotonic()
    timestamp = now_iso()                       # momento de captura del clip

    frames = simulator.generate_clip()
    frames = preprocess(frames)
    key = f"{camera_id}/{clip_id}.npy"

    # 1) Claim check: el clip va a MinIO y por la cola viaja solo la referencia
    try:
        storage.upload_clip(key, frames)
    except Exception as e:
        # Sin buffer local (simplificación aprobada): el clip se pierde
        log_event("clip_failed", level="ERROR", trace_id=clip_id, clip_id=clip_id,
                  message=f"No se pudo subir el clip a MinIO: {e!r}",
                  stage="upload", camera_id=camera_id, intersection_id=intersection_id)
        return

    # 2) Metadata según el contrato del mensaje
    message = {
        "clip_id": clip_id,
        "trace_id": clip_id,
        "camera_id": camera_id,
        "intersection_id": intersection_id,
        "timestamp": timestamp,
        "object_key": key,
        "frames": int(frames.shape[0]),
        "shape": [int(frames.shape[1]), int(frames.shape[2])],
    }
    if publisher.publish(message):
        log_event("clip_published", trace_id=clip_id, clip_id=clip_id,
                  duration_ms=(time.monotonic() - t0) * 1000,
                  message=f"Clip de {camera_id} publicado",
                  camera_id=camera_id, intersection_id=intersection_id, frames=message["frames"])
    else:
        log_event("clip_failed", level="ERROR", trace_id=clip_id, clip_id=clip_id,
                  message="Se agotaron los reintentos de publicación",
                  stage="publish", camera_id=camera_id, intersection_id=intersection_id)


def edge_loop(cameras, stop_event):
    """Bucle de un hilo: cada FRAME_INTERVAL segundos procesa un clip de cada una de sus cámaras."""
    nombre = threading.current_thread().name
    simuladores = {cam: CameraSimulator(cam) for cam, _ in cameras}
    storage = ClipStorage()
    publisher = Publisher()
    if not publisher.connect(stop_event):
        return      # se pidió apagar antes de poder conectar

    log_event("worker_started", message=f"{nombre} arrancó con {len(cameras)} cámaras",
              thread=nombre, cameras=[cam for cam, _ in cameras])
    try:
        while not stop_event.is_set():
            t0 = time.monotonic()
            for camera_id, intersection_id in cameras:
                if stop_event.is_set():
                    break
                try:
                    process_clip(camera_id, intersection_id, simuladores[camera_id], storage, publisher)
                except Exception as e:
                    # Un error en una cámara no debe matar el hilo
                    log_event("clip_failed", level="ERROR",
                              message=f"Error inesperado procesando {camera_id}: {e!r}",
                              stage="process", camera_id=camera_id, intersection_id=intersection_id)

            transcurrido = time.monotonic() - t0
            if transcurrido > config.FRAME_INTERVAL:
                log_event("edge_lagging", level="WARNING",
                          message=f"{nombre} tardó {transcurrido:.2f} s en una ronda "
                                  f"(intervalo {config.FRAME_INTERVAL} s)",
                          thread=nombre, round_seconds=round(transcurrido, 3), cameras=len(cameras))
            stop_event.wait(max(0, config.FRAME_INTERVAL - transcurrido))
    finally:
        log_event("worker_stopped", message=f"{nombre} detenido", thread=nombre)
        publisher.close()


def run_edge_threads(stop_event):
    """Reparte las cámaras en EDGE_THREADS grupos (round robin) y lanza un hilo por grupo."""
    cameras = config.parse_cameras()
    n_hilos = max(1, min(config.EDGE_THREADS, len(cameras)))
    grupos = [cameras[i::n_hilos] for i in range(n_hilos)]

    threads = []
    for i, grupo in enumerate(grupos):
        if not grupo:
            continue
        t = threading.Thread(target=edge_loop, args=(grupo, stop_event),
                             name=f"edge-{i}", daemon=True)
        t.start()
        threads.append(t)
    return threads
