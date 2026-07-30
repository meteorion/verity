"""Upsert embedded chunks into PGVector."""
import os
from typing import Any

import asyncpg

_DSN = os.environ.get("PGVECTOR_DSN", "")


async def index_chunks(chunks: list[dict[str, Any]]) -> None:
    if not chunks:
        return
    conn = await asyncpg.connect(_DSN)
    try:
        # TODO: bulk upsert with ON CONFLICT (chunk_id) DO UPDATE
        pass
    finally:
        await conn.close()
