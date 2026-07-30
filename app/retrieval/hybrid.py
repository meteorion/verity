"""Hybrid retrieval: BGE-M3 dense + sparse parallel → RRF → Rerank."""
import os
from typing import Any

import asyncpg

from inference import embedding as emb_mod
from inference import rerank as rerank_mod

_DSN = os.environ.get("PGVECTOR_DSN", "")
_RERANK_THRESHOLD = float(os.getenv("RERANK_THRESHOLD", "0.38"))


def _rrf_score(rankings: list[list[str]], k: int = 60) -> dict[str, float]:
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, doc_id in enumerate(ranking, start=1):
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
    return scores


async def hybrid_retrieve(
    query: str,
    roles: list[str],
    region: str,
    top_k: int = 10,
) -> list[dict[str, Any]]:
    # TODO: BGE-M3 encode query (dense + sparse)
    # TODO: parallel pgvector dense search + sparse search with ACL/region WHERE clause
    # TODO: RRF merge, rerank, return top_k
    return []
