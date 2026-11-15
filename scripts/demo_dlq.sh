#!/usr/bin/env bash
# DEMO 4 — Un clip que no se puede procesar termina en la DLQ (camera_dlq) y no traba la cola.
# Se publica un mensaje válido cuyo object_key NO existe en MinIO. El worker falla en la etapa
# "download", hace basic_nack(requeue=False) y RabbitMQ lo manda por el exchange dlx a camera_dlq.
# Uso: ./scripts/demo_dlq.sh
source "$(dirname "${BASH_SOURCE[0]}")/_comun.sh"

titulo "DEMO 4 — Clip imposible de procesar va a la DLQ ($(ahora))"
esperar_consumidores 1
dlq() { rmq rabbitmqctl -q list_queues name messages | awk '$1=="camera_dlq"{print $2}'; }

ID=$(uuid)
TS=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
BODY="{\"clip_id\":\"$ID\",\"trace_id\":\"$ID\",\"camera_id\":\"cam-1\",\"intersection_id\":\"int-1\",\"timestamp\":\"$TS\",\"object_key\":\"cam-1/no-existe-$ID.npy\",\"frames\":8,\"shape\":[120,160]}"

ANTES=$(dlq)
paso "Mensajes en camera_dlq antes: $ANTES"
paso "Publicando un mensaje cuyo object_key no existe en MinIO: $BODY"
publicar "$BODY" "$ID"
sleep 4

paso "Logs del worker para ese clip: clip_failed (etapa download) y clip_dead_lettered"
docker compose logs --no-log-prefix cv-module 2>&1 | grep "\"clip_id\": \"$ID\""

paso "Mensajes en camera_dlq después: $(dlq)   (antes: $ANTES)"
paso "El mensaje en camera_dlq, con el header x-death (se lee y se vuelve a dejar)"
rmq rabbitmqadmin get queue=camera_dlq ackmode=ack_requeue_true count=50 -f pretty_json \
  | grep -B 30 "\"message_id\": \"$ID\"" | grep -E "message_id|\"reason\"|\"queue\"|\"count\"" | tail -4 || true
rmq rabbitmqadmin get queue=camera_dlq ackmode=ack_requeue_true count=50 -f long \
  | grep -B2 -A2 "no-existe-$ID" | grep -E "payload:" | head -1 || true

paso "La cola de trabajo sigue funcionando (otros clips se procesan normalmente)"
docker compose logs --no-log-prefix --since 10s cv-module 2>&1 | grep clip_processed | tail -2
paso "Filas en results para ese clip_id: $(sql "SELECT count(*) FROM results WHERE clip_id = '$ID'")   (0 = no se guardó nada)"
