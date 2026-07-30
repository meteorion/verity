"""Small-to-Big: swap small retrieval chunks for their parent context."""
import os
from pathlib import Path
from typing import Any

_STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "/data/rag"))


async def expand_to_parent(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    expanded = []
    seen_parents: set[str] = set()

    for chunk in chunks:
        parent_id = chunk.get("parent_chunk_id")
        if parent_id and parent_id not in seen_parents:
            parent_path = _STORAGE_ROOT / "chunks" / chunk.get("doc_id", "") / f"{parent_id}.txt"
            if parent_path.exists():
                content = parent_path.read_text(encoding="utf-8")
                expanded.append({**chunk, "content": content, "expanded": True})
                seen_parents.add(parent_id)
                continue
        expanded.append(chunk)

    return expanded
