"""Small-to-Big: swap matched sub-chunks for their full parent section content."""
from typing import Any

from db import get_pool


async def expand_to_parent(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Replace each chunk that has a parent_chunk_id with the parent's full content.

    Parent rows are stored in the DB (is_parent=TRUE) so no filesystem access is
    needed. Deduplication ensures a parent section appears only once even when
    multiple of its sub-chunks were retrieved.
    """
    parent_ids = {
        c["parent_chunk_id"]
        for c in chunks
        if c.get("parent_chunk_id")
    }
    if not parent_ids:
        return chunks

    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT chunk_id, content FROM chunks WHERE chunk_id = ANY($1) AND is_parent = TRUE",
            list(parent_ids),
        )
    parent_content: dict[str, str] = {r["chunk_id"]: r["content"] for r in rows}

    expanded: list[dict[str, Any]] = []
    seen_parents: set[str] = set()

    for chunk in chunks:
        parent_id = chunk.get("parent_chunk_id")
        if parent_id and parent_id in parent_content and parent_id not in seen_parents:
            expanded.append({**chunk, "content": parent_content[parent_id], "expanded": True})
            seen_parents.add(parent_id)
        elif parent_id and parent_id in seen_parents:
            # Another sub-chunk of the same parent — skip, parent already added
            continue
        else:
            expanded.append(chunk)

    return expanded
