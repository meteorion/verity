import json
import logging
import os
import time

import redis.asyncio as aioredis

from graph.state import OrchestratorState

logger = logging.getLogger(__name__)

_REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
_FAQ_SCAN_LIMIT = 200
_FAQ_CACHE_TTL = 30.0  # seconds

# In-process cache of (question_lower, answer) pairs. faq_node runs on nearly
# every turn and FAQ misses are the common case, so scanning all faq:* keys and
# GET-ing each one per query is wasteful. Load them once per TTL window and match
# in memory instead; new/edited FAQs take up to _FAQ_CACHE_TTL seconds to appear.
_faq_cache: list[tuple[str, str]] | None = None
_faq_cache_at: float = 0.0


async def _load_faq_entries() -> list[tuple[str, str]]:
    """Scan Redis once and return [(question_lower, answer), ...]."""
    entries: list[tuple[str, str]] = []
    client = aioredis.from_url(_REDIS_URL, decode_responses=True)
    async with client:
        scanned = 0
        cursor = 0
        while True:
            cursor, keys = await client.scan(cursor=cursor, match="faq:*", count=100)
            for key in keys:
                if scanned >= _FAQ_SCAN_LIMIT:
                    break
                scanned += 1
                # Support both storage formats: JSON string (SET) or Redis Hash (HSET).
                entry: dict = {}
                val = await client.get(key)
                if val:
                    try:
                        entry = json.loads(val)
                    except (json.JSONDecodeError, TypeError):
                        pass
                if not entry:
                    entry = await client.hgetall(key)
                question = (entry.get("question") or "").lower().strip()
                if question:
                    entries.append((question, entry.get("answer", "")))
            if cursor == 0 or scanned >= _FAQ_SCAN_LIMIT:
                break
    return entries


async def _get_faq_entries() -> list[tuple[str, str]]:
    global _faq_cache, _faq_cache_at
    now = time.monotonic()
    if _faq_cache is not None and now - _faq_cache_at < _FAQ_CACHE_TTL:
        return _faq_cache
    try:
        _faq_cache = await _load_faq_entries()
        _faq_cache_at = now
    except Exception as e:
        # Redis unavailable — degrade gracefully: serve a stale cache if we have
        # one, otherwise behave as "no FAQ" and fall through to RAG.
        logger.warning("FAQ refresh failed (%s); %s", e, "using stale cache" if _faq_cache else "skipping FAQ")
        if _faq_cache is None:
            return []
    return _faq_cache


async def faq_node(state: OrchestratorState) -> dict:
    query_lower = state["query_raw"].lower().strip()

    for question, answer in await _get_faq_entries():
        if question in query_lower or query_lower in question:
            logger.info("FAQ hit [session=%s query=%r]", state.get("session_id"), query_lower[:60])
            return {"faq_hit": True, "answer_stream": answer, "intent": "faq"}

    logger.debug("FAQ miss [session=%s query=%r]", state.get("session_id"), query_lower[:60])
    return {"faq_hit": False, "answer_stream": None}
