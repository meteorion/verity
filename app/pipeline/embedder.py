"""Batch embedding via pluggable in-process backend."""
import os

from inference.embedding import embed
from pipeline.models import Chunk

# DashScope text-embedding-v3 limits batches to 10; OpenAI allows 2048.
# Default to 10 for broad compatibility; override with EMBEDDING_BATCH_SIZE.
_BATCH_SIZE = int(os.getenv("EMBEDDING_BATCH_SIZE", "10"))


async def embed_chunks(chunks: list[Chunk]) -> list[Chunk]:
    if not chunks:
        return chunks

    # Parent chunks are not retrieved directly — skip embedding them.
    to_embed = [c for c in chunks if not c.is_parent]
    parents = [c for c in chunks if c.is_parent]

    for i in range(0, len(to_embed), _BATCH_SIZE):
        batch = to_embed[i : i + _BATCH_SIZE]
        vecs = embed([c.content for c in batch], mode="both")
        for chunk, vec in zip(batch, vecs):
            chunk.embedding = vec.dense
            chunk.sparse_vector = vec.sparse

    return chunks
