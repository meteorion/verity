import json
import logging
import os

import redis.asyncio as aioredis

from graph.state import OrchestratorState

logger = logging.getLogger(__name__)

_REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
_FAQ_SCAN_LIMIT = 200


async def faq_node(state: OrchestratorState) -> dict:
    query_lower = state["query_raw"].lower().strip()

    try:
        client = aioredis.from_url(_REDIS_URL, decode_responses=True)
        async with client:
            matched_answer = await _lookup_faq(client, query_lower)
    except Exception as e:
        # Redis unavailable — degrade gracefully, fall through to RAG
        logger.warning("FAQ Redis unavailable, skipping: %s", e)
        return {"faq_hit": False, "answer_stream": None}

    if matched_answer is not None:
        logger.info("FAQ hit [session=%s query=%r]", state.get("session_id"), query_lower[:60])
        return {"faq_hit": True, "answer_stream": matched_answer, "intent": "faq"}

    logger.debug("FAQ miss [session=%s query=%r]", state.get("session_id"), query_lower[:60])
    return {"faq_hit": False, "answer_stream": None}


async def _lookup_faq(client: aioredis.Redis, query_lower: str) -> str | None:
    scanned = 0
    cursor = 0

    while True:
        cursor, keys = await client.scan(cursor=cursor, match="faq:*", count=50)
        for key in keys:
            if scanned >= _FAQ_SCAN_LIMIT:
                break
            scanned += 1

            # Support both storage formats:
            # - JSON string (init_db.py uses SET + json.dumps)
            # - Redis Hash (HSET), for future use
            entry: dict = {}
            val = await client.get(key)
            if val:
                try:
                    entry = json.loads(val)
                except (json.JSONDecodeError, TypeError):
                    pass
            if not entry:
                entry = await client.hgetall(key)

            if not entry:
                continue
            question = entry.get("question", "").lower().strip()
            if not question:
                continue
            if question in query_lower or query_lower in question:
                return entry.get("answer", "")

        if cursor == 0 or scanned >= _FAQ_SCAN_LIMIT:
            break

    return None
