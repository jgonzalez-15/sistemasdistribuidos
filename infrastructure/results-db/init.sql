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
