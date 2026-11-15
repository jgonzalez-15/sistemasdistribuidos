#!/usr/bin/env bash
# DEMO 3 — El mismo clip_id llega dos veces más y no se duplica (consumidor idempotente).
# Con entrega at-least-once un mensaje puede llegar más de una vez. Se toma un clip ya procesado
# (su .npy existe en MinIO), se arma el mismo mensaje del contrato y se publica DOS veces más.
# El worker lo procesa de nuevo, pero INSERT ... ON CONFLICT (clip_id) DO NOTHING no inserta nada.
# Uso: ./scripts/demo_idempotencia.sh
source "$(dirname "${BASH_SOURCE[0]}")/_comun.sh"

titulo "DEMO 3 — Mismo clip_id dos veces más, sin duplicar ($(ahora))"
esperar_consumidores 1

paso "Clip ya procesado que se va a reenviar (fila actual en results)"
FILA=$(sql "SELECT clip_id, camera_id, intersection_id, to_char(ts AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'), frames_processed
            FROM results WHERE camera_id IN ('cam-1','cam-2','cam-3','cam-4','cam-5','cam-6')
            ORDER BY processed_at DESC LIMIT 1")
IFS='|' read -r ID CAM INTER TS FRAMES <<<"$FILA"
sql_tabla "SELECT clip_id, camera_id, vehicle_count, processed_by, processed_at FROM results WHERE clip_id = '$ID';"

BODY="{\"clip_id\":\"$ID\",\"trace_id\":\"$ID\",\"camera_id\":\"$CAM\",\"intersection_id\":\"$INTER\",\"timestamp\":\"$TS\",\"object_key\":\"$CAM/$ID.npy\",\"frames\":$FRAMES,\"shape\":[120,160]}"
paso "Mensaje reenviado (mismo contrato): $BODY"

publicar "$BODY" "$ID"
publicar "$BODY" "$ID"
echo "Publicado 2 veces en $COLA."
sleep 4

paso "Logs del worker para ese clip_id: lo procesó otra vez, pero duplicate=true (no insertó)"
docker compose logs --no-log-prefix cv-module 2>&1 | grep "\"clip_id\": \"$ID\"" | grep clip_processed

paso "Filas en results para ese clip_id"
sql_tabla "SELECT count(*) AS filas FROM results WHERE clip_id = '$ID';"
sql_tabla "SELECT clip_id, vehicle_count, processed_by, processed_at FROM results WHERE clip_id = '$ID';"
echo "(processed_at no cambió: la fila original queda intacta.)"
