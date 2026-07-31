"""BGE-Reranker-v2-m3 in-process cross-encoder — P1 暂不引入，见 doc/plan.md §3.3。

由 ENABLE_RERANK 开关控制是否加载/启用；关闭时本模块不导入 FlagEmbedding，
不要求安装该依赖或下载模型，P2 需要时只改 .env，无需改调用点。
"""
import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from FlagEmbedding import FlagReranker

_model: "FlagReranker | None" = None
_MODEL_PATH = os.getenv("RERANK_MODEL_PATH", "/models/bge-reranker-v2-m3")
_THRESHOLD = float(os.getenv("RERANK_THRESHOLD", "0.38"))
_ENABLED = os.getenv("ENABLE_RERANK", "false").lower() == "true"


def is_enabled() -> bool:
    return _ENABLED


def load_rerank_model() -> None:
    global _model
    from FlagEmbedding import FlagReranker  # noqa: PLC0415 — 延迟到真正启用时才要求该依赖

    _model = FlagReranker(_MODEL_PATH, use_fp16=True)


def rerank(query: str, passages: list[str], threshold: float | None = None) -> list[dict]:
    assert _model is not None, "Rerank model not loaded"
    thr = threshold if threshold is not None else _THRESHOLD
    pairs = [[query, p] for p in passages]
    scores = _model.compute_score(pairs, normalize=True)
    results = [
        {"index": i, "score": float(s), "passage": passages[i]}
        for i, s in enumerate(scores)
        if float(s) >= thr
    ]
    results.sort(key=lambda x: x["score"], reverse=True)
    return results
