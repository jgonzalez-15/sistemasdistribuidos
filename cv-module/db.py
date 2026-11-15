"""Escritura de resultados en results-db (PostgreSQL).

Una conexión por worker (cada réplica tiene la suya), creada recién cuando hace falta.
La idempotencia la da la base: `clip_id` es UNIQUE y el INSERT usa ON CONFLICT DO NOTHING,
así que si RabbitMQ entrega dos veces el mismo clip (o dos réplicas lo procesan) queda una sola fila.
"""
import psycopg2

import config

_conexion = None

_INSERT = """
    INSERT INTO results (clip_id, camera_id, intersection_id, ts, vehicle_count, frames_processed, processed_by)
    VALUES (%s, %s, %s, %s, %s, %s, %s)
    ON CONFLICT (clip_id) DO NOTHING
"""


def _obtener_conexion():
    """Devuelve la conexión abierta; si no hay o está cerrada, abre una nueva."""
    global _conexion
    if _conexion is None or _conexion.closed:
        _conexion = psycopg2.connect(
            host=config.RESULTS_DB_HOST,
            port=config.RESULTS_DB_PORT,
            dbname=config.RESULTS_DB_NAME,
            user=config.RESULTS_DB_USER,
            password=config.RESULTS_DB_PASS,
            connect_timeout=5,
        )
    return _conexion


def _descartar_conexion():
    """Cierra y olvida la conexión actual (por ejemplo, si la base se reinició)."""
    global _conexion
    if _conexion is not None:
        try:
            _conexion.close()
        except Exception:
            pass
    _conexion = None


def save_result(clip_id, camera_id, intersection_id, ts, vehicle_count, frames_processed, processed_by) -> bool:
    """Guarda el resultado de un clip. True si insertó la fila, False si ya existía (duplicado).

    processed_at no se manda: lo pone la base con now(), así todas las réplicas usan el mismo reloj.
    """
    valores = (clip_id, camera_id, intersection_id, ts, vehicle_count, frames_processed, processed_by)
    # Dos intentos: si la conexión guardada quedó vieja (OperationalError), se abre otra y se reintenta
    # una vez. Si vuelve a fallar, la excepción sube y el worker manda el mensaje a la DLQ.
    for intento in (1, 2):
        conexion = _obtener_conexion()
        try:
            with conexion.cursor() as cursor:
                cursor.execute(_INSERT, valores)
                insertado = cursor.rowcount == 1
            conexion.commit()
            return insertado
        except (psycopg2.OperationalError, psycopg2.InterfaceError):
            _descartar_conexion()
            if intento == 2:
                raise
        except Exception:
            conexion.rollback()
            raise
