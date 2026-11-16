"""Monitoreo sintético (canary): cada CANARY_INTERVAL_S segundos recorre el camino de un usuario real.

Pasos: POST /login → GET /api/intersections → GET /api/system/health → POST /logout
(el logout evita que se acumulen sesiones activas en auth-db).

Expone en :9101/metrics:
- canary_check_success{check}           1 si el último intento de ese paso salió bien, 0 si no.
- canary_check_duration_seconds{check}  histograma de la duración de cada paso.
- canary_runs_total{result}              recorridos completos ok / failed.
- canary_last_run_timestamp_seconds      cuándo terminó el último recorrido (para detectar un canary trabado).

Nunca imprime la contraseña ni el token. Logs JSON en una línea a stdout, como el resto del sistema.
"""
import json
import os
import time
from datetime import datetime, timezone

import requests
from prometheus_client import Counter, Gauge, Histogram, start_http_server

API = os.getenv("CANARY_API_URL", "http://api-rest:8000").rstrip("/")
USER = os.getenv("CANARY_USER", "admin")
PASSWORD = os.getenv("CANARY_PASSWORD", "admin123")
INTERVAL = float(os.getenv("CANARY_INTERVAL_S", "30"))
TIMEOUT = float(os.getenv("CANARY_TIMEOUT_S", "5"))
PORT = int(os.getenv("CANARY_PORT", "9101"))

CHECKS = ("login", "intersections", "system_health", "logout")
SUCCESS = Gauge("canary_check_success", "1 si el último intento del paso salió bien", ("check",))
DURATION = Histogram("canary_check_duration_seconds", "Duración de cada paso del canary", ("check",),
                     buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5))
RUNS = Counter("canary_runs_total", "Recorridos del canary por resultado", ("result",))
LAST_RUN = Gauge("canary_last_run_timestamp_seconds", "Epoch del último recorrido terminado")
for _r in ("ok", "failed"):   # series en 0 desde el arranque (increase() ve el primer fallo)
    RUNS.labels(_r)


def log(event, level="INFO", **extra):
    record = {"ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
              "service": "canary", "level": level, "event": event, "trace_id": None}
    record.update(extra)
    print(json.dumps(record, ensure_ascii=False), flush=True)


def paso(check, fn):
    """Ejecuta un paso, registra éxito y duración. Devuelve la respuesta o None si falló."""
    t0 = time.perf_counter()
    try:
        respuesta = fn()
        ok = respuesta.status_code == 200
    except requests.RequestException as e:
        respuesta, ok = None, False
        log("canary_check_failed", level="WARNING", check=check, error=type(e).__name__)
    DURATION.labels(check).observe(time.perf_counter() - t0)
    SUCCESS.labels(check).set(1 if ok else 0)
    if respuesta is not None and not ok:
        log("canary_check_failed", level="WARNING", check=check, status=respuesta.status_code)
    return respuesta if ok else None


def recorrido():
    s = requests.Session()
    r = paso("login", lambda: s.post(f"{API}/login", json={"user": USER, "password": PASSWORD}, timeout=TIMEOUT))
    if r is None:
        for c in CHECKS[1:]:
            SUCCESS.labels(c).set(0)
        return False
    token = r.json().get("access_token") or r.json().get("token")
    cab = {"Authorization": f"Bearer {token}"}
    ok_int = paso("intersections", lambda: s.get(f"{API}/api/intersections", headers=cab, timeout=TIMEOUT))
    ok_health = paso("system_health", lambda: s.get(f"{API}/api/system/health", headers=cab, timeout=TIMEOUT))
    ok_logout = paso("logout", lambda: s.post(f"{API}/logout", headers=cab, timeout=TIMEOUT))
    return all(x is not None for x in (ok_int, ok_health, ok_logout))


def main():
    start_http_server(PORT)
    log("canary_started", message=f"canary contra {API} cada {INTERVAL:.0f} s")
    while True:
        t0 = time.monotonic()
        try:
            ok = recorrido()
        except Exception as e:  # nunca morir: el canary es justamente el que tiene que seguir midiendo
            ok = False
            log("canary_error", level="ERROR", error=repr(e))
        RUNS.labels("ok" if ok else "failed").inc()
        LAST_RUN.set_to_current_time()
        if not ok:
            log("canary_run_failed", level="WARNING", duration_ms=int((time.monotonic() - t0) * 1000))
        time.sleep(max(1.0, INTERVAL - (time.monotonic() - t0)))


if __name__ == "__main__":
    main()
