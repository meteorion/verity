"""Query rewrite node — normalization + coreference resolution + semantic cache.

P1 pipeline:
  1. normalize_query  — strip stop-prefixes, convert Chinese numerals
  2. semantic cache   — embed query, cosine-scan Redis; short-circuit on hit
  3. LLM rewrite      — resolve pronouns/omissions using recent history (conditional)
"""
import asyncio
import hashlib
import json
import logging
import os
import re

from graph.state import OrchestratorState

logger = logging.getLogger(__name__)

_REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
_CACHE_TTL = int(os.getenv("SEMANTIC_CACHE_TTL", "86400"))          # 24 h
_CACHE_THRESHOLD = float(os.getenv("SEMANTIC_CACHE_THRESHOLD", "0.93"))

# Pronouns / discourse markers that indicate coreference
_COREF_WORDS = {"它", "这", "那", "上面", "刚才", "之前", "那个", "这个", "这些", "那些", "上述"}
_LEAD_WORDS  = {"那", "还有", "另外", "此外", "而且", "然后"}

_STOP_PREFIX_RE = re.compile(
    r"^(请问|我想知道|我想问|我要问|请帮我|帮我|麻烦问一?下|请|"
    r"能告诉我|能不能告诉我|你好[，,]?|您好[，,]?)\s*",
    re.IGNORECASE,
)

# Chinese numeral → Arabic (handles 一→1 … 九十九→99, 百/千/万)
_CN_NUM  = {"零": 0, "一": 1, "两": 2, "二": 2, "三": 3, "四": 4,
            "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
_CN_UNIT = {"十": 10, "百": 100, "千": 1000, "万": 10000}


def _cn_to_int(s: str) -> int:
    total, cur = 0, 0
    for ch in s:
        if ch in _CN_NUM:
            cur = _CN_NUM[ch]
        elif ch in _CN_UNIT:
            unit = _CN_UNIT[ch]
            total += (cur or 1) * unit
            cur = 0
    return total + cur


def normalize_query(query: str) -> str:
    """Strip noise prefixes and convert Chinese numerals to Arabic digits."""
    query = _STOP_PREFIX_RE.sub("", query.strip())
    query = re.sub(
        r"[零一二三四五六七八九十百千万]+",
        lambda m: str(_cn_to_int(m.group(0))) if _cn_to_int(m.group(0)) else m.group(0),
        query,
    )
    return query.strip()


def _should_rewrite(query: str, history: list[dict]) -> bool:
    """Return True when the query likely contains unresolved coreferences."""
    if not history:
        return False
    if len(query) >= 25:
        return False
    lower = query.lower()
    return any(w in lower for w in _COREF_WORDS) or any(lower.startswith(w) for w in _LEAD_WORDS)


async def _llm_rewrite(query: str, history: list[dict]) -> str:
    from inference.llm import get_fast_llm
    from langchain_core.messages import HumanMessage, SystemMessage

    recent = history[-3:]
    history_text = "\n".join(
        f"{'用户' if t['role'] == 'user' else '客服'}：{t['content'][:300]}"
        for t in recent
    )
    system = (
        "你是一个查询改写助手。根据对话历史，将用户最新的问题改写为可以独立理解的完整问题。"
        "只输出改写后的问题，不要任何解释。如果问题已经完整，原样输出。"
    )
    user = f"对话历史：\n{history_text}\n\n用户最新问题：{query}\n\n改写后的问题："
    llm = get_fast_llm(max_tokens=120, temperature=0.0)
    logger.debug("Rewrite LLM [model=%s]", llm.model_name)
    resp = await llm.ainvoke([SystemMessage(content=system), HumanMessage(content=user)])
    content = resp.content
    if isinstance(content, list):
        content = "".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in content)
    return content.strip() or query


# ---------------------------------------------------------------------------
# Semantic cache helpers
# ---------------------------------------------------------------------------

def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na  = sum(x * x for x in a) ** 0.5
    nb  = sum(x * x for x in b) ** 0.5
    return dot / (na * nb) if na and nb else 0.0


async def _check_cache(vec: list[float]) -> dict | None:
    try:
        import redis.asyncio as aioredis
        rc = aioredis.from_url(_REDIS_URL, decode_responses=True)
        async with rc:
            cursor, best_score, best_entry = 0, 0.0, None
            while True:
                cursor, keys = await rc.scan(cursor=cursor, match="semantic_cache:*", count=200)
                for key in keys:
                    raw = await rc.get(key)
                    if not raw:
                        continue
                    try:
                        entry = json.loads(raw)
                    except Exception:
                        continue
                    ev = entry.get("embedding")
                    if not ev:
                        continue
                    score = _cosine(vec, ev)
                    if score > best_score:
                        best_score, best_entry = score, entry
                if cursor == 0:
                    break
        if best_score >= _CACHE_THRESHOLD and best_entry:
            logger.info("Semantic cache HIT (cosine=%.3f)", best_score)
            return best_entry
    except Exception as exc:
        logger.debug("Semantic cache check error: %s", exc)
    return None


async def write_cache(query: str, vec: list[float], answer: str, refs: list[dict]) -> None:
    """Write a cache entry; called fire-and-forget from generate_node."""
    if not answer:
        return
    try:
        import redis.asyncio as aioredis
        key = f"semantic_cache:{hashlib.sha256(query.encode()).hexdigest()[:16]}"
        payload = json.dumps(
            {"query": query, "embedding": vec, "answer": answer, "refs": refs},
            ensure_ascii=False,
        )
        rc = aioredis.from_url(_REDIS_URL, decode_responses=True)
        async with rc:
            await rc.set(key, payload, ex=_CACHE_TTL)
        logger.debug("Semantic cache WRITE key=%s", key)
    except Exception as exc:
        logger.debug("Semantic cache write error: %s", exc)


# ---------------------------------------------------------------------------
# Multi-query expansion (P2)
# ---------------------------------------------------------------------------

_COMPLEX_CONNECTORS = {"和", "与", "或", "以及", "还有", "同时", "另外"}


def _should_expand(query: str, intent: str | None) -> bool:
    """True for product comparison / long queries that benefit from sub-query diversity."""
    return (
        intent == "product_inquiry"
        or len(query) > 20
        or any(c in query for c in _COMPLEX_CONNECTORS)
    )


async def _multi_query_expand(query: str, n: int = 3) -> list[str]:
    from inference.llm import get_fast_llm
    from langchain_core.messages import HumanMessage, SystemMessage

    system = (
        f"将用户问题改写为{n}个不同检索角度的子问题，每行一个，"
        "不要编号、不要解释，不要输出原问题。"
    )
    user = f"问题：{query}"
    llm = get_fast_llm(max_tokens=200, temperature=0.3)
    logger.debug("Expand LLM [model=%s]", llm.model_name)
    resp = await llm.ainvoke([SystemMessage(content=system), HumanMessage(content=user)])
    content = resp.content
    if isinstance(content, list):
        content = "".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in content)
    lines = [ln.strip() for ln in content.strip().splitlines() if ln.strip()]
    return lines[:n]


# ---------------------------------------------------------------------------
# Graph node
# ---------------------------------------------------------------------------

async def rewrite_node(state: OrchestratorState) -> dict:
    query = normalize_query(state["query_raw"])
    history = state.get("history_recent") or []
    intent = state.get("intent")

    # Embed query (dense only; sparse not needed for cache/rewrite)
    from inference import embedding as emb_mod
    embed_results = await asyncio.to_thread(emb_mod.embed, [query], mode="dense")
    vec: list[float] = embed_results[0].dense

    # 1. Semantic cache — skip entirely when use_cache=false in settings
    _use_cache = True
    try:
        from api.settings import load_settings
        v = load_settings().get("use_cache")
        if v is not None:
            _use_cache = str(v).lower() not in ("false", "0", "no")
    except Exception:
        pass
    cached = (await _check_cache(vec)) if _use_cache else None
    if cached:
        # Restore refs so chat.py can emit [REFS] for citation markers in the answer.
        # Old cache entries have "chunk_ids" (list[str]); new entries have "refs" (list[dict]).
        cached_refs = cached.get("refs") or []
        return {
            "query_rewritten": query,
            "query_embedding": vec,
            "cache_hit": True,
            "answer_stream": cached["answer"],
            "retrieved_chunks": cached_refs,
            "multi_queries": None,
        }

    # 2. Coreference rewrite + multi-query expansion (run concurrently if both needed)
    rewritten = query
    multi_queries: list[str] | None = None

    do_rewrite = _should_rewrite(query, history)
    do_expand = _should_expand(query, intent)

    tasks = []
    if do_rewrite:
        tasks.append(_llm_rewrite(query, history))
    if do_expand:
        tasks.append(_multi_query_expand(query))

    if tasks:
        results = await asyncio.gather(*tasks, return_exceptions=True)
        idx = 0
        if do_rewrite:
            r = results[idx]; idx += 1
            if isinstance(r, str) and r != query:
                rewritten = r
                logger.info("Query rewritten [session=%s] %r → %r", state.get("session_id"), query, rewritten)
            elif isinstance(r, Exception):
                logger.warning("LLM rewrite failed (%s)", r)
        if do_expand:
            r = results[idx]
            if isinstance(r, list) and r:
                multi_queries = r
                logger.info("Multi-query expanded [session=%s] n=%d", state.get("session_id"), len(r))
            elif isinstance(r, Exception):
                logger.warning("Multi-query expand failed (%s)", r)

    return {
        "query_rewritten": rewritten,
        "query_embedding": vec,
        "cache_hit": False,
        "multi_queries": multi_queries,
    }
