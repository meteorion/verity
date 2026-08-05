"""Unified background job registry.

Workers call publish_progress() at each progress step. SSE consumers in
api/jobs.py subscribe to per-job Redis pub/sub channels for real-time push.
PostgreSQL is the source of truth; Redis is the push channel.
"""
import json
import os
from uuid import uuid4

import redis.asyncio as aioredis

from db import get_pool

_REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
_redis_client: aioredis.Redis | None = None

TERMINAL_STATUSES = frozenset({"completed", "failed", "cancelled"})


def job_channel(job_id: str) -> str:
    return f"job:progress:{job_id}"


async def _get_redis() -> aioredis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(_REDIS_URL, decode_responses=True)
    return _redis_client


async def create_job(
    job_type: str,
    display_name: str,
    ref_id: str | None = None,
    created_by: str = "system",
    total: int = 0,
) -> str:
    job_id = str(uuid4())
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO background_jobs
               (job_id, job_type, display_name, ref_id, created_by, progress_total)
               VALUES ($1, $2, $3, $4, $5, $6)""",
            job_id, job_type, display_name, ref_id, created_by, total,
        )
    return job_id


async def mark_running(job_id: str) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE background_jobs SET status = 'running', started_at = now() WHERE job_id = $1",
            job_id,
        )


async def publish_progress(
    job_id: str,
    status: str,
    current: int = 0,
    total: int = 0,
    phase: str | None = None,
    result_data: dict | None = None,
    error_message: str | None = None,
) -> None:
    """Write progress to DB and push to Redis pub/sub channel."""
    result_json = json.dumps(result_data, ensure_ascii=False) if result_data is not None else None
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """UPDATE background_jobs SET
               status           = $2,
               progress_current = $3,
               progress_total   = $4,
               progress_phase   = $5,
               result_data      = $6::jsonb,
               error_message    = $7,
               completed_at     = CASE WHEN $2 = ANY(ARRAY['completed','failed','cancelled'])
                                       THEN now() ELSE completed_at END
               WHERE job_id = $1""",
            job_id, status, current, total, phase, result_json, error_message,
        )

    payload = json.dumps({
        "job_id": job_id,
        "status": status,
        "current": current,
        "total": total,
        "phase": phase,
        "result": result_data,
        "error": error_message,
    }, ensure_ascii=False)

    try:
        rc = await _get_redis()
        await rc.publish(job_channel(job_id), payload)
    except Exception:
        pass  # Redis unavailable — SSE falls back to DB polling, DB is consistent


async def get_job(job_id: str) -> dict | None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM background_jobs WHERE job_id = $1", job_id
        )
    return _to_dict(row) if row else None


async def list_jobs(
    status: str | None = None,
    job_type: str | None = None,
    limit: int = 30,
) -> list[dict]:
    clauses: list[str] = []
    params: list = []
    if status:
        params.append(status)
        clauses.append(f"status = ${len(params)}")
    if job_type:
        params.append(job_type)
        clauses.append(f"job_type = ${len(params)}")
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(limit)
    sql = f"SELECT * FROM background_jobs {where} ORDER BY created_at DESC LIMIT ${len(params)}"
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
    return [_to_dict(r) for r in rows]


async def request_cancel(job_id: str) -> bool:
    pool = await get_pool()
    async with pool.acquire() as conn:
        tag = await conn.execute(
            "UPDATE background_jobs SET cancel_requested = TRUE"
            " WHERE job_id = $1 AND status IN ('running', 'pending')",
            job_id,
        )
    return tag.endswith("1")


async def is_cancel_requested(job_id: str) -> bool:
    pool = await get_pool()
    async with pool.acquire() as conn:
        val = await conn.fetchval(
            "SELECT cancel_requested FROM background_jobs WHERE job_id = $1", job_id
        )
    return bool(val)


async def reset_orphaned_jobs() -> int:
    """On startup: mark any jobs stuck in 'running' as failed (process restart)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        tag = await conn.execute(
            """UPDATE background_jobs
               SET status = 'failed', error_message = '服务重启，任务中断', completed_at = now()
               WHERE status IN ('running', 'pending')""",
        )
    count = int(tag.split()[-1])
    return count


def _to_dict(row) -> dict:
    d = dict(row)
    for k in ("created_at", "started_at", "completed_at"):
        if d.get(k) is not None:
            d[k] = d[k].isoformat()
    if isinstance(d.get("result_data"), str):
        try:
            d["result_data"] = json.loads(d["result_data"])
        except Exception:
            pass
    return d
