from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime
from typing import Optional, Dict, Any
import pika
import requests
import config
from pydantic import BaseModel
from dotenv import load_dotenv
import os

load_dotenv()

auth_url = os.getenv("AUTH_SERVICE_URL", config.AUTH_SERVICE_URL).rstrip("/")
visualization_url = os.getenv("VISUALIZATION_BACKEND_URL", config.VISUALIZATION_BACKEND_URL).rstrip("/")


class LoginBody(BaseModel):
    user: str
    password: str


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


app = FastAPI(title="API REST")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def rabbitMQpush(message: str):
    try:
        credentials = pika.PlainCredentials(config.LOGS_QUEUE_USER, config.LOGS_QUEUE_PASS)
        connection = pika.BlockingConnection(
            pika.ConnectionParameters(
                host=config.LOGS_QUEUE_HOST,
                port=config.LOGS_QUEUE_PORT,
                credentials=credentials
            )
        )
        channel = connection.channel()
        channel.queue_declare(queue=config.LOGS_QUEUE_NAME, durable=True)
        channel.basic_publish(
            exchange='',
            routing_key=config.LOGS_QUEUE_NAME,
            body=message
        )

        print(f'Message pushed into logs-queue: ({message})')
        connection.close()
    except Exception as e:
        print(f'Error pushing message into logs-queue: ({e}) | Original message: ({message})')


def generate_log(log: str, session_id: Optional[str] = None):
    time = datetime.now().strftime('%d-%m-%Y %H:%M:%S')
    if session_id:
        return f"[{time}] [Session: {session_id}] {log}"
    return f"[{time}] {log}"


def verify_access(token: str, required_role: str = "user") -> dict:
    """
    Consults auth-service for the token state, validates whether it is active,
    and checks if the session role meets the required access level ('user' or 'admin').
    """
    try:
        response = requests.post(f"{auth_url}/token/state", json={
            "token": token,
            "refresh": False
        })
    except requests.exceptions.RequestException as e:
        rabbitMQpush(message=generate_log(f"Token verification exception thrown ({e})"))
        raise HTTPException(status_code=503, detail="Auth service unavailable")

    if not response.ok:
        rabbitMQpush(message=generate_log("Token verification failed: invalid token"))
        raise HTTPException(status_code=401, detail="Invalid or unrecognized token")

    session_data = response.json()
    session_id = session_data.get("session_id")

    if not session_data.get("valid"):
        reason = session_data.get("reason", "inactive")
        rabbitMQpush(message=generate_log(f"Access denied: token is {reason}", session_id=session_id))
        raise HTTPException(status_code=401, detail=f"Session is not valid ({reason})")

    user_role = session_data.get("role")
    if required_role == "admin" and user_role != "admin":
        rabbitMQpush(message=generate_log(
            f"Access denied: user '{session_data.get('user')}' with role '{user_role}' attempted admin action",
            session_id=session_id
        ))
        raise HTTPException(status_code=403, detail="Admin access level required")

    return session_data


def request_visualization_backend(
    endpoint: str,
    method: str = "GET",
    session_id: Optional[str] = None,
    payload: Optional[Dict[str, Any]] = None
):
    """
    Basic connection template for forwarding requests to visualization-backend.
    """
    target_path = endpoint if endpoint.startswith("/") else f"/{endpoint}"
    target_url = f"{visualization_url}{target_path}"

    rabbitMQpush(message=generate_log(
        f"Forwarding {method.upper()} request to visualization-backend ({target_url})",
        session_id=session_id
    ))

    try:
        method_upper = method.upper()
        if method_upper == "GET":
            response = requests.get(target_url, params=payload)
        elif method_upper == "POST":
            response = requests.post(target_url, json=payload)
        elif method_upper == "PUT":
            response = requests.put(target_url, json=payload)
        elif method_upper == "DELETE":
            response = requests.delete(target_url, json=payload)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported HTTP method: {method}")

        if response.ok:
            rabbitMQpush(message=generate_log(
                f"Response received from visualization-backend ({target_url}), sending to frontend",
                session_id=session_id
            ))
            return response.json()
        else:
            rabbitMQpush(message=generate_log(
                f"Visualization-backend returned error status {response.status_code} ({target_url})",
                session_id=session_id
            ))
            raise HTTPException(status_code=response.status_code, detail=response.text)

    except requests.exceptions.RequestException as e:
        rabbitMQpush(message=generate_log(
            f"Visualization-backend request exception thrown ({e})",
            session_id=session_id
        ))
        raise HTTPException(status_code=503, detail=f"Visualization backend unavailable: {e}")


@app.post("/login")
def login(loginBody: LoginBody):
    rabbitMQpush(message=generate_log(f"Login request received for user '{loginBody.user}', sending to auth service"))
    try:
        response = requests.post(f"{auth_url}/login", json={
            'user': loginBody.user,
            'password': loginBody.password
        })
        if response.ok:
            data = response.json()
            session_id = data.get("session_id")
            role = data.get("role")
            rabbitMQpush(message=generate_log(
                f"Login response received from auth service for user '{loginBody.user}' (role: {role}), sending to frontend",
                session_id=session_id
            ))
            return data
        else:
            rabbitMQpush(message=generate_log(
                f"Login failed for user '{loginBody.user}' (status {response.status_code})"
            ))
            raise HTTPException(status_code=response.status_code, detail=response.json().get("detail", "Login failed"))
    except requests.exceptions.RequestException as e:
        rabbitMQpush(message=generate_log(f"Login exception thrown ({e})"))
        raise HTTPException(status_code=503, detail="Auth service unavailable")


@app.post("/logout")
def logout(tokenBody: TokenBody):
    rabbitMQpush(message=generate_log("Logout request received, sending to auth service"))
    try:
        response = requests.post(f"{auth_url}/logout", json={
            'token': tokenBody.token
        })
        if response.ok:
            data = response.json()
            session_id = data.get("session_id")
            rabbitMQpush(message=generate_log(
                f"Logout completed for user '{data.get('user')}', sending to frontend",
                session_id=session_id
            ))
            return data
        else:
            rabbitMQpush(message=generate_log(f"Logout failed (status {response.status_code})"))
            raise HTTPException(status_code=response.status_code, detail=response.json().get("detail", "Logout failed"))
    except requests.exceptions.RequestException as e:
        rabbitMQpush(message=generate_log(f"Logout exception thrown ({e})"))
        raise HTTPException(status_code=503, detail="Auth service unavailable")


@app.post("/token/state")
def consult_token_state(body: TokenStateBody):
    action_desc = "Token state & refresh" if body.refresh else "Token state consultation"
    rabbitMQpush(message=generate_log(f"{action_desc} request received, sending to auth service"))
    try:
        response = requests.post(f"{auth_url}/token/state", json={
            'token': body.token,
            'refresh': body.refresh
        })
        if response.ok:
            data = response.json()
            session_id = data.get("session_id")
            valid = data.get("valid")
            refreshed = data.get("refreshed", False)
            rabbitMQpush(message=generate_log(
                f"{action_desc} response received (valid={valid}, refreshed={refreshed}, role={data.get('role')}), sending to frontend",
                session_id=session_id
            ))
            return data
        else:
            rabbitMQpush(message=generate_log(f"{action_desc} failed (status {response.status_code})"))
            raise HTTPException(status_code=response.status_code, detail=response.json().get("detail", "Token check failed"))
    except requests.exceptions.RequestException as e:
        rabbitMQpush(message=generate_log(f"{action_desc} exception thrown ({e})"))
        raise HTTPException(status_code=503, detail="Auth service unavailable")


@app.post("/token/refresh")
def refresh_token(tokenBody: TokenBody):
    return consult_token_state(TokenStateBody(token=tokenBody.token, refresh=True))


@app.post("/visualization/user")
def visualization_user_request(body: VisualizationRequestBody):
    """
    Template endpoint for user-level (and admin-level) requests to visualization-backend.
    """
    session_data = verify_access(token=body.token, required_role="user")
    session_id = session_data.get("session_id")
    rabbitMQpush(message=generate_log(
        f"User-level visualization request authorized for '{session_data.get('user')}' (role: {session_data.get('role')})",
        session_id=session_id
    ))
    return request_visualization_backend(
        endpoint=body.endpoint,
        method=body.method,
        session_id=session_id,
        payload=body.payload
    )


@app.post("/visualization/admin")
def visualization_admin_request(body: VisualizationRequestBody):
    """
    Template endpoint for admin-only requests to visualization-backend.
    """
    session_data = verify_access(token=body.token, required_role="admin")
    session_id = session_data.get("session_id")
    rabbitMQpush(message=generate_log(
        f"Admin-level visualization request authorized for '{session_data.get('user')}' (role: {session_data.get('role')})",
        session_id=session_id
    ))
    return request_visualization_backend(
        endpoint=body.endpoint,
        method=body.method,
        session_id=session_id,
        payload=body.payload
    )


@app.get("/health")
def health():
    return {"service": config.SERVICE_NAME, "status": "ok", "port": config.SERVICE_PORT}
