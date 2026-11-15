#!/usr/bin/env bash
# PRUEBA DE CARGA — 300 cámaras (una zona grande) con un clip cada 5 s = ~60 clips/s.
# Mide: clips/s publicados y procesados, profundidad de la cola, rondas atrasadas del edge
# (edge_lagging) y uso de CPU/memoria. Si 1 worker no alcanza (la cola crece), escala a 3.
# Sin demora artificial: mide el costo real del CV simulado.
# Uso: ./scripts/prueba_carga.sh        (CAMARAS=1-300, EDGE_THREADS=8, DURACION=90 por defecto)
source "$(dirname "${BASH_SOURCE[0]}")/_comun.sh"

export CAMERA_RANGE="${CAMARAS:-1-300}" EDGE_THREADS="${EDGE_THREADS:-8}" PROCESSING_DELAY_MS=0
DURACION="${DURACION:-90}"

publicados() { docker compose logs --no-log-prefix edge-processor 2>&1 | grep -c '"event": "clip_published"' || true; }
atrasos()    { docker compose logs --no-log-prefix edge-processor 2>&1 | grep -c '"event": "edge_lagging"' || true; }
filas()      { sql "SELECT count(*) FROM results"; }

medir() {   # medir <segundos>
  local fin=$((SECONDS + $1)) p0 f0 p1 f1
  printf "%-9s %12s %12s %8s %8s %13s\n" "hora_utc" "publ/s" "proc/s" "listos" "sin_ack" "edge_lagging"
  p0=$(publicados); f0=$(filas)
  while [ "$SECONDS" -lt "$fin" ]; do
    sleep 10
    p1=$(publicados); f1=$(filas)
    read -r listos sinack _ <<<"$(estado_cola)"
    printf "%-9s %12s %12s %8s %8s %13s\n" "$(date -u +%H:%M:%S)" \
      "$(awk -v a="$p0" -v b="$p1" 'BEGIN{printf "%.1f", (b-a)/10}')" \
      "$(awk -v a="$f0" -v b="$f1" 'BEGIN{printf "%.1f", (b-a)/10}')" "$listos" "$sinack" "$(atrasos)"
    p0=$p1; f0=$f1
  done
}

titulo "PRUEBA DE CARGA — cámaras $CAMERA_RANGE, $EDGE_THREADS hilos en el edge ($(ahora))"
paso "Arrancando: 1 edge con $CAMERA_RANGE y 1 worker sin demora (objetivo: ~60 clips/s con 300 cámaras)"
rmq rabbitmqctl -q purge_queue "$COLA" >/dev/null
FILAS_INICIO=$(filas)
docker compose up -d --scale cv-module=1 edge-processor cv-module 2>&1 | grep -E "Recreated|Started" || true
esperar_consumidores 1
sleep 10

paso "FASE 1 — 1 worker durante ${DURACION} s"
medir "$DURACION"
paso "Uso de recursos (docker stats)"
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' \
  | grep -E "NAME|edge|cv-module|camera-queue|clips-db|results-db"

read -r LISTOS _ _ <<<"$(estado_cola)"
if [ "${LISTOS:-0}" -gt 100 ]; then
  paso "La cola creció ($LISTOS listos): escalando a 3 workers durante ${DURACION} s"
  docker compose up -d --no-recreate --scale cv-module=3 cv-module 2>&1 | grep -E "Started" || true
  esperar_consumidores 3
  medir "$DURACION"
else
  paso "La cola no creció ($LISTOS listos): 1 worker alcanza para esta carga con el CV simulado"
fi

paso "Resumen"
TOTAL=$(( $(filas) - FILAS_INICIO ))
echo "Clips procesados en la prueba: $TOTAL"
echo "Rondas atrasadas del edge (edge_lagging): $(atrasos)"
echo "Clips fallidos: $(docker compose logs --no-log-prefix 2>&1 | grep -c '"event": "clip_failed"' || true)"
echo "Volumen en MinIO generado (aprox. 190 KB por clip): $(awk -v n="$TOTAL" 'BEGIN{printf "%.0f MB", n*0.19}')"

restaurar
