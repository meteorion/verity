"""Hybrid retrieval: dense (always) + sparse (local provider only) → weighted RRF → Rerank.

API embedding mode: dense-only vector search via PGVector.
Local embedding mode: concurrent dense + sparse → weighted RRF fusion → rerank.
ACL/region filtering is enforced at the WHERE clause level (never post-filter).
"""
import asyncio
import logging
import os
from typing import Any

import asyncpg

from db import get_pool as _get_pool
from inference import embedding as emb_mod
from inference import rerank as rerank_mod

logger = logging.getLogger(__name__)

_EMBEDDING_PROVIDER = os.getenv("EMBEDDING_PROVIDER", "api")
_TOP_VECTOR = int(os.getenv("RETRIEVAL_TOP_VECTOR", "50"))
_TOP_K = int(os.getenv("RETRIEVAL_TOP_K", "6"))


def _retrieval_cfg() -> dict[str, Any]:
    try:
        from api.settings import load_settings
        s = load_settings()
        return {
            "top_k":                int(s.get("retrieval_top_k") or _TOP_K),
            "top_vector":           int(s.get("retrieval_top_vector") or _TOP_VECTOR),
            "dense_score_threshold": float(s.get("dense_score_threshold") or 0.0),
            "rrf_alpha":            float(s.get("rrf_alpha") or 0.6),
            "ef_search":            int(s.get("ef_search") or 40),
        }
    except Exception:
        return {
            "top_k":                _TOP_K,
            "top_vector":           _TOP_VECTOR,
            "dense_score_threshold": 0.0,
            "rrf_alpha":            0.6,
            "ef_search":            40,
        }


def _rrf_merge(
    rankings: list[list[str]],
    weights: list[float] | None = None,
    k: int = 60,
) -> list[str]:
    """Weighted Reciprocal Rank Fusion.

    weights[i] scales the contribution of rankings[i]; defaults to equal weights.
    For hybrid retrieval pass [alpha, 1-alpha] so dense and sparse can be tuned
    independently without changing the absolute scale.
    """
    if weights is None:
        weights = [1.0] * len(rankings)
    scores: dict[str, float] = {}
    for ranking, w in zip(rankings, weights):
        for rank, chunk_id in enumerate(ranking, start=1):
            scores[chunk_id] = scores.get(chunk_id, 0.0) + w / (k + rank)
    return sorted(scores, key=lambda x: scores[x], reverse=True)


async def hybrid_retrieve(
    query: str,
    roles: list[str],
    region: str,
    project_group: str | None = None,
    top_k: int | None = None,
) -> list[dict[str, Any]]:
    cfg = _retrieval_cfg()
    if top_k is None:
        top_k = cfg["top_k"]

    embed_results = await asyncio.to_thread(emb_mod.embed, [query], mode="both")
    dense_vec = embed_results[0].dense
    sparse_vec = embed_results[0].sparse  # None in API mode

    pool = await _get_pool()

    dense_rows = await _dense_search(
        pool, dense_vec, roles, region, cfg["top_vector"], project_group,
        ef_search=cfg["ef_search"],
        min_score=cfg["dense_score_threshold"],
    )

    if sparse_vec and _EMBEDDING_PROVIDER == "local":
        sparse_rows = await _sparse_search(
            pool, sparse_vec, roles, region, cfg["top_vector"], project_group,
        )
        dense_ids = [r["chunk_id"] for r in dense_rows]
        sparse_ids = [r["chunk_id"] for r in sparse_rows]
        alpha = cfg["rrf_alpha"]
        merged_ids = _rrf_merge([dense_ids, sparse_ids], weights=[alpha, 1.0 - alpha])
        row_map = {r["chunk_id"]: dict(r) for r in [*dense_rows, *sparse_rows]}
        candidates = [row_map[cid] for cid in merged_ids if cid in row_map]
        logger.debug(
            "Hybrid RRF merge: dense=%d sparse=%d merged=%d alpha=%.2f",
            len(dense_ids), len(sparse_ids), len(candidates), alpha,
        )
    else:
        candidates = [dict(r) for r in dense_rows]
        logger.debug("Dense-only retrieval: candidates=%d", len(candidates))

    passages = [c["content"] for c in candidates]
    ranked = rerank_mod.rerank(query, passages)
    results = [candidates[r["index"]] for r in ranked[:top_k] if r["index"] < len(candidates)]
    logger.info("Retrieval complete: top_k=%d returned=%d", top_k, len(results))
    return results


async def _dense_search(
    pool: asyncpg.Pool,
    vec: list[float],
    roles: list[str],
    region: str,
    limit: int,
    project_group: str | None = None,
    ef_search: int = 40,
    min_score: float = 0.0,
) -> list[asyncpg.Record]:
    vec_str = "[" + ",".join(str(v) for v in vec) + "]"
    pg_clause = ""
    if roles:
        acl_clause = "($2::text[] && acl OR 'role:public' = ANY(acl))"
        args: list = [vec_str, roles, region, limit]
        pg_idx = 5
    else:
        acl_clause = "'role:public' = ANY(acl)"
        args = [vec_str, region, limit]
        pg_idx = 4
    if project_group is not None:
        pg_clause = f" AND (${pg_idx} = ANY(product_line) OR 'global' = ANY(product_line))"
        args.append(project_group)
    region_idx = 3 if roles else 2
    limit_idx = 4 if roles else 3

    # min_score is a settings float (not user input) — safe to inline.
    score_clause = (
        f" AND 1 - (embedding <=> $1::vector) >= {min_score:.6f}"
        if min_score > 0.0 else ""
    )

    sql = f"""
        SELECT chunk_id, doc_id, content, breadcrumb, source_url, title,
               1 - (embedding <=> $1::vector) AS score
        FROM chunks
        WHERE {acl_clause}
          AND (${region_idx} = ANY(region) OR 'global' = ANY(region))
          AND (effective_from IS NULL OR effective_from <= now())
          AND (effective_to   IS NULL OR effective_to   >  now())
          AND is_parent = FALSE
          {score_clause}
          {pg_clause}
        ORDER BY embedding <=> $1::vector
        LIMIT ${limit_idx}
    """
    # SET LOCAL hnsw.ef_search only takes effect within a transaction block.
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(f"SET LOCAL hnsw.ef_search = {ef_search}")
            return await conn.fetch(sql, *args)


async def _sparse_search(
    pool: asyncpg.Pool,
    sparse: dict[str, float],
    roles: list[str],
    region: str,
    limit: int,
    project_group: str | None = None,
) -> list[asyncpg.Record]:
    sparse_str = emb_mod.sparse_to_pgvector(sparse)
    pg_clause = ""
    if roles:
        acl_clause = "($2::text[] && acl OR 'role:public' = ANY(acl))"
        args: list = [sparse_str, roles, region, limit]
        pg_idx = 5
    else:
        acl_clause = "'role:public' = ANY(acl)"
        args = [sparse_str, region, limit]
        pg_idx = 4
    if project_group is not None:
        pg_clause = f" AND (${pg_idx} = ANY(product_line) OR 'global' = ANY(product_line))"
        args.append(project_group)
    region_idx = 3 if roles else 2
    limit_idx = 4 if roles else 3
    sql = f"""
        SELECT chunk_id, doc_id, content, breadcrumb, source_url, title,
               (sparse_vector <#> $1::sparsevec) * -1 AS score
        FROM chunks
        WHERE {acl_clause}
          AND (${region_idx} = ANY(region) OR 'global' = ANY(region))
          AND (effective_from IS NULL OR effective_from <= now())
          AND (effective_to   IS NULL OR effective_to   >  now())
          AND is_parent = FALSE
          {pg_clause}
        ORDER BY sparse_vector <#> $1::sparsevec
        LIMIT ${limit_idx}
    """
    async with pool.acquire() as conn:
        return await conn.fetch(sql, *args)
