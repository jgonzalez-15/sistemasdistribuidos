"""Hash de contraseñas con PBKDF2-HMAC-SHA256 (librería estándar, sin dependencias nuevas).

Formato guardado en users.password:  pbkdf2_sha256$<iteraciones>$<sal_b64>$<hash_b64>
- Sal aleatoria de 16 bytes por usuario: dos usuarios con la misma contraseña tienen hashes distintos.
- Iteraciones configurables (PBKDF2_ITERATIONS); por defecto 600000, valor recomendado por OWASP
  para PBKDF2-HMAC-SHA256. Cada hash guarda sus iteraciones, así subir el valor no invalida los viejos.
- La comparación usa hmac.compare_digest (tiempo constante).
Ver docs/decisiones-seguridad.md (S1).
"""
import base64
import hashlib
import hmac
import os

ALGORITMO = "pbkdf2_sha256"
ITERACIONES = int(os.getenv("PBKDF2_ITERATIONS", "600000"))


def _b64(datos: bytes) -> str:
    return base64.b64encode(datos).decode("ascii")


def hash_password(password: str, iteraciones: int = ITERACIONES) -> str:
    sal = os.urandom(16)
    derivado = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), sal, iteraciones)
    return f"{ALGORITMO}${iteraciones}${_b64(sal)}${_b64(derivado)}"


def es_hash(valor: str) -> bool:
    """True si el valor ya está en el formato hasheado (para migrar contraseñas viejas en texto plano)."""
    return isinstance(valor, str) and valor.startswith(ALGORITMO + "$") and valor.count("$") == 3


def verify_password(password: str, guardado: str) -> bool:
    try:
        algoritmo, iteraciones, sal_b64, hash_b64 = guardado.split("$")
        if algoritmo != ALGORITMO:
            return False
        sal = base64.b64decode(sal_b64)
        esperado = base64.b64decode(hash_b64)
        calculado = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), sal, int(iteraciones))
        return hmac.compare_digest(calculado, esperado)
    except Exception:
        return False


# Hash de relleno: si el usuario no existe se verifica igual contra este valor, para que el tiempo de
# respuesta no delate qué usuarios existen (enumeración de usuarios).
HASH_RELLENO = hash_password("relleno-sin-usuario")
