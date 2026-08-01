"""Batch embedding via pluggable in-process backend (model 待选型，见 doc/plan.md §3.2)."""
import os
from typing import Any

from inference.embedding import embed

# DashScope text-embedding-v3 limits batches to 10; OpenAI allows 2048.
# Default to 10 for broad compatibility; override with EMBEDDING_BATCH_SIZE.
_BATCH_SIZE = int(os.getenv("EMBEDDING_BATCH_SIZE", "10"))


async def embed_chunks(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not chunks:
        return chunks
    result = []
    for i in range(0, len(chunks), _BATCH_SIZE):
        batch = chunks[i : i + _BATCH_SIZE]
        vecs = embed([c["content"] for c in batch], mode="both")
        for chunk, vec in zip(batch, vecs):
            result.append({**chunk, "embedding": vec.dense, "sparse_vector": vec.sparse})
    return result
