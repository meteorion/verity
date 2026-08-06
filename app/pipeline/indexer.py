"""Upsert embedded chunks into PGVector and compute admission score."""
import logging
import statistics

from pgvector.asyncpg import register_vector

from db import get_pool
from inference.embedding import sparse_to_pgvector
from pipeline.models import Chunk

logger = logging.getLogger(__name__)


def _calc_score(chunks: list[Chunk], dedup_similarities: list[float] | None = None) -> int:
    """Return admission score 0-100.

    content_quality (0-30): effective content length — 150 chars/pt, full at 4500
    structure       (0-20): breadcrumb depth (0-10) + chunk size uniformity (0-10)
    retrievability  (0-20): avg token range fitness (0-10) + short-chunk ratio (0-10)
    novelty         (0-20): inverse average corpus similarity, multi-chunk sampled
    base            (10):   constant
    """
    # Score is computed on retrieval chunks only (exclude parent rows).
    retrieval = [c for c in chunks if not c.is_parent]
    if not retrieval:
        return 0

    contents = [c.content for c in retrieval]
    token_counts = [len(t) // 3 for t in contents]
    total_chars = sum(len(t) for t in contents)
    avg_tokens = statistics.mean(token_counts) if token_counts else 0

    content_score = min(30, total_chars // 150)

    depths = [c.breadcrumb.count(" > ") for c in retrieval]
    max_depth = max(depths) if depths else 0
    depth_score = min(10, max_depth * 3)

    if len(token_counts) > 1 and avg_tokens > 0:
        cv = statistics.stdev(token_counts) / avg_tokens
        uniformity = 10 if cv < 0.5 else 7 if cv < 1.0 else 4 if cv < 1.5 else 1
    else:
        uniformity = 5

    struct_score = depth_score + uniformity

    if 60 <= avg_tokens <= 600:
        tok_score = 10
    elif 30 <= avg_tokens < 60 or 600 < avg_tokens <= 900:
        tok_score = 6
    else:
        tok_score = 2

    short_ratio = sum(1 for t in token_counts if t < 20) / len(token_counts)
    short_score = 10 if short_ratio < 0.1 else 7 if short_ratio < 0.3 else 4 if short_ratio < 0.5 else 1
    retrievability_score = tok_score + short_score

    avg_sim = statistics.mean(dedup_similarities) if dedup_similarities else 0.0
    novelty_score = int((1.0 - min(avg_sim, 1.0)) * 20)

    return min(100, content_score + struct_score + retrievability_score + novelty_score + 10)


async def index_chunks(chunks: list[Chunk]) -> dict:
    """Upsert chunks and compute admission score. Returns {chunk_count, admission_score}."""
    if not chunks:
        return {"chunk_count": 0, "admission_score": 0}

    retrieval_chunks = [c for c in chunks if not c.is_parent]
    logger.info("Indexing %d chunk(s) (%d parent(s)) into PGVector …",
                len(chunks), len(chunks) - len(retrieval_chunks))

    pool = await get_pool()
    conn = await pool.acquire()
    try:
        await register_vector(conn)

        doc_id = chunks[0].doc_id

        # Multi-sample dedup: compare up to 5 retrieval chunks against existing corpus.
        sample_embs = [c.embedding for c in retrieval_chunks if c.embedding][:10]
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

        # policy / announcement are authoritative by nature; skip the score gate.
        doc_type = (chunks[0].doc_type or "").lower()
        if doc_type in {"policy", "announcement"}:
            status = "active"
            logger.debug("doc_type=%s auto-active; admission_score=%d recorded but not gating", doc_type, admission_score)
        else:
            status = "active" if admission_score >= 60 else "pending"

        async with conn.transaction():
            for chunk in chunks:
                embedding = chunk.embedding
                sparse = sparse_to_pgvector(chunk.sparse_vector)

                await conn.execute(
                    """
                    INSERT INTO chunks(
                        chunk_id, doc_id, parent_chunk_id,
                        title, breadcrumb, content,
                        source_url, product_line, region, version,
                        effective_from, effective_to, acl,
                        doc_type, category, tags,
                        chunk_index, is_parent,
                        updated_at, embedding, sparse_vector
                    )
                    VALUES(
                        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
                    )
                    ON CONFLICT (chunk_id) DO UPDATE SET
                        title          = EXCLUDED.title,
                        breadcrumb     = EXCLUDED.breadcrumb,
                        content        = EXCLUDED.content,
                        source_url     = EXCLUDED.source_url,
                        acl            = EXCLUDED.acl,
                        version        = EXCLUDED.version,
                        effective_from = EXCLUDED.effective_from,
                        effective_to   = EXCLUDED.effective_to,
                        doc_type       = EXCLUDED.doc_type,
                        category       = EXCLUDED.category,
                        tags           = EXCLUDED.tags,
                        chunk_index    = EXCLUDED.chunk_index,
                        is_parent      = EXCLUDED.is_parent,
                        embedding      = EXCLUDED.embedding,
                        sparse_vector  = EXCLUDED.sparse_vector,
                        updated_at     = EXCLUDED.updated_at
                    """,
                    chunk.chunk_id, chunk.doc_id, chunk.parent_chunk_id,
                    chunk.title, chunk.breadcrumb, chunk.content,
                    chunk.source_url, chunk.product_line,
                    chunk.region or ["global"], chunk.version,
                    chunk.effective_from, chunk.effective_to, chunk.acl,
                    chunk.doc_type, chunk.category, chunk.tags,
                    chunk.chunk_index, chunk.is_parent,
                    chunk.updated_at, embedding, sparse,
                )

            # Remove chunks from previous ingestion that are no longer present.
            # question_embeddings rows are cleaned up automatically via ON DELETE CASCADE.
            new_chunk_ids = [chunk.chunk_id for chunk in chunks]
            deleted = await conn.execute(
                "DELETE FROM chunks WHERE doc_id = $1 AND chunk_id != ALL($2::text[])",
                doc_id, new_chunk_ids,
            )
            if deleted != "DELETE 0":
                logger.info("Cleaned up stale chunks for doc_id=%s: %s", doc_id, deleted)

            await conn.execute(
                "UPDATE documents SET admission_score=$1, status=$2, updated_at=now() WHERE doc_id=$3",
                admission_score, status, doc_id,
            )

        logger.info(
            "Indexed doc_id=%s chunks=%d admission_score=%d status=%s",
            doc_id, len(chunks), admission_score, status,
        )
        return {"chunk_count": len(retrieval_chunks), "admission_score": admission_score}
    finally:
        await pool.release(conn)
