"""BGE-Reranker-v2-m3 in-process cross-encoder."""
import os

from FlagEmbedding import FlagReranker

_model: FlagReranker | None = None
_MODEL_PATH = os.getenv("RERANK_MODEL_PATH", "/models/bge-reranker-v2-m3")
_THRESHOLD = float(os.getenv("RERANK_THRESHOLD", "0.38"))


def load_rerank_model():
    global _model
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
