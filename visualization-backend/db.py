import psycopg2
from psycopg2.extras import RealDictCursor
import config


def get_db_connection():
    return psycopg2.connect(
        host=config.RESULTS_DB_HOST,
        port=config.RESULTS_DB_PORT,
        dbname=config.RESULTS_DB_NAME,
        user=config.RESULTS_DB_USER,
        password=config.RESULTS_DB_PASS,
        cursor_factory=RealDictCursor,
    )


def init_db():
    """Ensure intersections and cameras tables exist and are seeded in results-db."""
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS results (
                    id               BIGSERIAL PRIMARY KEY,
                    clip_id          UUID        NOT NULL UNIQUE,
                    camera_id        TEXT        NOT NULL,
                    intersection_id  TEXT        NOT NULL,
                    ts               TIMESTAMPTZ NOT NULL,
                    vehicle_count    INTEGER     NOT NULL,
                    frames_processed INTEGER     NOT NULL,
                    processed_by     TEXT        NOT NULL,
                    processed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
                );
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_results_intersection_ts
                ON results (intersection_id, ts DESC);
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS intersections (
                    id               TEXT PRIMARY KEY,
                    name             TEXT NOT NULL,
                    zone             TEXT NOT NULL,
                    max_capacity     INTEGER NOT NULL DEFAULT 100,
                    lat              DOUBLE PRECISION NOT NULL,
                    lng              DOUBLE PRECISION NOT NULL,
                    street_corridors JSONB NOT NULL DEFAULT '[]'::jsonb,
                    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
                );
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS cameras (
                    id              TEXT PRIMARY KEY,
                    intersection_id TEXT NOT NULL REFERENCES intersections(id) ON DELETE CASCADE,
                    code            TEXT NOT NULL,
                    status          TEXT NOT NULL DEFAULT 'active',
                    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
                );
            """)
            cur.execute("""
                INSERT INTO intersections (id, name, zone, max_capacity, lat, lng, street_corridors) VALUES
                (
                    'int-1',
                    'Av. 18 de Julio y Ejido',
                    'Centro / Cordón',
                    110,
                    -34.905683,
                    -56.186853,
                    '[
                        {"name": "Av. 18 de Julio", "coordinates": [[-34.905785, -56.189701], [-34.905695, -56.187983], [-34.905611, -56.186863], [-34.905529, -56.185391], [-34.905078, -56.184099]]},
                        {"name": "Ejido", "coordinates": [[-34.908012, -56.186596], [-34.906546, -56.186755], [-34.905611, -56.186863], [-34.904615, -56.186981], [-34.903354, -56.187102]]}
                    ]'::jsonb
                ),
                (
                    'int-2',
                    'Bvar. Artigas y Av. Italia',
                    'Tres Cruces',
                    120,
                    -34.894857,
                    -56.164970,
                    '[
                        {"name": "Bvar. Gral. Artigas", "coordinates": [[-34.897539, -56.164615], [-34.896335, -56.164696], [-34.894894, -56.164868], [-34.893690, -56.165012], [-34.892165, -56.165186]]},
                        {"name": "Av. Italia", "coordinates": [[-34.893610, -56.162053], [-34.894260, -56.163514], [-34.894631, -56.164896], [-34.895125, -56.165045]]}
                    ]'::jsonb
                ),
                (
                    'int-3',
                    'Av. Gral. Rivera y L. A. de Herrera',
                    'Pocitos / Buceo',
                    95,
                    -34.901218,
                    -56.138478,
                    '[
                        {"name": "Av. Gral. Rivera", "coordinates": [[-34.902007, -56.141394], [-34.901646, -56.139894], [-34.901217, -56.138475], [-34.900755, -56.137081], [-34.900235, -56.135660]]},
                        {"name": "Av. L. A. de Herrera", "coordinates": [[-34.899097, -56.140134], [-34.900486, -56.138928], [-34.901218, -56.138478], [-34.902400, -56.137800]]}
                    ]'::jsonb
                )
                ON CONFLICT (id) DO NOTHING;
            """)
            cur.execute("""
                INSERT INTO cameras (id, intersection_id, code, status) VALUES
                    ('cam-1', 'int-1', 'CAM-MVD-101A', 'active'),
                    ('cam-2', 'int-1', 'CAM-MVD-101B', 'active'),
                    ('cam-3', 'int-2', 'CAM-MVD-102A', 'active'),
                    ('cam-4', 'int-2', 'CAM-MVD-102B', 'active'),
                    ('cam-5', 'int-3', 'CAM-MVD-103A', 'active'),
                    ('cam-6', 'int-3', 'CAM-MVD-103B', 'active')
                ON CONFLICT (id) DO NOTHING;
            """)
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Visualization DB initialization warning: {e}")
