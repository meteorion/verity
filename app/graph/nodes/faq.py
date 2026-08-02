import asyncio
import json
import logging
import os
import time

import redis.asyncio as aioredis

from graph.state import OrchestratorState

logger = logging.getLogger(__name__)

_REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
_FAQ_SCAN_LIMIT = 200
_FAQ_TEXT_TTL  = 30.0   # seconds — text refreshes quickly so edits appear fast
_FAQ_EMBED_TTL = 300.0  # seconds — embeddings are expensive; 5-min is fine

# Cache A: plain (question_lower, answer) pairs for exact string match
_faq_text_cache: list[tuple[str, str]] | None = None
_faq_text_cache_at: float = 0.0

# Cache B: (question_lower, answer, embedding) triples for semantic match
_faq_embed_cache: list[tuple[str, str, list[float] | None]] | None = None
_faq_embed_cache_at: float = 0.0

# Thresholds
_HARD_THRESHOLD = float(os.getenv("FAQ_SEMANTIC_HARD_THRESHOLD", "0.96"))
_SOFT_THRESHOLD = float(os.getenv("FAQ_SEMANTIC_SOFT_THRESHOLD", "0.80"))


# ---------------------------------------------------------------------------
# Redis helpers
# ---------------------------------------------------------------------------

async def _load_faq_entries() -> list[tuple[str, str]]:
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


async def _get_faq_text() -> list[tuple[str, str]]:
    global _faq_text_cache, _faq_text_cache_at
    now = time.monotonic()
    if _faq_text_cache is not None and now - _faq_text_cache_at < _FAQ_TEXT_TTL:
        return _faq_text_cache
    try:
        _faq_text_cache = await _load_faq_entries()
        _faq_text_cache_at = now
    except Exception as e:
        logger.warning("FAQ text refresh failed (%s); %s", e,
                       "using stale cache" if _faq_text_cache else "skipping FAQ")
        if _faq_text_cache is None:
            return []
    return _faq_text_cache


async def _get_faq_with_embeddings() -> list[tuple[str, str, list[float] | None]]:
    """Return FAQ entries with embeddings; re-embeds when cache expires."""
    global _faq_embed_cache, _faq_embed_cache_at
    now = time.monotonic()
    if _faq_embed_cache is not None and now - _faq_embed_cache_at < _FAQ_EMBED_TTL:
        return _faq_embed_cache

    text_entries = await _get_faq_text()
    if not text_entries:
        _faq_embed_cache = []
        _faq_embed_cache_at = now
        return []

    questions = [q for q, _ in text_entries]
    try:
        from inference import embedding as emb_mod
        embed_results = await asyncio.to_thread(emb_mod.embed, questions, mode="dense")
        embeddings: list[list[float] | None] = [r.dense for r in embed_results]
    except Exception as exc:
        logger.warning("FAQ embedding failed (%s); falling back to text-only match", exc)
        embeddings = [None] * len(text_entries)

    _faq_embed_cache = [
        (q, a, emb) for (q, a), emb in zip(text_entries, embeddings)
    ]
    _faq_embed_cache_at = now
    return _faq_embed_cache


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na  = sum(x * x for x in a) ** 0.5
    nb  = sum(x * x for x in b) ** 0.5
    return dot / (na * nb) if na and nb else 0.0


# ---------------------------------------------------------------------------
# Graph node
# ---------------------------------------------------------------------------

async def faq_node(state: OrchestratorState) -> dict:
    query_raw   = state["query_raw"]
    query_lower = query_raw.lower().strip()

    entries = await _get_faq_with_embeddings()

    # 1. Exact string match (zero-cost, handles typo-free standard phrases)
    for q, a, _ in entries:
        if q in query_lower or query_lower in q:
            logger.info("FAQ exact hit [session=%s query=%r]", state.get("session_id"), query_lower[:60])
            return {"faq_hit": True, "answer_stream": a, "intent": "faq", "faq_context": None}

    # 2. Semantic match — only if at least one FAQ has an embedding
    if any(emb is not None for _, _, emb in entries):
        try:
            from inference import embedding as emb_mod
            qvec_results = await asyncio.to_thread(emb_mod.embed, [query_raw], mode="dense")
            qvec = qvec_results[0].dense

            best_score, best_answer = 0.0, ""
            for _, a, evec in entries:
                if evec is None:
                    continue
                score = _cosine(qvec, evec)
                if score > best_score:
                    best_score, best_answer = score, a

            if best_score >= _HARD_THRESHOLD:
                logger.info("FAQ semantic HIT [session=%s score=%.3f]", state.get("session_id"), best_score)
                return {"faq_hit": True, "answer_stream": best_answer, "intent": "faq", "faq_context": None}
            if best_score >= _SOFT_THRESHOLD:
                logger.info("FAQ soft hit [session=%s score=%.3f]; injecting as context", state.get("session_id"), best_score)
                return {"faq_hit": False, "answer_stream": None, "faq_context": best_answer}
        except Exception as exc:
            logger.warning("FAQ semantic match failed (%s)", exc)

    logger.debug("FAQ miss [session=%s query=%r]", state.get("session_id"), query_lower[:60])
    return {"faq_hit": False, "answer_stream": None, "faq_context": None}
