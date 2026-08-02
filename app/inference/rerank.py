"""Rerank provider: 'none' (passthrough), 'local' (BGE-Reranker in-process).

Set RERANK_PROVIDER=none|local  (default: none)
none  → all passages pass through with score=1.0 (RRF order preserved)
local → BGE-Reranker-v2-m3 cross-encoder, sigmoid output, threshold filtered
"""
import logging
import os

logger = logging.getLogger(__name__)

_PROVIDER = os.getenv("RERANK_PROVIDER", "none")
_LOCAL_PATH = os.getenv("RERANK_MODEL_PATH", "/models/bge-reranker-v2-m3")
_THRESHOLD = float(os.getenv("RERANK_THRESHOLD", "0.38"))


def _get_rerank_threshold() -> float:
    try:
        from api.settings import load_settings
        s = load_settings()
        v = s.get("rerank_threshold")
        return float(v) if v is not None else _THRESHOLD
    except Exception:
        return _THRESHOLD

_local_model = None


def load_rerank_model() -> None:
    global _local_model
    if _PROVIDER != "local":
        logger.info("Rerank provider=none, skipping local model load")
        return
    logger.info("Loading BGE-Reranker from %s …", _LOCAL_PATH)
    from FlagEmbedding import FlagReranker
    _local_model = FlagReranker(_LOCAL_PATH, use_fp16=True)
    logger.info("BGE-Reranker loaded")


def rerank(query: str, passages: list[str], threshold: float | None = None) -> list[dict]:
    if _PROVIDER == "local":
        return _rerank_local(query, passages, threshold)
    # provider=none: passthrough preserving RRF order; threshold not applied
    return [{"index": i, "score": 1.0, "passage": p} for i, p in enumerate(passages)]


def _rerank_local(query: str, passages: list[str], threshold: float | None) -> list[dict]:
    assert _local_model is not None, "Call load_rerank_model() first"
    thr = threshold if threshold is not None else _get_rerank_threshold()
    pairs = [[query, p] for p in passages]
    scores = _local_model.compute_score(pairs, normalize=True)
    results = [
        {"index": i, "score": float(s), "passage": passages[i]}
        for i, s in enumerate(scores)
        if float(s) >= thr
    ]
    results.sort(key=lambda x: x["score"], reverse=True)
    logger.debug(
        "Rerank: input=%d above_threshold=%d (thr=%.2f)",
        len(passages), len(results), thr,
    )
    return results
