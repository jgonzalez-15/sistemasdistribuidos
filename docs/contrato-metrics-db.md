# Contrato de la Metrics DB (`metrics-db`)

**Dueño:** monitoring-pipeline (Ro). **Escritor único:** `monitoring-pipeline/agregador.py`. Los demás componentes **solo leen**.

## Conexión
| Dato | Valor (dev) |
| :--- | :--- |
| Contenedor | `metrics-db` (`postgres:16-alpine`, `mem_limit` 128 MB), en el compose **base** |
| Host / puerto | `metrics-db:5432` en la red interna; `localhost:5435` desde el host (`METRICS_DB_HOST_PORT`) |
| Base / usuario | `metrics_db` / `postgres` / `postgres` (`METRICS_DB_NAME`, `METRICS_DB_USER`, `METRICS_DB_PASS`) |
| Volumen | `metrics_db_data` (persistente) |

## Esquema
Lo crea el pipeline al iniciar (`CREATE TABLE IF NOT EXISTS`, idempotente). No hay `init.sql`.

### `metrics_minute`: una fila por minuto
| Columna | Tipo | Significado (fuente: eventos de log de `logs_queue`) |
| :--- | :--- | :--- |
| `minute` | `TIMESTAMPTZ` PK | Minuto UTC según el `ts` **del log** (no la hora de llegada) |
| `clips_published` | `INTEGER` | `clip_published` del edge |
| `clips_processed` | `INTEGER` | `clip_processed` con `duplicate=false` |
| `clips_duplicate` | `INTEGER` | `clip_processed` con `duplicate=true` |
| `clips_failed` | `INTEGER` | `clip_failed` (edge y worker) |
| `clips_dead_lettered` | `INTEGER` | `clip_dead_lettered` |
| `duration_p95_ms` | `INTEGER` NULL | p95 de `duration_ms` de `clip_processed` (no duplicados) |
| `duration_avg_ms` | `INTEGER` NULL | promedio de lo mismo |
| `logs_total` | `INTEGER` | todos los logs del minuto |
| `logs_error` | `INTEGER` | logs con `level="ERROR"` |
| `logs_dropped` | `INTEGER` | suma del campo `dropped` de `logs_dropped` |
| `updated_at` | `TIMESTAMPTZ` | última escritura |

### `metrics_failures_minute`: fallos por minuto, servicio y etapa
| Columna | Tipo | Significado |
| :--- | :--- | :--- |
| `minute` | `TIMESTAMPTZ` | igual que arriba |
| `service` | `TEXT` | `edge-processor` o `cv-module` |
| `stage` | `TEXT` | `parse`, `download`, `detect`, `db`, `upload`, `publish`, `process` |
| `count` | `INTEGER` | cantidad de `clip_failed` |
| PK | `(minute, service, stage)` | |

## Garantías y semántica
- **Cuándo se escribe:** un minuto se escribe cuando ya cerró, con 30 s de margen (`METRICS_DB_FLUSH_S` = 15 s entre ciclos). El minuto en curso **no** está.
- **Logs atrasados:** se suman con UPSERT. Los contadores son exactos; el p95 de un minuto escrito en dos tandas queda como el **máximo** de los p95 (aproximación conservadora).
- **Base caída:** los minutos quedan en memoria del pipeline (hasta 180) y se reintentan. El consumo de `logs_queue` **no** espera a la base.
- **Pérdidas posibles:** si el pipeline muere, lo que tenía en memoria sin escribir. Si un servicio descarta logs (`logs_dropped`), esos minutos quedan bajos (el evento `logs_dropped` lo deja registrado).
- **Retención:** sin borrado automático (volumen chico: 1 fila por minuto ≈ 525 600 filas por año). Limpieza manual: `DELETE FROM metrics_minute WHERE minute < now() - interval '30 days';`

## Consultas de ejemplo
```sql
-- Últimos 10 minutos
SELECT minute, clips_published, clips_processed, clips_failed, duration_p95_ms
FROM metrics_minute ORDER BY minute DESC LIMIT 10;

-- Clips por hora del último día
SELECT date_trunc('hour', minute) AS hora, sum(clips_processed) AS clips
FROM metrics_minute WHERE minute > now() - interval '1 day' GROUP BY 1 ORDER BY 1;

-- Fallos por etapa en la última hora
SELECT service, stage, sum(count) FROM metrics_failures_minute
WHERE minute > now() - interval '1 hour' GROUP BY 1, 2 ORDER BY 3 DESC;
```
`docker compose exec metrics-db psql -U postgres -d metrics_db -c "<consulta>"`

**Medido (16/11/2026):** con 6 cámaras, `clips_published` = `clips_processed` ≈ 71–72 por minuto (6 × 60/5 = 72) y `duration_p95_ms` entre 214 y 416.

## Relación con Prometheus
Prometheus (3 días de retención) es la fuente para dashboards y alertas en tiempo real. La Metrics DB es el **histórico por SQL**, independiente del perfil `observability`. Los valores coinciden en definición con `edge_clips_published_total` y `worker_clips_total`, pero se calculan desde los logs: pueden diferir si se descartaron logs.

## Cambios al contrato
Agregar columnas solo con `ALTER TABLE … ADD COLUMN IF NOT EXISTS` en `agregador.py` (compatible hacia atrás). No renombrar ni borrar columnas sin avisar al equipo.
