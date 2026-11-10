from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime
import pika
import requests
import config
from pydantic import BaseModel
from dotenv import load_dotenv
import os

load_dotenv()

auth_url = os.getenv("AUTH_SERVICE_URL")

class LoginBody(BaseModel):
    user: str
    password: str

app = FastAPI(title="API REST")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def rabbitMQpush(message:str):
    connection = pika.BlockingConnection(
    pika.ConnectionParameters(host='logs-queue')
    )
    channel = connection.channel()
    channel.queue_declare(queue='logs_queue', durable=True)
    channel.basic_publish(
        exchange='',
        routing_key='logs_queue',
        body=message
    )

    print(f'Message pushed into logs-queue: ({message})')
    connection.close()

def generate_log(log: str):
    time = datetime.now().strftime('%d-%m-%Y %H:%M:%S')
    return f"[{time}] {log}"

@app.post("/login")
def login(loginBody: LoginBody):
    rabbitMQpush(message=generate_log("Login request received, sending to auth service"))
    try:
        response = requests.post(auth_url, json={
            'user': loginBody.user,
            'password': loginBody.password
        })
        if response.ok:
            rabbitMQpush(message=generate_log("Login response received from auth service, sending to frontend"))
    except requests.exceptions.RequestException as e:
        rabbitMQpush(message=generate_log(f"Login exeption thown ({e})"))
    return

@app.get("/health")
def health():
    return {"service": config.SERVICE_NAME, "status": "ok", "port": config.SERVICE_PORT}
