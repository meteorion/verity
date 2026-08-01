"""Upsert embedded chunks into PGVector and compute admission score."""
import logging
import statistics
from typing import Any

from pgvector.asyncpg import register_vector

from db import get_pool

logger = logging.getLogger(__name__)

_SPARSE_DIM = 30522
_SPARSE_MAX_ENTRIES = 256


def _calc_score(chunks: list[dict], dedup_similarities: list[float] | None = None) -> int:
    """Return admission score 0-100.

    content_quality (0-30): effective content length — 150 chars/pt, full at 4500
    structure       (0-20): breadcrumb depth (0-10) + chunk size uniformity (0-10)
    retrievability  (0-20): avg token range fitness (0-10) + short-chunk ratio (0-10)
    novelty         (0-20): inverse average corpus similarity, multi-chunk sampled
    base            (10):   constant
    """
    if not chunks:
        return 0

    contents = [c.get("content", "") for c in chunks]
    token_counts = [len(t) // 3 for t in contents]
    total_chars = sum(len(t) for t in contents)
    avg_tokens = statistics.mean(token_counts) if token_counts else 0

    # ── 1. Content quality (0-30) ───────────────────────────────────────────
    content_score = min(30, total_chars // 150)

    # ── 2. Structure (0-20) ────────────────────────────────────────────────
    # Heading depth: count " > " separators in breadcrumb (doc title is depth-0)
    depths = [c.get("breadcrumb", "").count(" > ") for c in chunks]
    max_depth = max(depths) if depths else 0
    depth_score = min(10, max_depth * 3)      # 1→3  2→6  3→9  4+→10

    # Chunk size uniformity: coefficient of variation (std/mean); lower = better
    if len(token_counts) > 1 and avg_tokens > 0:
        cv = statistics.stdev(token_counts) / avg_tokens
        uniformity = 10 if cv < 0.5 else 7 if cv < 1.0 else 4 if cv < 1.5 else 1
    else:
        uniformity = 5  # single chunk → neutral

    struct_score = depth_score + uniformity

    # ── 3. Retrievability (0-20) ────────────────────────────────────────────
    # Avg token size: ideal 60-600, acceptable 30-900, else poor
    if 60 <= avg_tokens <= 600:
        tok_score = 10
    elif 30 <= avg_tokens < 60 or 600 < avg_tokens <= 900:
        tok_score = 6
    else:
        tok_score = 2

    # Short-chunk penalty: fraction of chunks below 20 tokens
    short_ratio = sum(1 for t in token_counts if t < 20) / len(token_counts)
    short_score = 10 if short_ratio < 0.1 else 7 if short_ratio < 0.3 else 4 if short_ratio < 0.5 else 1

    retrievability_score = tok_score + short_score

    # ── 4. Novelty (0-20) ──────────────────────────────────────────────────
    # Inverse average similarity — multi-chunk sampled (up to 5)
    avg_sim = statistics.mean(dedup_similarities) if dedup_similarities else 0.0
    novelty_score = int((1.0 - min(avg_sim, 1.0)) * 20)

    # ── 5. Base ────────────────────────────────────────────────────────────
    total = content_score + struct_score + retrievability_score + novelty_score + 10
    return min(100, total)


def _sparse_to_pgvector(sparse: dict | None) -> str | None:
    if not sparse:
        return None
    top = sorted(
        ((k, v) for k, v in sparse.items() if v != 0),
        key=lambda x: x[1],
        reverse=True,
    )[:_SPARSE_MAX_ENTRIES]
    if not top:
        return None
    entries = ",".join(f"{int(k)}:{float(v)}" for k, v in top)
    return f"{{{entries}}}/{_SPARSE_DIM}"


async def index_chunks(chunks: list[dict[str, Any]]) -> dict:
    """Insert chunks and compute admission score. Returns {chunk_count, admission_score}."""
    if not chunks:
        return {"chunk_count": 0, "admission_score": 0}

    logger.info("Indexing %d chunk(s) into PGVector …", len(chunks))
    pool = await get_pool()
    conn = await pool.acquire()
    try:
        await register_vector(conn)

        doc_id = chunks[0]["doc_id"]

        # Multi-sample dedup: up to 5 chunks compared against the existing corpus
        # (doc_id != current). Read-only and best-effort — run it BEFORE the write
        # transaction so a failing similarity probe can't abort the inserts.
        sample_embs = [c["embedding"] for c in chunks if c.get("embedding")][:5]
        dedup_similarities: list[float] = []
        for emb in sample_embs:
            try:
                sim = await conn.fetchval(
                    "SELECT MAX(1 - (embedding <=> $1::vector)) FROM chunks"
                    " WHERE doc_id != $2 AND embedding IS NOT NULL",
                    emb, doc_id,
                )
                if sim is not None:
                    dedup_similarities.append(float(sim))
            except Exception:
                pass

        admission_score = _calc_score(chunks, dedup_similarities)
        status = "active" if admission_score >= 60 else "pending"

        # Atomic: either every chunk lands and the document status flips, or
        # nothing does. A mid-loop failure must not leave a partially-indexed
        # document that hybrid_retrieve would serve as if complete.
        async with conn.transaction():
            for chunk in chunks:
                embedding = chunk.get("embedding")
                sparse = _sparse_to_pgvector(chunk.get("sparse_vector"))
                emb_value = embedding if embedding else None

                await conn.execute(
                    """
                    INSERT INTO chunks(
                        chunk_id, doc_id, parent_chunk_id, parent_path,
                        title, breadcrumb, content,
                        source_url, product_line, region, version,
                        effective_from, effective_to, acl, updated_at,
                        embedding, sparse_vector
                    )
                    VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                    ON CONFLICT (chunk_id) DO UPDATE SET
                        title          = EXCLUDED.title,
                        breadcrumb     = EXCLUDED.breadcrumb,
                        content        = EXCLUDED.content,
                        source_url     = EXCLUDED.source_url,
                        acl            = EXCLUDED.acl,
                        version        = EXCLUDED.version,
                        effective_from = EXCLUDED.effective_from,
                        effective_to   = EXCLUDED.effective_to,
                        embedding      = EXCLUDED.embedding,
                        sparse_vector  = EXCLUDED.sparse_vector,
                        updated_at     = EXCLUDED.updated_at
                    """,
                    chunk["chunk_id"], chunk["doc_id"],
                    chunk.get("parent_chunk_id"), chunk.get("parent_path"),
                    chunk.get("title", ""), chunk.get("breadcrumb", ""), chunk["content"],
                    chunk.get("source_url"), chunk.get("product_line", []),
                    # Empty region [] would defeat the schema default '{global}'
                    # and make the chunk match neither branch of the retrieval
                    # filter ($region = ANY(region) OR 'global' = ANY(region)),
                    # silently hiding it. Fall back to ["global"] like the chunker.
                    chunk.get("region") or ["global"], chunk.get("version"),
                    chunk.get("effective_from"), chunk.get("effective_to"),
                    chunk.get("acl", []), chunk.get("updated_at"),
                    emb_value, sparse,
                )

            await conn.execute(
                "UPDATE documents SET admission_score=$1, status=$2, updated_at=now() WHERE doc_id=$3",
                admission_score, status, doc_id,
            )

        logger.info(
            "Indexed %d chunk(s); doc_id=%s admission_score=%d status=%s",
            len(chunks), doc_id, admission_score, status,
        )
        return {"chunk_count": len(chunks), "admission_score": admission_score}
    finally:
        await pool.release(conn)
