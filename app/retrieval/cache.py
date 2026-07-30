"""Semantic cache backed by Redis Stack vector similarity search."""
import os

import redis.asyncio as aioredis

_THRESHOLD = float(os.getenv("SEMANTIC_CACHE_THRESHOLD", "0.93"))
_TTL = int(os.getenv("SEMANTIC_CACHE_TTL", "3600"))
_REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

_client: aioredis.Redis | None = None


async def get_client() -> aioredis.Redis:
    global _client
    if _client is None:
        _client = aioredis.from_url(_REDIS_URL)
    return _client


async def cache_get(query_vec: list[float]) -> list[dict] | None:
    # TODO: FT.SEARCH KNN with score filter
    return None


async def cache_set(query_vec: list[float], chunks: list[dict]) -> None:
    # TODO: HSET with TTL
    pass
