#!/usr/bin/env bash
# VERIFICADOR DE OBSERVABILIDAD — consulta las APIs de Prometheus, Grafana y Loki y FALLA
# (exit 1) si algo de la "definición de terminado" no se cumple. Solo usa Docker, bash y curl.
#
# Uso (con el sistema y el perfil levantados):
#   docker compose --profile observability up -d --build
#   ./scripts/verify_observabilidad.sh                # REPLICAS=3 por defecto: escala cv-module y lo restaura
#   REPLICAS=1 ./scripts/verify_observabilidad.sh     # sin escalar
source "$(dirname "${BASH_SOURCE[0]}")/_comun.sh"
set +e    # el verificador sigue aunque falle un chequeo: los cuenta y reporta todos al final

PROM="http://localhost:${PROMETHEUS_PORT:-9090}"
GRAFANA="http://localhost:${GRAFANA_PORT:-3001}"
GAUTH="${GRAFANA_ADMIN_USER:-admin}:${GRAFANA_ADMIN_PASSWORD:-admin}"
LOKI="http://localhost:${LOKI_PORT:-3100}"
REPLICAS="${REPLICAS:-3}"
OK=0; FALLAS=0

ok()    { OK=$((OK + 1)); echo "  [OK]    $*"; }
falla() { FALLAS=$((FALLAS + 1)); echo "  [FALLA] $*"; }
check() { local desc="$1"; shift; if "$@"; then ok "$desc"; else falla "$desc"; fi; }

# JSON sin jq ni python en el host: se parsea con el python de la imagen de api-rest (siempre levantada).
py() { docker compose exec -T api-rest python -c "$1"; }
promq() {  # promq <consulta> → valor escalar (primer resultado) o vacío
  curl -s -G "$PROM/api/v1/query" --data-urlencode "query=$1" | \
    docker compose exec -T api-rest python -c "import sys,json;r=json.load(sys.stdin)['data']['result'];print(r[0]['value'][1] if r else '')"
}
mayor() { awk -v a="${1:-0}" -v b="$2" 'BEGIN{exit !(a+0 > b+0)}'; }
igual() { awk -v a="${1:-x}" -v b="$2" 'BEGIN{exit !(a+0 == b+0)}'; }

titulo "VERIFICADOR DE OBSERVABILIDAD ($(ahora))"

paso "0. El stack responde"
check "Prometheus listo"   curl -sf "$PROM/-/ready" -o /dev/null
check "Grafana listo"      curl -sf "$GRAFANA/api/health" -o /dev/null
check "Loki listo"         curl -sf "$LOKI/ready" -o /dev/null

paso "1. Targets de Prometheus (con $REPLICAS réplica(s) de cv-module)"
ESCALADO=0
if [ "$REPLICAS" -gt 1 ]; then
  docker compose up -d --no-recreate --scale cv-module="$REPLICAS" cv-module >/dev/null 2>&1 && ESCALADO=1
  for _ in $(seq 1 30); do
    [ "$(promq 'count(up{job="cv-module"} == 1)')" = "$REPLICAS" ] && break; sleep 3
  done
fi
check "las $REPLICAS réplicas de cv-module son targets UP (dns_sd)" igual "$(promq 'count(up{job="cv-module"} == 1)')" "$REPLICAS"
check "las $REPLICAS réplicas pasan el probe de /health" igual "$(promq 'count(probe_success{job="blackbox-health-cv"} == 1)')" "$REPLICAS"
CAIDOS=$(promq 'count(up == 0)')
check "ningún target DOWN (caídos: ${CAIDOS:-0})" test -z "$CAIDOS"
check "probes /health y TCP todos OK" igual "$(promq 'min(probe_success)')" 1
for job in api-rest auth-service visualization-backend monitoring-pipeline edge-processor rabbitmq rabbitmq-queues postgres minio canary loki; do
  check "job $job presente y UP" mayor "$(promq "sum(up{job=\"$job\"})")" 0
done
check "métricas por cola: camera_processing_queue y camera_dlq por separado" \
  igual "$(promq 'count(rabbitmq_detailed_queue_messages{queue=~"camera_processing_queue|camera_dlq"})')" 2
check "métricas de negocio (traffic_intersection_state) presentes" mayor "$(promq 'count(traffic_intersection_state)')" 0
check "canary: los 4 pasos OK" igual "$(promq 'min(canary_check_success)')" 1
if [ "$ESCALADO" = 1 ]; then
  docker compose up -d --no-recreate --scale cv-module=1 cv-module >/dev/null 2>&1
  echo "  (restaurado: 1 réplica de cv-module)"
fi

paso "2. Grafana: provisionado sin intervención manual"
DS=$(curl -s -u "$GAUTH" "$GRAFANA/api/datasources")
for uid in prometheus loki; do
  check "datasource $uid provisionado" grep -q "\"uid\":\"$uid\"" <<<"$DS"
  check "datasource $uid conecta" grep -q '"status":"OK"' <<<"$(curl -s -u "$GAUTH" "$GRAFANA/api/datasources/uid/$uid/health")"
done
DASH=$(curl -s -u "$GAUTH" "$GRAFANA/api/search?tag=sgtu")
for d in sgtu-salud sgtu-pipeline sgtu-transito sgtu-logs; do
  check "dashboard $d provisionado" grep -q "\"uid\":\"$d\"" <<<"$DASH"
done
N_REGLAS=$(curl -s -u "$GAUTH" "$GRAFANA/api/v1/provisioning/alert-rules" | grep -o '"uid":"' | wc -l | tr -d ' ')
check "reglas de alerta provisionadas ($N_REGLAS ≥ 22)" mayor "$N_REGLAS" 21
check "contact point sgtu-webhook provisionado" grep -q sgtu-webhook <<<"$(curl -s -u "$GAUTH" "$GRAFANA/api/v1/provisioning/contact-points")"
SALUD=$(curl -s -u "$GAUTH" "$GRAFANA/api/prometheus/grafana/api/v1/rules")
check "ninguna regla con error de evaluación" test "$(grep -o '"health":"error"' <<<"$SALUD" | wc -l | tr -d ' ')" = 0

paso "3. Logs en Loki (con trace_hex para correlación)"
for s in edge-processor cv-module api-rest auth-service visualization-backend; do
  # Ventana de 24 h: visualization-backend solo loguea al arrancar y ante errores 5xx (O19).
  N=$(curl -s -G "$LOKI/loki/api/v1/query" --data-urlencode "query=sum(count_over_time({service=\"$s\"}[24h]))" | \
      docker compose exec -T api-rest python -c "import sys,json;r=json.load(sys.stdin)['data']['result'];print(r[0]['value'][1] if r else 0)")
  check "LogQL devuelve logs de $s (últimas 24 h: $N)" mayor "$N" 0
done
TRAZA=$(curl -s -G "$LOKI/loki/api/v1/query_range" --data-urlencode 'query={service="cv-module", event="clip_processed"}' \
        --data-urlencode limit=1 --data-urlencode "start=$(( $(date +%s) - 120 ))000000000" | \
        docker compose exec -T api-rest python -c "
import sys,json
r=json.load(sys.stdin)['data']['result']
l=json.loads(r[0]['values'][0][1]) if r else {}
print(l.get('trace_hex',''), l.get('clip_id',''))")
read -r HEX CLIP <<<"$TRAZA"
check "el log de un clip tiene trace_hex (= clip_id sin guiones: ${CLIP:-?})" test -n "$HEX" -a "$HEX" = "$(tr -d '-' <<<"$CLIP")"

paso "4. logs_queue acotada y drenada (emitidos == recibidos)"
POL=$(docker compose exec -T logs-queue rabbitmqctl -q list_queues name policy messages consumers </dev/null | awk '$1=="logs_queue"')
echo "  $POL"
check "logs_queue tiene la policy logs-queue-limites" grep -q logs-queue-limites <<<"$POL"
check "logs_queue tiene consumidor (monitoring-pipeline)" test "$(awk '{print $4}' <<<"$POL")" -ge 1
check "logs_queue drenada (< 200 mensajes en cola)" test "$(awk '{print $3}' <<<"$POL")" -lt 200
# Ventana cerrada (de hace 3 min a hace 1 min): líneas clip_published en stdout del edge vs en Loki
DESDE=$(( $(date +%s) - 180 )); HASTA=$(( $(date +%s) - 60 ))
STDOUT=$(docker compose logs --no-log-prefix --since "$DESDE" --until "$HASTA" edge-processor 2>/dev/null | grep -c '"event": "clip_published"')
ENLOKI=$(curl -s -G "$LOKI/loki/api/v1/query_range" --data-urlencode 'query={service="edge-processor", event="clip_published"}' \
         --data-urlencode "start=${DESDE}000000000" --data-urlencode "end=${HASTA}000000000" --data-urlencode limit=5000 | \
         docker compose exec -T api-rest python -c "import sys,json;print(sum(len(s['values']) for s in json.load(sys.stdin)['data']['result']))")
echo "  clip_published entre $(date -u -r $DESDE +%H:%M:%S 2>/dev/null || date -u -d @$DESDE +%H:%M:%S) y $(date -u -r $HASTA +%H:%M:%S 2>/dev/null || date -u -d @$HASTA +%H:%M:%S) UTC: stdout=$STDOUT Loki=$ENLOKI"
# Tolerancia ±2: el borde de la ventana (ts del log vs. el momento en que Docker registró la línea)
check "emitidos (stdout) == recibidos (Loki) ±2" awk -v a="$STDOUT" -v b="$ENLOKI" 'BEGIN{d=a-b; if(d<0)d=-d; exit !(a>0 && d<=2)}'
check "metrics-db tiene agregados del último minuto cerrado" \
  mayor "$(docker compose exec -T metrics-db psql -U postgres -d metrics_db -tAc "SELECT count(*) FROM metrics_minute WHERE minute > now() - interval '5 minutes'" </dev/null)" 0

paso "5. Consistencia del código compartido"
check "observability.py idéntico en los 6 servicios" test "$(cksum */observability.py | awk '{print $1}' | sort -u | wc -l | tr -d ' ')" = 1
check "logs.py idéntico en edge-processor y cv-module" cmp -s edge-processor/logs.py cv-module/logs.py
# Trazas distribuidas (Jaeger): trabajo futuro, rama wip/trazas.

titulo "RESULTADO: $OK OK, $FALLAS FALLAS"
[ "$FALLAS" -eq 0 ]
