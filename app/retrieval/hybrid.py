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
from pgvector.asyncpg import register_vector

from db import get_pool as _get_pool
from inference import embedding as emb_mod
from inference import rerank as rerank_mod
from retrieval.cache import cache_get, cache_set

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
            "ef_search":            int(s.get("hnsw_ef_search") or 100),
            "rerank_threshold":     float(s.get("rerank_threshold") or 0.0),
        }
    except Exception:
        return {
            "top_k":                _TOP_K,
            "top_vector":           _TOP_VECTOR,
            "dense_score_threshold": 0.0,
            "rrf_alpha":            0.6,
            "ef_search":            100,
            "rerank_threshold":     0.0,
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
    return sorted(scores, key=lambda x: scores[x], reverse=True), scores


async def hybrid_retrieve(
    query: str,
    roles: list[str],
    region: str,
    project_group: str | None = None,
    top_k: int | None = None,
    dense_vec: list[float] | None = None,  # pre-computed by rewrite_node; avoids re-embedding
) -> list[dict[str, Any]]:
    cfg = _retrieval_cfg()
    if top_k is None:
        top_k = cfg["top_k"]

    if dense_vec is not None and _EMBEDDING_PROVIDER != "local":
        # API mode: dense only; reuse pre-computed vector directly
        sparse_vec = None
    else:
        # Local mode needs sparse, or dense_vec wasn't supplied: embed now
        mode = "sparse" if (dense_vec is not None and _EMBEDDING_PROVIDER == "local") else "both"
        embed_results = await asyncio.to_thread(emb_mod.embed, [query], mode=mode)
        if dense_vec is None:
            dense_vec = embed_results[0].dense
        sparse_vec = embed_results[0].sparse

    cached = await cache_get(dense_vec)
    if cached is not None:
        return cached

    pool = await _get_pool()

    dense_rows = await _dense_search(
        pool, dense_vec, roles, region, cfg["top_vector"], project_group,
        ef_search=cfg["ef_search"],
        min_score=cfg["dense_score_threshold"],
    )

    dense_ids = [r["chunk_id"] for r in dense_rows]
    # cosine_chunk_ids: chunks whose "score" is cosine similarity (dense + question).
    # Sparse inner-product scores are not cosine-comparable, so they must skip the threshold filter.
    cosine_chunk_ids: set[str] = set(dense_ids)
    row_map: dict[str, dict] = {r["chunk_id"]: dict(r) for r in dense_rows}
    base_rankings = [dense_ids]
    base_weights  = [1.0]

    if sparse_vec and _EMBEDDING_PROVIDER == "local":
        sparse_rows = await _sparse_search(
            pool, sparse_vec, roles, region, cfg["top_vector"], project_group,
        )
        sparse_ids = [r["chunk_id"] for r in sparse_rows]
        # Only add sparse entries that aren't already in row_map — preserve the cosine score
        # for chunks found by both paths (sparse inner-product score is not cosine-comparable).
        for r in sparse_rows:
            if r["chunk_id"] not in row_map:
                row_map[r["chunk_id"]] = dict(r)
        alpha = cfg["rrf_alpha"]
        base_rankings = [dense_ids, sparse_ids]
        base_weights  = [alpha, 1.0 - alpha]
        logger.debug("Hybrid sparse+dense: dense=%d sparse=%d alpha=%.2f",
                     len(dense_ids), len(sparse_ids), alpha)
    else:
        logger.debug("Dense-only retrieval: candidates=%d", len(dense_ids))

    # Initial merge (may be replaced below if question results arrive)
    merged_ids, rrf_scores = _rrf_merge(base_rankings, weights=base_weights)
    candidates = [row_map[cid] for cid in merged_ids if cid in row_map]

    # Question-augmentation: chunks whose LLM-generated questions match the query
    question_rows = await _question_search(
        pool, dense_vec, roles, region, cfg["top_vector"], project_group,
        min_score=cfg["dense_score_threshold"],
        ef_search=cfg["ef_search"],
    )
    question_ids = list(dict.fromkeys(r["chunk_id"] for r in question_rows))

    if question_ids:
        for r in question_rows:
            if r["chunk_id"] not in row_map:
                row_map[r["chunk_id"]] = dict(r)
            cosine_chunk_ids.add(r["chunk_id"])  # question scores are cosine — threshold applies
        # Scale base weights to 0.7, question contribution = 0.3
        scale = 0.7 / sum(base_weights)
        final_ids, rrf_scores = _rrf_merge(
            base_rankings + [question_ids],
            weights=[w * scale for w in base_weights] + [0.3],
        )
        candidates = [row_map[cid] for cid in final_ids if cid in row_map]
        logger.debug("Question-augmented merge: q_chunks=%d final=%d", len(question_ids), len(candidates))

    # Apply dense_score_threshold on raw cosine similarity BEFORE RRF normalization.
    # Only applies to cosine-comparable scores (dense + question search).
    # Sparse-only chunks bypass the filter — their inner-product score is not cosine-comparable.
    min_cos = cfg["dense_score_threshold"]
    if min_cos > 0.0:
        before = len(candidates)
        candidates = [
            c for c in candidates
            if c["chunk_id"] not in cosine_chunk_ids
            or c.get("score", 0.0) >= min_cos
        ]
        if not candidates:
            logger.info(
                "All candidates below dense_score_threshold=%.2f, returning empty", min_cos
            )
            return []
        logger.debug("dense_score_threshold filter (%.2f): %d → %d", min_cos, before, len(candidates))

    passages = [c["content"] for c in candidates]
    ranked = rerank_mod.rerank(query, passages)
    results = [candidates[r["index"]] for r in ranked[:top_k] if r["index"] < len(candidates)]

    # Update score to reflect the final ranking signal:
    # - local reranker: use its cross-encoder score directly
    # - none (passthrough): normalize RRF scores to [0, 1]
    if rerank_mod._PROVIDER == "local":
        for chunk, r in zip(results, ranked[:top_k]):
            chunk["score"] = round(r["score"], 4)
    else:
        max_rrf = max(rrf_scores.values(), default=1.0)
        for chunk in results:
            cid = chunk.get("chunk_id", "")
            chunk["score"] = round(rrf_scores.get(cid, 0.0) / max_rrf, 4)

    logger.info("Retrieval complete: top_k=%d returned=%d", top_k, len(results))
    await cache_set(dense_vec, results)
    return results


async def _question_search(
    pool: asyncpg.Pool,
    vec: list[float],
    roles: list[str],
    region: str,
    limit: int,
    project_group: str | None = None,
    min_score: float = 0.0,
    ef_search: int = 100,
) -> list[asyncpg.Record]:
    """Search question_embeddings; returns chunk rows ranked by best question match."""
    if roles:
        acl_clause = "($2::text[] && c.acl OR 'role:public' = ANY(c.acl))"
        args: list = [vec, roles, region, limit]
        pg_idx = 5
    else:
        acl_clause = "'role:public' = ANY(c.acl)"
        args = [vec, region, limit]
        pg_idx = 4
    pg_clause = ""
    if project_group is not None:
        pg_clause = f" AND (${pg_idx} = ANY(c.product_line) OR 'global' = ANY(c.product_line))"
        args.append(project_group)
    region_idx = 3 if roles else 2
    limit_idx  = 4 if roles else 3

    # min_score is from settings (not user input) — safe to inline.
    score_clause = (
        f" AND 1 - (q.embedding <=> $1::vector) >= {min_score:.6f}"
        if min_score > 0.0 else ""
    )

    # DISTINCT ON picks the best-matching question per chunk; outer ORDER BY ensures
    # the result list is sorted by score (highest first) so RRF assigns ranks correctly.
    sql = f"""
        SELECT * FROM (
            SELECT DISTINCT ON (c.chunk_id)
                c.chunk_id, c.doc_id, c.content, c.breadcrumb, c.source_url, c.title,
                1 - (q.embedding <=> $1::vector) AS score
            FROM question_embeddings q
            JOIN chunks c ON c.chunk_id = q.chunk_id
            WHERE {acl_clause}
              AND (${region_idx} = ANY(c.region) OR 'global' = ANY(c.region))
              AND (c.effective_from IS NULL OR c.effective_from <= now())
              AND (c.effective_to   IS NULL OR c.effective_to   >  now())
              AND c.is_parent = FALSE
              {score_clause}
              {pg_clause}
            ORDER BY c.chunk_id, q.embedding <=> $1::vector
        ) _q
        ORDER BY score DESC
        LIMIT ${limit_idx}
    """
    async with pool.acquire() as conn:
        await register_vector(conn)
        async with conn.transaction():
            await conn.execute(f"SET LOCAL hnsw.ef_search = {ef_search}")
            return await conn.fetch(sql, *args)


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
    pg_clause = ""
    if roles:
        acl_clause = "($2::text[] && acl OR 'role:public' = ANY(acl))"
        args: list = [vec, roles, region, limit]
        pg_idx = 5
    else:
        acl_clause = "'role:public' = ANY(acl)"
        args = [vec, region, limit]
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
        await register_vector(conn)
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
