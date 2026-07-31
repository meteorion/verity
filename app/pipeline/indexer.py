"""Upsert embedded chunks into PGVector."""
from typing import Any

from db import get_connection


async def index_chunks(chunks: list[dict[str, Any]]) -> None:
    if not chunks:
        return
    conn = await get_connection()
    try:
        await conn.executemany(
            """
            INSERT INTO chunks (
                chunk_id, doc_id, parent_chunk_id, title, breadcrumb, content,
                source_url, product_line, region, version,
                effective_from, effective_to, acl, embedding, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
            ON CONFLICT (chunk_id) DO UPDATE SET
                doc_id = EXCLUDED.doc_id,
                parent_chunk_id = EXCLUDED.parent_chunk_id,
                title = EXCLUDED.title,
                breadcrumb = EXCLUDED.breadcrumb,
                content = EXCLUDED.content,
                source_url = EXCLUDED.source_url,
                product_line = EXCLUDED.product_line,
                region = EXCLUDED.region,
                version = EXCLUDED.version,
                effective_from = EXCLUDED.effective_from,
                effective_to = EXCLUDED.effective_to,
                acl = EXCLUDED.acl,
                embedding = EXCLUDED.embedding,
                updated_at = now()
            """,
            [
                (
                    c["chunk_id"],
                    c["doc_id"],
                    c.get("parent_chunk_id"),
                    c.get("title"),
                    c.get("breadcrumb"),
                    c["content"],
                    c.get("source_url"),
                    c.get("product_line"),
                    c.get("region"),
                    c.get("version"),
                    c.get("effective_from"),
                    c.get("effective_to"),
                    c.get("acl"),
                    c["embedding"],
                )
                for c in chunks
            ],
        )
    finally:
        await conn.close()
