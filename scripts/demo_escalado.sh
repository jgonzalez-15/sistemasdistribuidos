#!/usr/bin/env bash
# DEMO 1 — Escalado horizontal de los workers (competing consumers).
# 30 cámaras generan ~6 clips/s. Cada worker tarda 300 ms por clip (PROCESSING_DELAY_MS, representa un
# modelo real), así que rinde ~3,3 clips/s: con 1 worker la cola CRECE; al escalar a 3 (~10 clips/s) BAJA.
# Uso: ./scripts/demo_escalado.sh        (FASE_SEGUNDOS=60 por defecto)
source "$(dirname "$0")/_comun.sh"

FASE="${FASE_SEGUNDOS:-60}"
export CAMERA_RANGE="1-30" PROCESSING_DELAY_MS="300"

muestrear() {      # muestrear <segundos> [cortar_si_vacia]
  local fin=$((SECONDS + $1))
  printf "%-10s %8s %8s %12s\n" "hora_utc" "listos" "sin_ack" "consumidores"
  while [ "$SECONDS" -lt "$fin" ]; do
    read -r listos sinack cons <<<"$(estado_cola)"
    printf "%-10s %8s %8s %12s\n" "$(date -u +%H:%M:%S)" "$listos" "$sinack" "$cons"
    [ "${2:-}" = "cortar_si_vacia" ] && [ "$listos" = "0" ] && break
    sleep 5
  done
}

titulo "DEMO 1 — Escalado de 1 a 3 workers ($(ahora))"
paso "Vaciando la cola de trabajo y arrancando: 30 cámaras, 1 worker, demora 300 ms por clip"
rmq rabbitmqctl -q purge_queue "$COLA" >/dev/null
docker compose up -d --scale cv-module=1 edge-processor cv-module 2>&1 | grep -E "Recreated|Started" || true
esperar_consumidores 1

paso "FASE 1 — 1 worker durante ${FASE} s: la cola crece (entran ~6 clips/s, sale ~3,3/s)"
muestrear "$FASE"

INICIO_FASE2=$(sql "SELECT now()")
paso "FASE 2 — docker compose up --scale cv-module=3 (sin tocar el edge ni la cola)"
docker compose up -d --no-recreate --scale cv-module=3 cv-module 2>&1 | grep -E "Started|Created" || true
esperar_consumidores 3
muestrear $((FASE * 2)) cortar_si_vacia

paso "Clips procesados por cada réplica desde que se escaló (processed_by = hostname del contenedor)"
sql_tabla "SELECT processed_by, count(*) AS clips FROM results WHERE processed_at >= '$INICIO_FASE2' GROUP BY 1 ORDER BY 2 DESC;"

paso "Réplicas corriendo"
docker compose ps --format 'table {{.Name}}\t{{.Status}}' | grep -E "NAME|cv-module|edge"

restaurar
echo; echo "Listo. [CAPTURA] RabbitMQ → Queues → $COLA → gráfico 'Queued messages': sube en la fase 1 y baja en la fase 2."
