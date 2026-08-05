import asyncio
import json
import os

import redis.asyncio as aioredis
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse

from job_registry import TERMINAL_STATUSES, get_job, job_channel, list_jobs, request_cancel

router = APIRouter(prefix="/api/jobs")

_REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")


@router.get("")
async def get_jobs(status: str = "", job_type: str = "", limit: int = 30):
    jobs = await list_jobs(
        status=status or None,
        job_type=job_type or None,
        limit=min(limit, 100),
    )
    return {"jobs": jobs}


@router.get("/{job_id}")
async def get_job_detail(job_id: str):
    job = await get_job(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    return job


@router.post("/{job_id}/cancel", status_code=202)
async def cancel_job(job_id: str):
    job = await get_job(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    if job["status"] in TERMINAL_STATUSES:
        raise HTTPException(400, f"job already {job['status']}")
    await request_cancel(job_id)
    return {"job_id": job_id, "cancel_requested": True}


@router.get("/{job_id}/download")
async def download_job_file(job_id: str):
    job = await get_job(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    if job["job_type"] != "chunk_export":
        raise HTTPException(400, "download only available for chunk_export jobs")
    if job["status"] != "completed":
        raise HTTPException(400, f"job is '{job['status']}', not completed")

    result = job.get("result_data") or {}
    file_path = result.get("file_path")
    if not file_path or not os.path.isfile(file_path):
        raise HTTPException(404, "export file not found (may have expired after 24 h)")

    fmt = result.get("format", "jsonl")
    filename = result.get("filename", f"chunks_{job_id[:8]}.{fmt}")
    media_type = "application/json" if fmt == "json" else "application/x-ndjson"

    return FileResponse(path=file_path, media_type=media_type, filename=filename)


@router.get("/{job_id}/stream")
async def stream_job(job_id: str):
    job = await get_job(job_id)
    if not job:
        raise HTTPException(404, "job not found")

    async def event_gen():
        # Push current snapshot immediately (reconnect / initial load)
        yield f"data: {json.dumps(job, ensure_ascii=False)}\n\n"
        if job["status"] in TERMINAL_STATUSES:
            yield "data: [DONE]\n\n"
            return

        # Try Redis pub/sub; fall back to DB polling if unavailable
        try:
            rc = aioredis.from_url(_REDIS_URL, decode_responses=True)
            pubsub = rc.pubsub()
            await pubsub.subscribe(job_channel(job_id))
            try:
                async for message in pubsub.listen():
                    if message["type"] != "message":
                        continue
                    yield f"data: {message['data']}\n\n"
                    try:
                        payload = json.loads(message["data"])
                        if payload.get("status") in TERMINAL_STATUSES:
                            yield "data: [DONE]\n\n"
                            return
                    except Exception:
                        pass
            finally:
                await pubsub.unsubscribe(job_channel(job_id))
                await rc.aclose()
        except Exception:
            # Polling fallback when Redis pub/sub is unavailable
            while True:
                await asyncio.sleep(2)
                j = await get_job(job_id)
                if j:
                    yield f"data: {json.dumps(j, ensure_ascii=False)}\n\n"
                    if j["status"] in TERMINAL_STATUSES:
                        yield "data: [DONE]\n\n"
                        return

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
