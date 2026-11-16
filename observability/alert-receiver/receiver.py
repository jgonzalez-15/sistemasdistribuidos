"""Contact point mínimo: recibe los webhooks de Grafana Alerting y los imprime como JSON en stdout.

Se ve con `docker logs -f alert-receiver`. Solo librería estándar (sin dependencias).
También lleva un registro en memoria consultable en GET /alerts (lo usa scripts/demo_observabilidad.sh).
"""
import json
import os
from collections import deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.getenv("ALERT_RECEIVER_PORT", "8080"))
_recibidas = deque(maxlen=500)


def ahora():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        largo = int(self.headers.get("Content-Length", 0))
        try:
            payload = json.loads(self.rfile.read(largo) or b"{}")
        except json.JSONDecodeError:
            payload = {}
        for alerta in payload.get("alerts", []):
            registro = {
                "ts": ahora(), "service": "alert-receiver", "level": "WARNING", "event": "alert_received",
                "status": alerta.get("status"),
                "alertname": alerta.get("labels", {}).get("alertname"),
                "severity": alerta.get("labels", {}).get("severity"),
                "labels": {k: v for k, v in alerta.get("labels", {}).items() if k not in ("alertname", "severity")},
                "summary": alerta.get("annotations", {}).get("summary"),
                "startsAt": alerta.get("startsAt"), "endsAt": alerta.get("endsAt"),
            }
            _recibidas.append(registro)
            print(json.dumps(registro, ensure_ascii=False), flush=True)
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        cuerpo = json.dumps(list(_recibidas), ensure_ascii=False).encode() if self.path.startswith("/alerts") \
            else b'{"service": "alert-receiver", "status": "ok"}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(cuerpo)

    def log_message(self, *args):
        pass  # sin el log de acceso por defecto: solo las alertas


if __name__ == "__main__":
    print(json.dumps({"ts": ahora(), "service": "alert-receiver", "level": "INFO", "event": "receiver_started",
                      "message": f"escuchando webhooks en :{PORT}"}), flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
