#!/usr/bin/env bash
# Funciones comunes de los scripts de demo. Solo necesitan Docker (no hace falta Python en el host).
# Se usan con: source "$(dirname "$0")/_comun.sh"

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."   # raíz del repo (donde está docker-compose.yml)

# Si el puerto 8001 del host está ocupado: EDGE_PROCESSOR_PORT=18001 ./scripts/demo_x.sh
export EDGE_PROCESSOR_PORT="${EDGE_PROCESSOR_PORT:-8001}"

COLA=camera_processing_queue

titulo()  { echo; echo "=================================================================="; echo "$*"; echo "=================================================================="; }
paso()    { echo; echo "### $*"; }
ahora()   { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Comandos dentro de los contenedores (sin stdin, para que no se cuelguen en un bucle)
rmq()     { docker compose exec -T camera-queue "$@" </dev/null; }
sql()     { docker compose exec -T results-db psql -U postgres -d results_db -tAc "$1" </dev/null; }
sql_tabla() { docker compose exec -T results-db psql -U postgres -d results_db -c "$1" </dev/null; }

# Profundidad de la cola de trabajo: "listos sin_ack consumidores"
estado_cola() { rmq rabbitmqctl -q list_queues name messages_ready messages_unacknowledged consumers | awk -v q="$COLA" '$1==q{print $2, $3, $4}'; }

# Publica un JSON en camera_processing_queue con las propiedades del contrato
publicar() {
  local body="$1" id="$2"
  rmq rabbitmqadmin publish exchange=amq.default routing_key="$COLA" payload="$body" \
      properties="{\"delivery_mode\":2,\"content_type\":\"application/json\",\"message_id\":\"$id\"}" >/dev/null
}

uuid() { docker compose exec -T camera-queue cat /proc/sys/kernel/random/uuid </dev/null | tr -d '\r'; }

# Espera (hasta N segundos) a que la cola tenga una cantidad de consumidores
esperar_consumidores() {
  local n="$1" max="${2:-90}" i=0
  until [ "$(estado_cola | awk '{print $3}')" = "$n" ]; do
    i=$((i + 2)); [ "$i" -ge "$max" ] && { echo "AVISO: no se llegó a $n consumidores en $max s"; return 0; }
    sleep 2
  done
}

# Vuelve a la configuración normal: 6 cámaras, 1 worker, sin demora artificial
restaurar() {
  paso "Restaurando configuración normal (6 cámaras, 1 worker, sin demora)"
  # Se fuerzan los valores normales: las variables de la demo siguen exportadas en este shell
  CAMERA_RANGE="" PROCESSING_DELAY_MS=0 EDGE_THREADS=4 \
    docker compose up -d --scale cv-module=1 edge-processor cv-module 2>&1 | grep -vE "Running|Waiting|Healthy" || true
  [ "$(docker compose exec -T cv-module printenv PROCESSING_DELAY_MS </dev/null | tr -d '\r')" = "0" ] \
    && echo "OK: configuración normal restaurada" || echo "AVISO: revisar la restauración (docker compose ps)"
}
