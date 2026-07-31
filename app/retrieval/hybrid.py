"""Retrieval：P1 单路向量检索（dense only）；混合检索（+ 稀疏 + RRF）+ Rerank 延后到 P2，见 doc/plan.md §3.3/§3.5/§6.1。

`hybrid_retrieve` 这个函数名/模块预留给 P2 混合检索用，P1 阶段只需实现其中的 dense 分支。
"""
import asyncio
from typing import Any

from db import get_connection
from inference import embedding as emb_mod


def _rrf_score(rankings: list[list[str]], k: int = 60) -> dict[str, float]:
    """P2 混合检索用：融合多路排名（当前 dense-only 路线暂不调用）。"""
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, doc_id in enumerate(ranking, start=1):
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
    return scores


async def hybrid_retrieve(
    query: str,
    roles: list[str],
    region: str,
    top_k: int = 6,
) -> list[dict[str, Any]]:
    # embed() 是同步 CPU 推理，丢到线程池里跑，不阻塞事件循环（参考 inference/nli.py 的做法）
    [result] = await asyncio.to_thread(emb_mod.embed, [query], "dense")

    conn = await get_connection()
    try:
        rows = await conn.fetch(
            """
            SELECT chunk_id, doc_id, parent_chunk_id, title, content, source_url,
                   1 - (embedding <=> $1) AS score
            FROM chunks
            WHERE (acl IS NULL OR acl && $2)
              AND (region IS NULL OR region && $3)
              AND (effective_to IS NULL OR effective_to > now())
            ORDER BY embedding <=> $1
            LIMIT $4
            """,
            result.dense,
            roles,
            [region, "global"],
            top_k,
        )
    finally:
        await conn.close()

    # TODO(P2): 接入稀疏检索（BM25/稀疏向量）+ _rrf_score 融合 + Rerank，见 §3.5/§6.1
    return [dict(row) for row in rows]
