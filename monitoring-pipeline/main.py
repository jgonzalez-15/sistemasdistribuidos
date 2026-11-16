from fastapi import FastAPI
import config
import observability

app = FastAPI(title="Monitoring Metrics Pipeline")
observability.setup(app)                         # GET /metrics + RED de HTTP


@app.get("/health")
def health():
    return {"service": config.SERVICE_NAME, "status": "ok", "port": config.SERVICE_PORT}
