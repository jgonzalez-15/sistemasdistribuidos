from fastapi import FastAPI
import config

app = FastAPI(title="Auth Service")


@app.get("/health")
def health():
    return {"service": config.SERVICE_NAME, "status": "ok", "port": config.SERVICE_PORT}
