"""GET /pipeline/clips-per-minute: clips por minuto de los últimos N minutos, desde la Metrics DB.

Solo lectura sobre metrics_minute (contrato: docs/contrato-metrics-db.md; la escribe el
monitoring-pipeline). Formato camelCase con `timeSeries`, igual que /intersections/{id}/history.
"""
import os

import psycopg2
from fastapi import APIRouter, HTTPException, Query
from psycopg2.extras import RealDictCursor

router = APIRouter()


def _conexion():
    return psycopg2.connect(
        host=os.getenv("METRICS_DB_HOST", "metrics-db"),
        port=int(os.getenv("METRICS_DB_PORT", "5432")),
        dbname=os.getenv("METRICS_DB_NAME", "metrics_db"),
        user=os.getenv("METRICS_DB_USER", "postgres"),
        password=os.getenv("METRICS_DB_PASS", "postgres"),
        connect_timeout=3,
        cursor_factory=RealDictCursor,
    )


@router.get("/pipeline/clips-per-minute")
def clips_per_minute(minutes: int = Query(default=15, ge=1, le=240)):
    try:
        conn = _conexion()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT minute, clips_processed
                    FROM metrics_minute
                    WHERE minute > now() - make_interval(mins => %s)
                    ORDER BY minute ASC
                    """,
                    (minutes,),
                )
                filas = cur.fetchall()
        finally:
            conn.close()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Metrics DB query error: {e}")

    serie = [{"time": f["minute"].strftime("%H:%M"), "clips": int(f["clips_processed"])} for f in filas]
    return {
        "minutes": minutes,
        "timeSeries": serie,
        "lastClipsPerMinute": serie[-1]["clips"] if serie else None,
    }
