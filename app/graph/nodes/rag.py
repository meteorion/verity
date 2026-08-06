import asyncio
import logging

from graph.state import OrchestratorState
from retrieval.hybrid import hybrid_retrieve
from retrieval.small_to_big import expand_to_parent

logger = logging.getLogger(__name__)


def _use_small_to_big() -> bool:
    try:
        from api.settings import load_settings
        v = load_settings().get("use_small_to_big")
        if v is None:
            return True
        return str(v).lower() not in ("false", "0", "no")
    except Exception:
        return True


async def _multi_retrieve(
    primary_query: str,
    sub_queries: list[str],
    roles: list[str],
    region: str,
    project_group: str | None,
    top_k: int,
) -> list[dict]:
    """Parallel retrieval for all sub-queries; dedup + score-rank merge."""
    all_queries = [primary_query] + sub_queries
    results = await asyncio.gather(*[
        hybrid_retrieve(q, roles, region, project_group, top_k * 2)
        for q in all_queries
    ], return_exceptions=True)

    # Merge: keep best score per chunk_id across all result sets
    seen: dict[str, dict] = {}
    for i, res in enumerate(results):
        if isinstance(res, Exception):
            logger.warning("Multi-query sub-retrieval %d failed: %s", i, res)
            continue
        for chunk in res:
            cid = chunk.get("chunk_id", "")
            if cid not in seen or chunk.get("score", 0) > seen[cid].get("score", 0):
                seen[cid] = chunk

    merged = sorted(seen.values(), key=lambda c: c.get("score", 0), reverse=True)
    logger.info("Multi-query merge: queries=%d candidates=%d top_k=%d",
                len(all_queries), len(merged), top_k)
    return merged[:top_k]


async def rag_node(state: OrchestratorState) -> dict:
    query  = state.get("query_rewritten") or state["query_raw"]
    top_k  = state.get("top_k") or 6
    roles  = state["roles"]
    region = state["region"]
    pg     = state.get("project_group")
    multi  = state.get("multi_queries")

    if multi:
        chunks = await _multi_retrieve(query, multi, roles, region, pg, top_k)
    else:
        chunks = await hybrid_retrieve(
            query=query,
            roles=roles,
            region=region,
            project_group=pg,
            top_k=top_k,
            dense_vec=state.get("query_embedding"),
        )

    if _use_small_to_big():
        chunks = await expand_to_parent(chunks)
    return {"retrieved_chunks": chunks}
