"""BGE-M3 in-process: dense + sparse dual output."""
import os
from dataclasses import dataclass

from FlagEmbedding import BGEM3FlagModel

_model: BGEM3FlagModel | None = None
_MODEL_PATH = os.getenv("EMBEDDING_MODEL_PATH", "/models/bge-m3")


def load_embedding_model():
    global _model
    _model = BGEM3FlagModel(_MODEL_PATH, use_fp16=True)


@dataclass
class EmbedResult:
    dense: list[float]
    sparse: dict[str, float] | None


def embed(texts: list[str], mode: str = "both") -> list[EmbedResult]:
    assert _model is not None, "Embedding model not loaded"
    out = _model.encode(
        texts,
        return_dense=(mode in ("dense", "both")),
        return_sparse=(mode in ("sparse", "both")),
        return_colbert_vecs=False,
    )
    results = []
    for i in range(len(texts)):
        results.append(EmbedResult(
            dense=out["dense_vecs"][i].tolist() if "dense_vecs" in out else [],
            sparse=out["lexical_weights"][i] if "lexical_weights" in out else None,
        ))
    return results
