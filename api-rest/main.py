from contextlib import asynccontextmanager
from typing import Optional, Dict, Any
import os
import time
from fastapi import FastAPI, HTTPException, Header, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import requests
import config
import logs
import metrics  # noqa: F401  (registra api_access_denied_total y api_upstream_duration_seconds)
import observability

load_dotenv()

auth_url = os.getenv("AUTH_SERVICE_URL", config.AUTH_SERVICE_URL).rstrip("/")
visualization_url = os.getenv("VISUALIZATION_BACKEND_URL", config.VISUALIZATION_BACKEND_URL).rstrip("/")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logs.log_event("api_started", message=f"{config.SERVICE_NAME} started on port {config.SERVICE_PORT}")
    yield
    logs.log_event("api_stopping", message=f"{config.SERVICE_NAME} shutting down")
    logs.flush()


app = FastAPI(title="API REST", lifespan=lifespan)
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


class VisualizationRequestBody(BaseModel):
    token: str
    endpoint: str = "/health"
    method: str = "GET"
    payload: Optional[Dict[str, Any]] = None
    params: Optional[Dict[str, Any]] = None


class CameraCreateBody(BaseModel):
    id: str
    intersection_id: str
    code: str
    status: str = "active"


class IntersectionCreateBody(BaseModel):
    id: str
    name: str
    zone: str
    max_capacity: int = 100
    lat: float
    lng: float
    street_corridors: list[Any] = []


def normalize_role(role: Optional[str]) -> str:
    if not role:
        return "user"
    r = role.strip().lower()
    if r in ("admin", "administrador"):
        return "admin"
    return "user"


def extract_bearer_token(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(status_code=401, detail="Invalid Authorization header format. Expected 'Bearer <token>'")
    return parts[1].strip()


def verify_access(token: str, required_role: str = "user") -> dict:
    """
    Consults auth-service for the token state, validates whether it is active,
    and checks if the session role meets the required access level ('user' or 'admin').
    """
    start = time.monotonic()
    try:
        response = requests.post(
            f"{auth_url}/token/state",
            json={"token": token, "refresh": False},
            timeout=5,
        )
    except requests.exceptions.RequestException as e:
        logs.log_event(
            "token_verification_error",
            level="ERROR",
            duration_ms=(time.monotonic() - start) * 1000,
            message=f"Token verification exception thrown: {e}",
        )
        raise HTTPException(status_code=503, detail="Auth service unavailable")

    if not response.ok:
        logs.log_event(
            "token_verification_failed",
            level="WARNING",
            duration_ms=(time.monotonic() - start) * 1000,
            message="Token verification failed: invalid or unrecognized token",
            status_code=response.status_code,
        )
        raise HTTPException(status_code=401, detail="Invalid or unrecognized token")

    session_data = response.json()
    session_id = session_data.get("session_id")

    if not session_data.get("valid"):
        reason = session_data.get("reason", "inactive")
        logs.log_event(
            "access_denied",
            level="WARNING",
            session_id=session_id,
            duration_ms=(time.monotonic() - start) * 1000,
            message=f"Access denied: token is {reason}",
            reason=reason,
        )
        raise HTTPException(status_code=401, detail=f"Session is not valid ({reason})")

    user_role = normalize_role(session_data.get("role"))
    if normalize_role(required_role) == "admin" and user_role != "admin":
        logs.log_event(
            "access_denied",
            level="WARNING",
            session_id=session_id,
            duration_ms=(time.monotonic() - start) * 1000,
            message=f"Access denied: user '{session_data.get('user')}' with role '{user_role}' attempted admin action",
            user=session_data.get("user"),
            role=user_role,
            required_role="admin",
        )
        raise HTTPException(status_code=403, detail="Admin access level required")

    return session_data


def require_user(authorization: Optional[str] = Header(default=None)) -> dict:
    token = extract_bearer_token(authorization)
    return verify_access(token=token, required_role="user")


def require_admin(authorization: Optional[str] = Header(default=None)) -> dict:
    token = extract_bearer_token(authorization)
    return verify_access(token=token, required_role="admin")


def request_visualization_backend(
    endpoint: str,
    method: str = "GET",
    session_id: Optional[str] = None,
    payload: Optional[Dict[str, Any]] = None,
    params: Optional[Dict[str, Any]] = None,
):
    """
    Connection helper for forwarding requests to visualization-backend
    across HTTP methods (GET, POST, PUT, PATCH, DELETE) with structured session logging.
    """
    target_path = endpoint if endpoint.startswith("/") else f"/{endpoint}"
    target_url = f"{visualization_url}{target_path}"
    method_upper = method.upper()
    start = time.monotonic()

    logs.log_event(
        "visualization_request",
        session_id=session_id,
        message=f"Forwarding {method_upper} request to visualization-backend ({target_path})",
        method=method_upper,
        endpoint=target_path,
    )

    try:
        supported = {"GET", "POST", "PUT", "PATCH", "DELETE"}
        if method_upper not in supported:
            raise HTTPException(status_code=400, detail=f"Unsupported HTTP method: {method}")

        query_params = params if params is not None else (payload if method_upper == "GET" else None)
        json_body = payload if method_upper != "GET" else None

        response = requests.request(
            method=method_upper,
            url=target_url,
            params=query_params,
            json=json_body,
            timeout=10,
        )
        duration_ms = (time.monotonic() - start) * 1000

        if response.ok:
            logs.log_event(
                "visualization_response",
                session_id=session_id,
                duration_ms=duration_ms,
                message=f"Response received from visualization-backend ({target_path})",
                method=method_upper,
                endpoint=target_path,
                status_code=response.status_code,
            )
            return response.json()

        logs.log_event(
            "visualization_error",
            # 5xx = falla del servidor (ERROR); 4xx = pedido inválido, p. ej. intersección inexistente (WARNING)
            level="ERROR" if response.status_code >= 500 else "WARNING",
            session_id=session_id,
            duration_ms=duration_ms,
            message=f"Visualization-backend returned error status {response.status_code} ({target_path})",
            method=method_upper,
            endpoint=target_path,
            status_code=response.status_code,
        )
        raise HTTPException(status_code=response.status_code, detail=response.text)

    except HTTPException:
        raise
    except requests.exceptions.RequestException as e:
        logs.log_event(
            "visualization_unavailable",
            level="ERROR",
            session_id=session_id,
            duration_ms=(time.monotonic() - start) * 1000,
            message=f"Visualization-backend request exception thrown: {e}",
            method=method_upper,
            endpoint=target_path,
        )
        raise HTTPException(status_code=503, detail=f"Visualization backend unavailable: {e}")


@app.get("/")
def root():
    return {"service": config.SERVICE_NAME, "status": "ok", "port": config.SERVICE_PORT}


@app.get("/health")
def health():
    return {"service": config.SERVICE_NAME, "status": "ok", "port": config.SERVICE_PORT}


@app.post("/login")
def login(loginBody: LoginBody):
    login_user = (loginBody.user or loginBody.username or "").strip()
    if not login_user:
        raise HTTPException(status_code=422, detail="Missing 'user' or 'username'")

    start = time.monotonic()
    logs.log_event(
        "login_request",
        message=f"Login request received for user '{login_user}', sending to auth service",
        user=login_user,
    )
    try:
        response = requests.post(
            f"{auth_url}/login",
            json={"user": login_user, "username": login_user, "password": loginBody.password},
            timeout=5,
        )
        duration_ms = (time.monotonic() - start) * 1000

        if response.ok:
            data = response.json()
            session_id = data.get("session_id")
            role = data.get("role")
            logs.log_event(
                "login_success",
                session_id=session_id,
                duration_ms=duration_ms,
                message=f"Login response received from auth service for user '{login_user}' (role: {role})",
                user=login_user,
                role=role,
            )
            return data

        logs.log_event(
            "login_failed",
            level="WARNING",
            duration_ms=duration_ms,
            message=f"Login failed for user '{login_user}' (status {response.status_code})",
            user=login_user,
            status_code=response.status_code,
        )
        detail = response.json().get("detail", "Login failed") if response.content else "Login failed"
        raise HTTPException(status_code=response.status_code, detail=detail)
    except HTTPException:
        raise
    except requests.exceptions.RequestException as e:
        logs.log_event(
            "login_error",
            level="ERROR",
            duration_ms=(time.monotonic() - start) * 1000,
            message=f"Login exception thrown: {e}",
            user=login_user,
        )
        raise HTTPException(status_code=503, detail="Auth service unavailable")


@app.post("/logout")
def logout(tokenBody: Optional[TokenBody] = None, authorization: Optional[str] = Header(default=None)):
    token = tokenBody.token if tokenBody else extract_bearer_token(authorization)
    start = time.monotonic()
    logs.log_event("logout_request", message="Logout request received, sending to auth service")
    try:
        response = requests.post(f"{auth_url}/logout", json={"token": token}, timeout=5)
        duration_ms = (time.monotonic() - start) * 1000

        if response.ok:
            data = response.json()
            session_id = data.get("session_id")
            logs.log_event(
                "logout_success",
                session_id=session_id,
                duration_ms=duration_ms,
                message=f"Logout completed for user '{data.get('user')}'",
                user=data.get("user"),
                role=data.get("role"),
            )
            return data

        logs.log_event(
            "logout_failed",
            level="WARNING",
            duration_ms=duration_ms,
            message=f"Logout failed (status {response.status_code})",
            status_code=response.status_code,
        )
        detail = response.json().get("detail", "Logout failed") if response.content else "Logout failed"
        raise HTTPException(status_code=response.status_code, detail=detail)
    except HTTPException:
        raise
    except requests.exceptions.RequestException as e:
        logs.log_event(
            "logout_error",
            level="ERROR",
            duration_ms=(time.monotonic() - start) * 1000,
            message=f"Logout exception thrown: {e}",
        )
        raise HTTPException(status_code=503, detail="Auth service unavailable")


@app.post("/token/state")
def consult_token_state(body: TokenStateBody):
    action_event = "token_refresh" if body.refresh else "token_state_check"
    action_desc = "Token state & refresh" if body.refresh else "Token state consultation"
    start = time.monotonic()
    logs.log_event(f"{action_event}_request", message=f"{action_desc} request received, sending to auth service")
    try:
        response = requests.post(
            f"{auth_url}/token/state",
            json={"token": body.token, "refresh": body.refresh},
            timeout=5,
        )
        duration_ms = (time.monotonic() - start) * 1000

        if response.ok:
            data = response.json()
            session_id = data.get("session_id")
            valid = data.get("valid")
            refreshed = data.get("refreshed", False)
            logs.log_event(
                f"{action_event}_success",
                session_id=session_id,
                duration_ms=duration_ms,
                message=f"{action_desc} response received (valid={valid}, refreshed={refreshed}, role={data.get('role')})",
                valid=valid,
                refreshed=refreshed,
                role=data.get("role"),
            )
            return data

        logs.log_event(
            f"{action_event}_failed",
            level="WARNING",
            duration_ms=duration_ms,
            message=f"{action_desc} failed (status {response.status_code})",
            status_code=response.status_code,
        )
        detail = response.json().get("detail", "Token check failed") if response.content else "Token check failed"
        raise HTTPException(status_code=response.status_code, detail=detail)
    except HTTPException:
        raise
    except requests.exceptions.RequestException as e:
        logs.log_event(
            f"{action_event}_error",
            level="ERROR",
            duration_ms=(time.monotonic() - start) * 1000,
            message=f"{action_desc} exception thrown: {e}",
        )
        raise HTTPException(status_code=503, detail="Auth service unavailable")


@app.get("/token/state")
def consult_token_state_get(
    refresh: bool = Query(default=False),
    authorization: Optional[str] = Header(default=None),
):
    token = extract_bearer_token(authorization)
    return consult_token_state(TokenStateBody(token=token, refresh=refresh))


@app.post("/token/refresh")
def refresh_token(
    tokenBody: Optional[TokenBody] = None,
    authorization: Optional[str] = Header(default=None),
):
    token = tokenBody.token if tokenBody else extract_bearer_token(authorization)
    return consult_token_state(TokenStateBody(token=token, refresh=True))


@app.get("/api/intersections")
def get_intersections(session_data: dict = Depends(require_user)):
    """Frontend BFF endpoint: returns current intersection summaries from visualization-backend."""
    session_id = session_data.get("session_id")
    return request_visualization_backend(
        endpoint="/intersections",
        method="GET",
        session_id=session_id,
    )


@app.get("/api/intersections/{intersection_id}/history")
def get_intersection_history(
    intersection_id: str,
    limit: int = Query(default=14, ge=1, le=200),
    session_data: dict = Depends(require_user),
):
    """Frontend BFF endpoint: returns historical analytics for an intersection."""
    session_id = session_data.get("session_id")
    return request_visualization_backend(
        endpoint=f"/intersections/{intersection_id}/history",
        method="GET",
        session_id=session_id,
        params={"limit": limit},
    )


@app.get("/api/cameras")
def list_cameras(session_data: dict = Depends(require_user)):
    session_id = session_data.get("session_id")
    return request_visualization_backend(
        endpoint="/cameras",
        method="GET",
        session_id=session_id,
    )


@app.post("/api/cameras")
def create_camera(body: CameraCreateBody, session_data: dict = Depends(require_admin)):
    """Admin-only endpoint to register or update a camera in results-db."""
    session_id = session_data.get("session_id")
    return request_visualization_backend(
        endpoint="/cameras",
        method="POST",
        session_id=session_id,
        payload=body.model_dump(),
    )


@app.post("/api/intersections")
def create_intersection(body: IntersectionCreateBody, session_data: dict = Depends(require_admin)):
    """Admin-only endpoint to register or update an intersection in results-db."""
    session_id = session_data.get("session_id")
    return request_visualization_backend(
        endpoint="/intersections",
        method="POST",
        session_id=session_id,
        payload=body.model_dump(),
    )


@app.get("/api/system/health")
def system_health(session_data: dict = Depends(require_admin)):
    """Admin-only endpoint that aggregates /health from all peer backend services."""
    session_id = session_data.get("session_id")
    targets = {
        "api-rest": None,
        "auth-service": auth_url,
        "edge-processor": config.EDGE_PROCESSOR_URL.rstrip("/"),
        "cv-module": config.CV_MODULE_URL.rstrip("/"),
        "visualization-backend": visualization_url,
        "monitoring-pipeline": config.MONITORING_PIPELINE_URL.rstrip("/"),
    }
    results = {}
    for name, base_url in targets.items():
        if base_url is None:
            results[name] = {"status": "ok", "port": config.SERVICE_PORT}
            continue
        try:
            resp = requests.get(f"{base_url}/health", timeout=2)
            results[name] = resp.json() if resp.ok else {"status": "error", "http_status": resp.status_code}
        except requests.exceptions.RequestException as e:
            results[name] = {"status": "unreachable", "error": str(e)}

    logs.log_event(
        "system_health_checked",
        session_id=session_id,
        message=f"Admin '{session_data.get('user')}' queried aggregated system health",
        user=session_data.get("user"),
    )
    return {"services": results}


@app.post("/visualization/user")
def visualization_user_request(
    body: VisualizationRequestBody,
    authorization: Optional[str] = Header(default=None),
):
    """Template endpoint for user-level (and admin-level) requests to visualization-backend."""
    token = body.token or extract_bearer_token(authorization)
    session_data = verify_access(token=token, required_role="user")
    session_id = session_data.get("session_id")
    logs.log_event(
        "visualization_authorized",
        session_id=session_id,
        message=f"User-level visualization request authorized for '{session_data.get('user')}'",
        user=session_data.get("user"),
        role=session_data.get("role"),
    )
    return request_visualization_backend(
        endpoint=body.endpoint,
        method=body.method,
        session_id=session_id,
        payload=body.payload,
        params=body.params,
    )


@app.post("/visualization/admin")
def visualization_admin_request(
    body: VisualizationRequestBody,
    authorization: Optional[str] = Header(default=None),
):
    """Template endpoint for admin-only requests to visualization-backend."""
    token = body.token or extract_bearer_token(authorization)
    session_data = verify_access(token=token, required_role="admin")
    session_id = session_data.get("session_id")
    logs.log_event(
        "visualization_authorized",
        session_id=session_id,
        message=f"Admin-level visualization request authorized for '{session_data.get('user')}'",
        user=session_data.get("user"),
        role=session_data.get("role"),
    )
    return request_visualization_backend(
        endpoint=body.endpoint,
        method=body.method,
        session_id=session_id,
        payload=body.payload,
        params=body.params,
    )
