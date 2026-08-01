"""Simple Redis K/V semantic cache for P1 (hash-based, no vector search)."""
import hashlib
import json
import logging
import os

import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

_THRESHOLD = 0.93  # reserved for P2 vector similarity; not used in P1 hash cache
_TTL = int(os.getenv("SEMANTIC_CACHE_TTL", "3600"))
_REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

_client: aioredis.Redis | None = None


async def _get_client() -> aioredis.Redis:
    global _client
    if _client is None:
        _client = aioredis.from_url(_REDIS_URL)
    return _client


async def cache_get(query_vec: list[float]) -> list[dict] | None:
    # P1 simplification: hash-based exact-match cache (rounded to 4 dp to absorb float noise)
    # P2 will switch to Redis vector search for semantic similarity
    key = "cache:q:" + hashlib.md5(
        str([round(v, 4) for v in query_vec]).encode()
    ).hexdigest()
    try:
        client = await _get_client()
        val = await client.get(key)
        if val:
            logger.info("Cache hit [key=%s]", key[-8:])
            return json.loads(val)
    except Exception as e:
        logger.warning("Cache get failed: %s", e)
    return None


async def cache_set(query_vec: list[float], chunks: list[dict]) -> None:
    key = "cache:q:" + hashlib.md5(
        str([round(v, 4) for v in query_vec]).encode()
    ).hexdigest()
    try:
        client = await _get_client()
        await client.set(key, json.dumps(chunks, default=str), ex=_TTL)
        logger.debug("Cache set [key=%s chunks=%d ttl=%ds]", key[-8:], len(chunks), _TTL)
    except Exception as e:
        logger.warning("Cache set failed: %s", e)


async def cache_invalidate_doc(doc_id: str) -> None:
    # P1: flush all retrieval cache keys when any doc changes.
    # P2 should use per-doc tagged keys to avoid full flush.
    try:
        client = await _get_client()
        deleted = 0
        async for key in client.scan_iter("cache:q:*"):
            await client.delete(key)
            deleted += 1
        logger.info("Cache invalidated [doc_id=%s deleted=%d keys]", doc_id, deleted)
    except Exception as e:
        logger.warning("Cache invalidation failed: %s", e)
