import os

from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI(title="NetCheck API")

# The frontend (GitHub Pages) lives on a different domain, so the browser
# needs permission (CORS) to call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # later: ["https://rawan237.github.io"]
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

NO_CACHE = {"Cache-Control": "no-store"}  # never let the browser reuse an old answer
CHUNK_SIZE = 64 * 1024                    # 64 KB
CHUNK = os.urandom(CHUNK_SIZE)            # random bytes can't be compressed


@app.get("/ping")
def ping():
    """Tiny response: we only care how long the round trip takes."""
    return JSONResponse({"ok": True}, headers=NO_CACHE)


@app.get("/download")
def download(mb: int = Query(10, ge=1, le=50)):
    """Send `mb` megabytes; the browser times how long they take to arrive."""
    total = mb * 1024 * 1024

    def generate():
        sent = 0
        while sent < total:
            n = min(CHUNK_SIZE, total - sent)
            yield CHUNK[:n]
            sent += n

    headers = {**NO_CACHE, "Content-Length": str(total)}
    return StreamingResponse(generate(), media_type="application/octet-stream", headers=headers)


@app.post("/upload")
async def upload(request: Request):
    """Receive whatever the browser sends and report how many bytes arrived."""
    size = 0
    async for part in request.stream():
        size += len(part)
    return JSONResponse({"received_bytes": size}, headers=NO_CACHE)
