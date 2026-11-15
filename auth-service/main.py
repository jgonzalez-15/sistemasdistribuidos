from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime, timedelta
import psycopg2
from psycopg2.extras import RealDictCursor
import uuid
import secrets
import config

app = FastAPI(title="Auth Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LoginBody(BaseModel):
    user: str
    password: str


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
            cur.execute("""
                INSERT INTO users (username, password, role) VALUES
                    ('user', 'user123', 'user'),
                    ('admin', 'admin123', 'admin')
                ON CONFLICT (username) DO UPDATE SET role = EXCLUDED.role;
            """)
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Database initialization warning: {e}")


@app.on_event("startup")
def on_startup():
    init_db()


@app.post("/login")
def login(loginBody: LoginBody):
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT username, password, role FROM users WHERE username = %s AND password = %s",
                (loginBody.user, loginBody.password)
            )
            user_record = cur.fetchone()

            if not user_record:
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
            "role": user_record["role"],
            "session_id": session_id,
            "token": token,
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


@app.get("/health")
def health():
    return {"service": config.SERVICE_NAME, "status": "ok", "port": config.SERVICE_PORT}
