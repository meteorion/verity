"""Hybrid retrieval: dense (always) + sparse (local provider only) → RRF → Rerank.

API embedding mode: dense-only vector search via PGVector.
Local embedding mode: concurrent dense + sparse → RRF fusion → rerank.
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


def _rrf_merge(rankings: list[list[str]], k: int = 60) -> list[str]:
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, chunk_id in enumerate(ranking, start=1):
            scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (k + rank)
    return sorted(scores, key=lambda x: scores[x], reverse=True)


async def hybrid_retrieve(
    query: str,
    roles: list[str],
    region: str,
    project_group: str | None = None,
    top_k: int = _TOP_K,
) -> list[dict[str, Any]]:
    # embed() is synchronous and blocking (local CPU inference, or a blocking
    # httpx.post in API mode) — offload to a thread so it never stalls the event loop.
    embed_results = await asyncio.to_thread(emb_mod.embed, [query], mode="both")
    dense_vec = embed_results[0].dense
    sparse_vec = embed_results[0].sparse  # None in API mode

    pool = await _get_pool()

    # Dense retrieval is always available
    dense_rows = await _dense_search(pool, dense_vec, roles, region, _TOP_VECTOR, project_group)

    if sparse_vec and _EMBEDDING_PROVIDER == "local":
        # Sparse retrieval only makes sense with BGE-M3 sparse output
        sparse_rows = await _sparse_search(pool, sparse_vec, roles, region, _TOP_VECTOR, project_group)
        dense_ids = [r["chunk_id"] for r in dense_rows]
        sparse_ids = [r["chunk_id"] for r in sparse_rows]
        merged_ids = _rrf_merge([dense_ids, sparse_ids])
        row_map = {r["chunk_id"]: dict(r) for r in [*dense_rows, *sparse_rows]}
        candidates = [row_map[cid] for cid in merged_ids if cid in row_map]
        logger.debug(
            "Hybrid RRF merge: dense=%d sparse=%d merged=%d",
            len(dense_ids), len(sparse_ids), len(candidates),
        )
    else:
        candidates = [dict(r) for r in dense_rows]
        logger.debug("Dense-only retrieval: candidates=%d", len(candidates))

    # Rerank (no-op when RERANK_PROVIDER=none)
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
) -> list[asyncpg.Record]:
    vec_str = "[" + ",".join(str(v) for v in vec) + "]"
    pg_clause = ""
    # When roles is empty, skip the overlap check — only public docs are accessible.
    # Passing an empty Python list to asyncpg can cause type-inference errors.
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
    sql = f"""
        SELECT chunk_id, doc_id, content, breadcrumb, source_url, title,
               1 - (embedding <=> $1::vector) AS score
        FROM chunks
        WHERE {acl_clause}
          AND (${region_idx} = ANY(region) OR 'global' = ANY(region))
          AND (effective_to IS NULL OR effective_to > now())
          {pg_clause}
        ORDER BY embedding <=> $1::vector
        LIMIT ${limit_idx}
    """
    async with pool.acquire() as conn:
        return await conn.fetch(sql, *args)


async def _sparse_search(
    pool: asyncpg.Pool,
    sparse: dict[str, float],
    roles: list[str],
    region: str,
    limit: int,
    project_group: str | None = None,
) -> list[asyncpg.Record]:
    tokens = sorted(sparse.items(), key=lambda x: -x[1])[:256]
    sparse_str = "{" + ",".join(f"{k}:{v:.6f}" for k, v in tokens) + "}/" + str(30522)
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
          AND (effective_to IS NULL OR effective_to > now())
          {pg_clause}
        ORDER BY sparse_vector <#> $1::sparsevec
        LIMIT ${limit_idx}
    """
    async with pool.acquire() as conn:
        return await conn.fetch(sql, *args)
