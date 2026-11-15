-- Results Database
-- Dueño del archivo: Joaco G (agrega intersections, cameras y metrics).

-- Tabla results: la escribe cv-module (contrato de Manu).
-- clip_id UNIQUE hace idempotente el reproceso: con entrega at-least-once el mismo
-- clip puede llegar dos veces, y el INSERT ... ON CONFLICT (clip_id) DO NOTHING lo guarda una sola vez.
CREATE TABLE IF NOT EXISTS results (
    id               BIGSERIAL PRIMARY KEY,
    clip_id          UUID        NOT NULL UNIQUE,
    camera_id        TEXT        NOT NULL,              -- ej. cam-1
    intersection_id  TEXT        NOT NULL,              -- ej. int-1
    ts               TIMESTAMPTZ NOT NULL,              -- momento de captura del clip (reloj del edge)
    vehicle_count    INTEGER     NOT NULL,              -- mediana de los conteos por frame, redondeada
    frames_processed INTEGER     NOT NULL,
    processed_by     TEXT        NOT NULL,              -- hostname de la réplica de cv-module
    processed_at     TIMESTAMPTZ NOT NULL DEFAULT now() -- reloj de la base (uno solo para todas las réplicas)
);

-- Consultas del dashboard: estado e histórico por intersección.
CREATE INDEX IF NOT EXISTS idx_results_intersection_ts ON results (intersection_id, ts DESC);

-- Tabla de intersecciones monitoreadas (PK de texto int-N, decisión D4)
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

-- Tabla de cámaras asociadas a intersecciones (PK de texto cam-N, decisión D4)
CREATE TABLE IF NOT EXISTS cameras (
    id              TEXT PRIMARY KEY,
    intersection_id TEXT NOT NULL REFERENCES intersections(id) ON DELETE CASCADE,
    code            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed inicial alineado con edge-processor (CAMERA_IDS=cam-1:int-1,...,cam-6:int-3)
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

INSERT INTO cameras (id, intersection_id, code, status) VALUES
    ('cam-1', 'int-1', 'CAM-MVD-101A', 'active'),
    ('cam-2', 'int-1', 'CAM-MVD-101B', 'active'),
    ('cam-3', 'int-2', 'CAM-MVD-102A', 'active'),
    ('cam-4', 'int-2', 'CAM-MVD-102B', 'active'),
    ('cam-5', 'int-3', 'CAM-MVD-103A', 'active'),
    ('cam-6', 'int-3', 'CAM-MVD-103B', 'active')
ON CONFLICT (id) DO NOTHING;
