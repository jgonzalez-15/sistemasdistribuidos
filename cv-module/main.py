from fastapi import FastAPI
import config

app = FastAPI(title="Computer Vision Module")

@app.get("/health")
def health():
    return {"service": config.SERVICE_NAME, "status": "ok", "port": config.SERVICE_PORT}
