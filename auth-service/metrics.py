"""Métricas Prometheus propias del auth-service.

- auth_login_total{result}: ok | invalid (401) | bad_request (422) | error (5xx). Se deriva del
  status de la respuesta de POST /login, sin tocar la lógica de autenticación.
- auth_active_sessions: sesiones activas y no vencidas en auth-db. Se calcula en el scrape con
  caché de AUTH_METRICS_CACHE_S segundos (por defecto 15) para no consultar la base en cada scrape.
  Si la base no responde, la métrica no se publica en ese scrape (no se inventa un valor).
"""
import os
import threading
import time
from datetime import datetime

import psycopg2

import config
from logs import log_event
from observability import counter, on_response, register_collector

LOGINS = counter("auth_login_total", "Intentos de login por resultado", ("result",))

_RESULTADO_LOGIN = {200: "ok", 401: "invalid", 422: "bad_request"}


@on_response
def _contar_login(method, route, status, seconds):
    if route == "/login" and method == "POST":
        resultado = _RESULTADO_LOGIN.get(status, "error")
        LOGINS.labels(resultado).inc()
        # Sin usuario ni contraseña ni token: solo el resultado (O19).
        log_event("auth_login", level="INFO" if resultado == "ok" else "WARNING",
                  duration_ms=seconds * 1000, result=resultado, status_code=status,
                  message=f"login {resultado}")
    if status >= 500:
        log_event("auth_request_failed", level="ERROR", duration_ms=seconds * 1000, method=method,
                  route=route, status_code=status, message=f"{method} {route} respondió {status}")


class _SesionesActivas:
    CACHE_S = float(os.getenv("AUTH_METRICS_CACHE_S", "15"))

    def __init__(self):
        self._lock = threading.Lock()
        self._valor = None
        self._cuando = 0.0

    def _consultar(self):
        conn = psycopg2.connect(host=config.AUTH_DB_HOST, port=config.AUTH_DB_PORT,
                                dbname=config.AUTH_DB_NAME, user=config.AUTH_DB_USER,
                                password=config.AUTH_DB_PASS, connect_timeout=2)
        try:
            with conn.cursor() as cur:
                # Misma regla que /token/state: activa y expires_at posterior a ahora (reloj del servicio).
                cur.execute("SELECT count(*) FROM sessions WHERE is_active AND expires_at > %s",
                            (datetime.now(),))
                return cur.fetchone()[0]
        finally:
            conn.close()

    def collect(self):
        from prometheus_client.core import GaugeMetricFamily
        with self._lock:
            if time.monotonic() - self._cuando > self.CACHE_S:
                try:
                    self._valor = self._consultar()
                except Exception:
                    self._valor = None
                self._cuando = time.monotonic()
            valor = self._valor
        if valor is not None:
            familia = GaugeMetricFamily("auth_active_sessions", "Sesiones activas y no vencidas")
            familia.add_metric([], valor)
            yield familia


register_collector(_SesionesActivas())

# Series en 0 desde el arranque (si nacen en 1, increase()/rate() no ven el primer evento).
for _r in ("ok", "invalid", "bad_request", "error"):
    LOGINS.labels(_r)

log_event("auth_started", message=f"{config.SERVICE_NAME} iniciado en el puerto {config.SERVICE_PORT}")
