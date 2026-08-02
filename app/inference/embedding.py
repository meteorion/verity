"""Embedding provider: 'api' (OpenAI-compatible) or 'local' (BGE-M3 in-process).

Set EMBEDDING_PROVIDER=api|local  (default: api)
API mode:
  EMBEDDING_API_BASE   https://api.openai.com/v1
  EMBEDDING_API_KEY    sk-...
  EMBEDDING_MODEL      text-embedding-3-small
  → sparse vector is always None (API doesn't expose sparse output)
Local mode:
  EMBEDDING_MODEL_PATH /models/bge-m3
  → dense + sparse from BGE-M3
"""
import logging
import os
from dataclasses import dataclass

logger = logging.getLogger(__name__)

_PROVIDER = os.getenv("EMBEDDING_PROVIDER", "api")

# ---------- Local provider state ----------
_local_model = None
_LOCAL_PATH = os.getenv("EMBEDDING_MODEL_PATH", "/models/bge-m3")

# ---------- API provider config.txt ----------
_API_BASE = os.getenv("EMBEDDING_API_BASE", "https://api.openai.com/v1")
_API_KEY = os.getenv("EMBEDDING_API_KEY") or os.getenv("OPENAI_API_KEY", "")
_API_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
# Optional: pass explicit dimension (required by DashScope text-embedding-v3)
_API_DIM = int(os.getenv("EMBEDDING_DIM", "0"))  # 0 = let the API use its default


@dataclass
class EmbedResult:
    dense: list[float]
    sparse: dict[str, float] | None


# BGE-M3 sparse vocabulary size. The pgvector `sparsevec` column is declared with
# this dimension, so the write path (indexer) and read path (hybrid) must format
# against the same dim/cap — keep this the single source of truth for both.
SPARSE_DIM = 30522
SPARSE_MAX_ENTRIES = 256


def sparse_to_pgvector(
    sparse: dict | None,
    max_entries: int = SPARSE_MAX_ENTRIES,
    dim: int = SPARSE_DIM,
) -> str | None:
    """Format a {token_id: weight} map as a pgvector `sparsevec` literal
    ('{i:w,...}/dim'), keeping the top-`max_entries` non-zero weights by value.
    Returns None when there is nothing to store."""
    if not sparse:
        return None
    top = sorted(
        ((k, v) for k, v in sparse.items() if v != 0),
        key=lambda kv: kv[1],
        reverse=True,
    )[:max_entries]
    if not top:
        return None
    entries = ",".join(f"{int(k)}:{float(v):.6f}" for k, v in top)
    return "{" + entries + "}/" + str(dim)


def load_embedding_model() -> None:
    global _local_model
    if _PROVIDER != "local":
        logger.info("Embedding provider=api, skipping local model load")
        return
    logger.info("Loading BGE-M3 from %s …", _LOCAL_PATH)
    from FlagEmbedding import BGEM3FlagModel
    _local_model = BGEM3FlagModel(_LOCAL_PATH, use_fp16=True)
    logger.info("BGE-M3 loaded")


def embed(texts: list[str], mode: str = "both") -> list[EmbedResult]:
    logger.debug("Embedding %d text(s) via provider=%s", len(texts), _PROVIDER)
    if _PROVIDER == "local":
        return _embed_local(texts, mode)
    return _embed_api(texts)


# ---------- Implementations ----------

def _embed_local(texts: list[str], mode: str) -> list[EmbedResult]:
    assert _local_model is not None, "Call load_embedding_model() first"
    out = _local_model.encode(
        texts,
        return_dense=(mode in ("dense", "both")),
        return_sparse=(mode in ("sparse", "both")),
        return_colbert_vecs=False,
    )
    return [
        EmbedResult(
            dense=out["dense_vecs"][i].tolist() if "dense_vecs" in out else [],
            sparse=out["lexical_weights"][i] if "lexical_weights" in out else None,
        )
        for i in range(len(texts))
    ]


def _embed_api(texts: list[str]) -> list[EmbedResult]:
    import httpx
    payload: dict = {"input": texts, "model": _API_MODEL}
    if _API_DIM:
        payload["dimensions"] = _API_DIM
    resp = httpx.post(
        f"{_API_BASE}/embeddings",
        headers={"Authorization": f"Bearer {_API_KEY}"},
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()["data"]
    data.sort(key=lambda x: x["index"])
    return [EmbedResult(dense=item["embedding"], sparse=None) for item in data]
