#!/usr/bin/env bash
# DEMO 2 — Un worker se cae a mitad de un clip y otro lo reprocesa (transparencia de fallo).
# 2 workers con 3 s por clip (PROCESSING_DELAY_MS) para que siempre haya un clip "en vuelo" (sin ACK).
# Se hace docker kill (SIGKILL, sin apagado ordenado) a la réplica 1. Como no llegó a hacer ACK,
# RabbitMQ re-encola su mensaje y lo procesa la otra réplica (redelivered=true). No se pierde ningún clip.
# Uso: ./scripts/demo_worker_caido.sh
source "$(dirname "${BASH_SOURCE[0]}")/_comun.sh"

export PROCESSING_DELAY_MS="3000"
PROYECTO="$(basename "$PWD" | tr '[:upper:]' '[:lower:]')"
VICTIMA="${PROYECTO}-cv-module-1"

titulo "DEMO 2 — Worker caído a mitad de un clip ($(ahora))"
paso "Vaciando la cola y arrancando 2 workers con 3 s por clip (6 cámaras: entran ~1,2 clips/s)"
rmq rabbitmqctl -q purge_queue "$COLA" >/dev/null
INICIO=$(sql "SELECT now()")
INICIO_ISO=$(date -u +%Y-%m-%dT%H:%M:%S)
docker compose up -d --scale cv-module=2 edge-processor cv-module 2>&1 | grep -E "Recreated|Created|Started" || true
esperar_consumidores 2
sleep 8

IP_VICTIMA=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$VICTIMA")
HOST_VICTIMA=$(docker inspect -f '{{.Config.Hostname}}' "$VICTIMA")
paso "Canales de los workers y mensajes sin ACK (cada worker tiene 1 clip en proceso; prefetch_count=1)"
IP_EDGE=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' edge-processor)
rmq rabbitmqctl -q list_channels name messages_unacknowledged | grep -v "^name" | sort \
  | sed -e "s/^\($IP_EDGE:\)/[edge, publica]   \1/" -e "s/^\($IP_VICTIMA:\)/[worker VÍCTIMA]  \1/" -e "s/^\([0-9]\)/[worker]         \1/"
echo "Víctima: $VICTIMA  (IP $IP_VICTIMA, hostname $HOST_VICTIMA)"

paso "Estado de la cola ANTES del kill (listos sin_ack consumidores): $(estado_cola)"
paso "docker kill $VICTIMA  ($(date -u +%H:%M:%S))"
docker kill "$VICTIMA" >/dev/null
sleep 2
paso "Estado de la cola 2 s DESPUÉS del kill (listos sin_ack consumidores): $(estado_cola)"
echo "(RabbitMQ detectó la conexión cerrada: el mensaje sin ACK de la víctima volvió a 'listos')"

sleep 15
paso "Mensajes re-entregados y procesados por la réplica que sigue viva (redelivered=true)"
docker compose logs --no-log-prefix cv-module 2>&1 | grep '"event": "clip_processed"' | grep '"redelivered": true' | head -3
paso "Estado de las réplicas (con restart: unless-stopped, docker kill cuenta como parada manual y no la relanza)"
docker compose ps -a --format 'table {{.Name}}\t{{.Status}}' | grep -E "NAME|cv-module"

paso "Deteniendo el edge para contar: cada clip publicado tiene que terminar en results (ninguno perdido)"
docker compose stop edge-processor >/dev/null 2>&1
# Solo los clips publicados desde el inicio de la demo (el campo ts del log es ISO UTC: se compara como texto)
IDS=$(docker compose logs --no-log-prefix edge-processor 2>&1 | grep '"event": "clip_published"' \
      | awk -v desde="$INICIO_ISO" -F'"ts": "' '{ split($2, a, "\""); if (a[1] >= desde) print }' \
      | grep -o '"clip_id": "[^"]*"' | cut -d'"' -f4 | sort -u)
PUBLICADOS=$(echo "$IDS" | grep -c . || true)
LISTA=$(echo "$IDS" | sed "s/.*/'&'/" | paste -sd, -)

# Sin la demora, la réplica viva vacía rápido lo que quedó en la cola
restaurar
until [ "$(estado_cola | awk '{print $1 + $2}')" = "0" ]; do sleep 2; done
EN_RESULTS=$(sql "SELECT count(*) FROM results WHERE clip_id IN ($LISTA)")
REPROC=$(docker compose logs --no-log-prefix cv-module 2>&1 | grep -c '"redelivered": true' || true)
paso "Resultado"
echo "Clips publicados por el edge en la demo: $PUBLICADOS"
echo "De esos, filas en results:               $EN_RESULTS   (iguales = ningún clip perdido)"
echo "Filas por clip_id (UNIQUE):              $(sql "SELECT coalesce(max(c),0) FROM (SELECT count(*) c FROM results WHERE clip_id IN ($LISTA) GROUP BY clip_id) t")   (1 = sin duplicados)"
echo "Clips procesados por réplica desde el inicio de la demo:"
sql_tabla "SELECT processed_by, count(*) AS clips FROM results WHERE processed_at >= '$INICIO' GROUP BY 1 ORDER BY 2 DESC;"
echo "(La víctima era $HOST_VICTIMA.)"
echo; echo "[CAPTURA] RabbitMQ → Queues → $COLA: en 'Message rates' aparece 'Redelivered' en el momento del kill."
