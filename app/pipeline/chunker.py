"""Hierarchical chunker: heading-aware split + breadcrumb injection + Small-to-Big parent storage."""
import os
from pathlib import Path
from typing import Any

_STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "/data/rag"))


async def chunk_document(
    parsed: dict[str, Any],
    doc_id: str,
    owner: str,
    business_line: str,
) -> list[dict[str, Any]]:
    # TODO: LlamaIndex SentenceSplitter, heading-aware
    # TODO: inject breadcrumb (H1 > H2 > H3) into each chunk metadata
    # TODO: write parent chunks to STORAGE_ROOT/chunks/{doc_id}/{parent_id}.txt
    return []
