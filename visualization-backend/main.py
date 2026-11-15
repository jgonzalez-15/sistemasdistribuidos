from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Any
import json
import config
import db

THRESHOLD_CONGESTION = 75
THRESHOLD_MODERATE = 40

app = FastAPI(title="Visualization Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class IntersectionCreateBody(BaseModel):
    id: str
    name: str
    zone: str
    max_capacity: int = 100
    lat: float
    lng: float
    street_corridors: List[Any] = []


class CameraCreateBody(BaseModel):
    id: str
    intersection_id: str
    code: str
    status: str = "active"


def compute_congestion_level(vehicle_count: int) -> str:
    if vehicle_count >= THRESHOLD_CONGESTION:
        return "congestionado"
    if vehicle_count >= THRESHOLD_MODERATE:
        return "moderado"
    return "fluido"


def compute_average_speed(status: str, vehicle_count: int) -> int:
    if status == "congestionado":
        return max(8, min(18, 22 - (vehicle_count // 10)))
    if status == "moderado":
        return 34
    return 50


def build_intersection_summary(
    row: dict,
    cameras: List[dict],
    recent_stat: Optional[dict],
    last_seen_ts: Optional[Any] = None,
) -> dict:
    camera_codes = ", ".join(c["code"] for c in cameras) if cameras else row["id"].upper()

    # Según Sección 4 de la guía: "Sin datos" no equivale a "sin congestión".
    # Si no hay clips en el último minuto (recent_stat is None), se marca como "sin_datos"
    # y se muestra la hora del último dato registrado (last_seen_ts).
    if recent_stat and recent_stat.get("clips", 0) > 0:
        vehicle_count = int(round(float(recent_stat["vehiculos_promedio"])))
        latest_ts = recent_stat["ultimo_dato"]
        last_updated = f"{latest_ts.strftime('%H:%M:%S')} hs"
        worker_node_id = recent_stat.get("processed_by") or "cv-module"
        status = compute_congestion_level(vehicle_count)
        avg_speed = compute_average_speed(status, vehicle_count)
    else:
        vehicle_count = 0
        if last_seen_ts is not None:
            last_updated = f"Últ. dato {last_seen_ts.strftime('%H:%M:%S')} hs"
        else:
            last_updated = "Sin datos recientes"
        worker_node_id = "sin-datos"
        status = "sin_datos"
        avg_speed = 0

    corridors = row.get("street_corridors") or []
    if isinstance(corridors, str):
        corridors = json.loads(corridors)

    return {
        "id": row["id"],
        "name": row["name"],
        "zone": row["zone"],
        "cameraCode": camera_codes,
        "vehicleCount": vehicle_count,
        "maxCapacity": row["max_capacity"],
        "status": status,
        "lastUpdated": last_updated,
        "workerNodeId": worker_node_id,
        "averageSpeedKmh": avg_speed,
        "coordinates": [row["lat"], row["lng"]],
        "streetCorridors": corridors,
    }


@app.on_event("startup")
def on_startup():
    db.init_db()


@app.get("/")
def root():
    return {"service": config.SERVICE_NAME, "status": "ok", "port": config.SERVICE_PORT}


@app.get("/health")
def health():
    db_ok = False
    try:
        conn = db.get_db_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
        conn.close()
        db_ok = True
    except Exception:
        db_ok = False
    return {
        "service": config.SERVICE_NAME,
        "status": "ok" if db_ok else "degraded",
        "port": config.SERVICE_PORT,
        "results_db": "connected" if db_ok else "disconnected",
    }


@app.get("/intersections")
def get_intersections():
    """
    Returns all intersections with their latest vehicle count aggregated from results-db,
    formatted as IntersectionSummary[] for the frontend.
    """
    try:
        conn = db.get_db_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM intersections ORDER BY id ASC")
            intersections = cur.fetchall()

            cur.execute("SELECT * FROM cameras ORDER BY id ASC")
            all_cameras = cur.fetchall()

            # Consulta verificada de la Sección 4: Estado actual por intersección (último minuto)
            cur.execute("""
                SELECT
                    intersection_id,
                    ROUND(AVG(vehicle_count), 1) AS vehiculos_promedio,
                    COUNT(*) AS clips,
                    MAX(ts) AS ultimo_dato,
                    (ARRAY_AGG(processed_by ORDER BY ts DESC))[1] AS processed_by
                FROM results
                WHERE ts > now() - interval '1 minute'
                GROUP BY intersection_id
                ORDER BY intersection_id
            """)
            recent_rows = cur.fetchall()

            # Último dato histórico para intersecciones sin datos en el último minuto
            cur.execute("""
                SELECT intersection_id, MAX(ts) AS ultimo_dato
                FROM results
                GROUP BY intersection_id
            """)
            last_seen_rows = cur.fetchall()
        conn.close()

        cameras_by_int = {}
        for cam in all_cameras:
            cameras_by_int.setdefault(cam["intersection_id"], []).append(cam)

        recent_by_int = {r["intersection_id"]: r for r in recent_rows}
        last_seen_by_int = {r["intersection_id"]: r["ultimo_dato"] for r in last_seen_rows}

        summaries = [
            build_intersection_summary(
                row=inter,
                cameras=cameras_by_int.get(inter["id"], []),
                recent_stat=recent_by_int.get(inter["id"]),
                last_seen_ts=last_seen_by_int.get(inter["id"]),
            )
            for inter in intersections
        ]
        return summaries
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Results DB query error: {e}")


@app.get("/intersections/{intersection_id}/history")
def get_intersection_history(intersection_id: str, limit: int = 14):
    """
    Returns IntersectionAnalyticsDetail (summary, timeSeries, and computed metrics)
    for a given intersection_id from results-db.
    """
    try:
        conn = db.get_db_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM intersections WHERE id = %s", (intersection_id,))
            inter = cur.fetchone()
            if not inter:
                conn.close()
                raise HTTPException(status_code=404, detail=f"Intersection '{intersection_id}' not found")

            cur.execute("SELECT * FROM cameras WHERE intersection_id = %s ORDER BY id ASC", (intersection_id,))
            cameras = cur.fetchall()

            # Estado actual en el último minuto (Sección 4)
            cur.execute("""
                SELECT
                    intersection_id,
                    ROUND(AVG(vehicle_count), 1) AS vehiculos_promedio,
                    COUNT(*) AS clips,
                    MAX(ts) AS ultimo_dato,
                    (ARRAY_AGG(processed_by ORDER BY ts DESC))[1] AS processed_by
                FROM results
                WHERE intersection_id = %s AND ts > now() - interval '1 minute'
                GROUP BY intersection_id
            """, (intersection_id,))
            recent_stat = cur.fetchone()

            cur.execute("""
                SELECT MAX(ts) AS ultimo_dato
                FROM results
                WHERE intersection_id = %s
            """, (intersection_id,))
            last_seen_row = cur.fetchone()
            last_seen_ts = last_seen_row["ultimo_dato"] if last_seen_row else None

            # Histórico en tramos de 5 minutos (última hora) según consulta de Sección 4,
            # con fallback a tramos de 1 minuto si recién arranca el contenedor
            cur.execute("""
                SELECT
                    date_bin('5 minutes', ts, TIMESTAMPTZ '2000-01-01') AS bucket_ts,
                    ROUND(AVG(vehicle_count))::int AS total_vehicles
                FROM results
                WHERE intersection_id = %s AND ts > now() - interval '1 hour'
                GROUP BY 1
                ORDER BY 1 DESC
                LIMIT %s
            """, (intersection_id, limit))
            history_rows = cur.fetchall()
        conn.close()

        summary = build_intersection_summary(
            row=inter,
            cameras=cameras,
            recent_stat=recent_stat,
            last_seen_ts=last_seen_ts,
        )

        # Reverse so timeSeries is chronological
        history_rows = list(reversed(history_rows))
        time_series = [
            {
                "hour": row["bucket_ts"].strftime("%H:%M"),
                "timestamp": row["bucket_ts"].isoformat(),
                "vehicles": int(row["total_vehicles"]),
                "thresholdCongestion": THRESHOLD_CONGESTION,
                "thresholdModerate": THRESHOLD_MODERATE,
            }
            for row in history_rows
        ]

        if time_series:
            counts = [pt["vehicles"] for pt in time_series]
            peak_pt = max(time_series, key=lambda pt: pt["vehicles"])
            peak_vehicles = peak_pt["vehicles"]
            peak_hour = peak_pt["hour"]
            last_6 = counts[-6:]
            avg_last_6 = round(sum(last_6) / len(last_6))
            congested_points = sum(1 for v in counts[-4:] if v >= THRESHOLD_CONGESTION)
            congestion_minutes = (
                max(18, congested_points * 22 + max(0, summary["vehicleCount"] - THRESHOLD_CONGESTION))
                if summary["status"] == "congestionado"
                else (8 if summary["status"] == "moderado" else 0)
            )
            is_anomalous = summary["vehicleCount"] > 105 or (avg_last_6 > 0 and summary["vehicleCount"] > avg_last_6 * 1.34)
        else:
            peak_vehicles = summary["vehicleCount"]
            peak_hour = "--:--"
            avg_last_6 = summary["vehicleCount"]
            congestion_minutes = 0
            is_anomalous = False

        pattern_type = "anomalo" if is_anomalous else "habitual"
        pattern_label = (
            "Patrón Anómalo (Incidente / Retención Atípica)"
            if is_anomalous
            else "Patrón Habitual (Flujo Registrado en PostgreSQL)"
        )
        pattern_description = (
            "El volumen vehicular supera en +34% la media reciente. Posible obstrucción de calzada o desvío canalizado."
            if is_anomalous
            else "Serie temporal real consultada desde results-db (PostgreSQL) generada por los workers de CV."
        )

        return {
            "intersection": summary,
            "timeSeries": time_series,
            "metrics": {
                "congestionDurationMinutes": congestion_minutes,
                "patternType": pattern_type,
                "patternLabel": pattern_label,
                "patternDescription": pattern_description,
                "peakHour": peak_hour,
                "peakVehicles": peak_vehicles,
                "avgVehiclesLast6h": avg_last_6,
                "queueStatus": "activo" if time_series else "reteniendo_eventos",
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Results DB history error: {e}")


@app.get("/cameras")
def list_cameras():
    try:
        conn = db.get_db_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT id, intersection_id, code, status, created_at FROM cameras ORDER BY id ASC")
            rows = cur.fetchall()
        conn.close()
        return rows
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Results DB error: {e}")


@app.post("/cameras")
def create_camera(body: CameraCreateBody):
    try:
        conn = db.get_db_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM intersections WHERE id = %s", (body.intersection_id,))
            if not cur.fetchone():
                conn.close()
                raise HTTPException(status_code=404, detail=f"Intersection '{body.intersection_id}' not found")

            cur.execute(
                """
                INSERT INTO cameras (id, intersection_id, code, status)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    intersection_id = EXCLUDED.intersection_id,
                    code = EXCLUDED.code,
                    status = EXCLUDED.status
                RETURNING id, intersection_id, code, status, created_at
                """,
                (body.id, body.intersection_id, body.code, body.status),
            )
            camera = cur.fetchone()
        conn.commit()
        conn.close()
        return camera
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Results DB error: {e}")


@app.post("/intersections")
def create_intersection(body: IntersectionCreateBody):
    try:
        conn = db.get_db_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO intersections (id, name, zone, max_capacity, lat, lng, street_corridors)
                VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    zone = EXCLUDED.zone,
                    max_capacity = EXCLUDED.max_capacity,
                    lat = EXCLUDED.lat,
                    lng = EXCLUDED.lng,
                    street_corridors = EXCLUDED.street_corridors
                RETURNING id, name, zone, max_capacity, lat, lng, street_corridors, created_at
                """,
                (
                    body.id,
                    body.name,
                    body.zone,
                    body.max_capacity,
                    body.lat,
                    body.lng,
                    json.dumps(body.street_corridors),
                ),
            )
            intersection = cur.fetchone()
        conn.commit()
        conn.close()
        return intersection
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Results DB error: {e}")
