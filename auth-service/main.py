from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta
import psycopg2
from psycopg2.extras import RealDictCursor
import time
import uuid
import secrets
import config
import passwords
from logs import log_event
import metrics  # noqa: F401  (registra auth_login_total y auth_active_sessions)
import observability

app = FastAPI(title="Auth Service")
observability.setup(app)                         # GET /metrics + RED de HTTP

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LoginBody(BaseModel):
    user: Optional[str] = None
    username: Optional[str] = None
    password: str
    role: Optional[str] = None


class TokenBody(BaseModel):
    token: str


class TokenStateBody(BaseModel):
    token: str
    refresh: bool = False


def get_db_connection():
    return psycopg2.connect(
        host=config.AUTH_DB_HOST,
        port=config.AUTH_DB_PORT,
        dbname=config.AUTH_DB_NAME,
        user=config.AUTH_DB_USER,
        password=config.AUTH_DB_PASS,
        cursor_factory=RealDictCursor
    )


def init_db():
    """Ensure tables and the single user and admin accounts exist in auth-db."""
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    username VARCHAR(100) PRIMARY KEY,
                    password VARCHAR(255) NOT NULL,
                    role VARCHAR(50) NOT NULL DEFAULT 'user'
                );
            """)
            # Ensure role column exists if table was created from an older init.sql
            cur.execute("""
                ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'user';
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id VARCHAR(100) PRIMARY KEY,
                    token VARCHAR(255) UNIQUE NOT NULL,
                    username VARCHAR(100) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
                    role VARCHAR(50) NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP NOT NULL,
                    is_active BOOLEAN NOT NULL DEFAULT TRUE
                );
            """)
            # Usuarios de desarrollo: se crean con la contraseña ya hasheada (S1). Las contraseñas
            # vienen de la configuración (12-Factor III); si el usuario ya existe solo se ajusta el rol.
            for username, password, role in (
                ("user", config.AUTH_SEED_USER_PASSWORD, "user"),
                ("admin", config.AUTH_SEED_ADMIN_PASSWORD, "admin"),
            ):
                cur.execute(
                    """
                    INSERT INTO users (username, password, role) VALUES (%s, %s, %s)
                    ON CONFLICT (username) DO UPDATE SET role = EXCLUDED.role;
                    """,
                    (username, passwords.hash_password(password), role),
                )
            # Migración: toda contraseña que siga en texto plano (volúmenes creados antes de S1) se
            # reemplaza por su hash. No hace falta borrar el volumen de auth-db.
            cur.execute("SELECT username, password FROM users")
            migradas = 0
            for fila in cur.fetchall():
                if not passwords.es_hash(fila["password"]):
                    cur.execute("UPDATE users SET password = %s WHERE username = %s",
                                (passwords.hash_password(fila["password"]), fila["username"]))
                    migradas += 1
            if migradas:
                log_event("passwords_migrated", level="WARNING", migrated=migradas,
                          message=f"{migradas} contraseña(s) en texto plano reemplazadas por su hash")
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"Database initialization warning: {e}")
        return False


@app.on_event("startup")
def on_startup():
    # Si auth-db todavía no acepta conexiones, se reintenta: sin init_db no corre la migración de
    # contraseñas y los usuarios viejos (texto plano) no podrían entrar.
    for _ in range(10):
        if init_db():
            return
        time.sleep(2)


@app.post("/login")
def login(loginBody: LoginBody):
    login_user = (loginBody.user or loginBody.username or "").strip()
    if not login_user:
        raise HTTPException(status_code=422, detail="Missing 'user' or 'username'")

    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            # Se busca solo por usuario y el hash se verifica en Python (S1). Si el usuario no existe
            # se verifica igual contra un hash de relleno: misma demora y misma respuesta en ambos casos.
            cur.execute(
                "SELECT username, password, role FROM users WHERE username = %s",
                (login_user,)
            )
            user_record = cur.fetchone()
            guardado = user_record["password"] if user_record else passwords.HASH_RELLENO
            valida = passwords.verify_password(loginBody.password, guardado)

            if not user_record or not valida:
                conn.close()
                raise HTTPException(status_code=401, detail="Invalid username or password")

            # Generate a unique session_id and token for this specific connection/computer
            session_id = str(uuid.uuid4())
            token = secrets.token_hex(32)
            now = datetime.now()
            expires_at = now + timedelta(minutes=config.TOKEN_EXPIRATION_MINUTES)

            cur.execute(
                """
                INSERT INTO sessions (session_id, token, username, role, created_at, expires_at, is_active)
                VALUES (%s, %s, %s, %s, %s, %s, TRUE)
                """,
                (session_id, token, user_record["username"], user_record["role"], now, expires_at)
            )
        conn.commit()
        conn.close()

        return {
            "status": "ok",
            "user": user_record["username"],
            "username": user_record["username"],
            "role": user_record["role"],
            "session_id": session_id,
            "token": token,
            "access_token": token,
            "expires_at": expires_at.isoformat()
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Auth database error: {e}")


@app.post("/logout")
def logout(tokenBody: TokenBody):
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT session_id, username, role, is_active FROM sessions WHERE token = %s",
                (tokenBody.token,)
            )
            session = cur.fetchone()

            if not session:
                conn.close()
                raise HTTPException(status_code=404, detail="Session token not found")

            cur.execute(
                "UPDATE sessions SET is_active = FALSE WHERE token = %s",
                (tokenBody.token,)
            )
        conn.commit()
        conn.close()

        return {
            "status": "logged_out",
            "session_id": session["session_id"],
            "user": session["username"],
            "role": session["role"]
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Auth database error: {e}")


@app.post("/token/state")
def token_state(body: TokenStateBody):
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT session_id, token, username, role, created_at, expires_at, is_active
                FROM sessions WHERE token = %s
                """,
                (body.token,)
            )
            session = cur.fetchone()

            if not session:
                conn.close()
                raise HTTPException(status_code=401, detail="Invalid token")

            now = datetime.now()
            expires_at = session["expires_at"]

            if not session["is_active"] or expires_at <= now:
                if session["is_active"]:
                    cur.execute(
                        "UPDATE sessions SET is_active = FALSE WHERE session_id = %s",
                        (session["session_id"],)
                    )
                    conn.commit()
                conn.close()
                return {
                    "valid": False,
                    "reason": "expired" if expires_at <= now else "logged_out",
                    "session_id": session["session_id"],
                    "user": session["username"],
                    "role": session["role"],
                    "expires_at": expires_at.isoformat(),
                    "remaining_seconds": 0
                }

            refreshed = False
            if body.refresh:
                expires_at = now + timedelta(minutes=config.TOKEN_EXPIRATION_MINUTES)
                cur.execute(
                    "UPDATE sessions SET expires_at = %s WHERE session_id = %s",
                    (expires_at, session["session_id"])
                )
                conn.commit()
                refreshed = True

            remaining_seconds = max(0, int((expires_at - now).total_seconds()))
        conn.close()

        return {
            "valid": True,
            "refreshed": refreshed,
            "session_id": session["session_id"],
            "user": session["username"],
            "role": session["role"],
            "token": session["token"],
            "expires_at": expires_at.isoformat(),
            "remaining_seconds": remaining_seconds
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Auth database error: {e}")


@app.post("/token/refresh")
def refresh_token(tokenBody: TokenBody):
    return token_state(TokenStateBody(token=tokenBody.token, refresh=True))


@app.get("/")
def root():
    return {"service": config.SERVICE_NAME, "status": "ok", "port": config.SERVICE_PORT}


@app.get("/health")
def health():
    return {"service": config.SERVICE_NAME, "status": "ok", "port": config.SERVICE_PORT}
