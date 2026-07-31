"""Embedding backend — P0 正式选型（doc/plan.md §3.2）尚未完成 benchmark。

P1 先用 sentence-transformers 本地小模型跑通链路（CPU 可跑，无需 API Key）；
正式选型确定后只需在 load_embedding_model() 里换一个 EmbeddingBackend 实现，
对外的 embed() 接口（dense + 可选 sparse）不变，调用点（pipeline/embedder.py、
retrieval/hybrid.py）都不用改。当前实现不产出稀疏向量，mode="sparse"/"both"
时 sparse 字段恒为 None。
"""
import os
from dataclasses import dataclass
from typing import Protocol


@dataclass
class EmbedResult:
    dense: list[float]
    sparse: dict[str, float] | None = None


class EmbeddingBackend(Protocol):
    def encode(self, texts: list[str], mode: str) -> list[EmbedResult]: ...


class SentenceTransformerBackend:
    """本地 CPU 推理，无稀疏向量输出。"""

    def __init__(self, model_name: str):
        from sentence_transformers import SentenceTransformer  # noqa: PLC0415

        self._model = SentenceTransformer(model_name)

    def encode(self, texts: list[str], mode: str) -> list["EmbedResult"]:
        vectors = self._model.encode(texts, normalize_embeddings=True)
        return [EmbedResult(dense=v.tolist(), sparse=None) for v in vectors]


_backend: EmbeddingBackend | None = None
_MODEL_PATH = os.getenv("EMBEDDING_MODEL_PATH", "")


def load_embedding_model() -> None:
    global _backend
    if not _MODEL_PATH:
        raise NotImplementedError(
            "EMBEDDING_MODEL_PATH 未配置。P1 默认值见 .env.example"
            "（sentence-transformers 的 HF hub id，本地 CPU 推理）；"
            "P0 正式 benchmark 选型后（doc/plan.md §3.2）再替换成对应 backend。"
        )
    _backend = SentenceTransformerBackend(_MODEL_PATH)


def embed(texts: list[str], mode: str = "both") -> list[EmbedResult]:
    assert _backend is not None, "Embedding model not loaded"
    return _backend.encode(texts, mode)
