"""Batch embedding via pluggable in-process backend (model 待选型，见 doc/plan.md §3.2)."""
from typing import Any

from inference.embedding import embed

_BATCH_SIZE = 64


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
