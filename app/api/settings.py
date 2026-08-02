"""Persistent application settings — model, API, and parameter configuration.

Settings are stored as JSON at SETTINGS_PATH (default /data/app_settings.json).
Values in the file override the corresponding env-var defaults. Empty or missing
keys fall through to env vars so the system keeps working without any saved file.
"""
import json
import logging
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/settings", tags=["settings"])

_SETTINGS_PATH = Path(os.getenv("SETTINGS_PATH", "/data/app_settings.json"))

_cache: dict | None = None


def load_settings() -> dict:
    global _cache
    if _cache is None:
        try:
            _cache = json.loads(_SETTINGS_PATH.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            _cache = {}
    return _cache


def save_settings(data: dict) -> None:
    global _cache
    _SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _SETTINGS_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    _cache = None  # invalidate so next load_settings() re-reads the file


def _mask(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 8:
        return "*" * len(key)
    return key[:4] + "*" * (len(key) - 8) + key[-4:]


class SettingsRead(BaseModel):
    llm_model: str
    llm_api_base: str
    llm_api_key_masked: str
    llm_max_tokens: int
    llm_temperature: float
    embedding_model: str
    embedding_api_base: str
    embedding_api_key_masked: str
    ragas_llm_model: str
    retrieval_top_k: int
    retrieval_top_vector: int
    rerank_threshold: float
    chunk_size: int
    chunk_overlap: int
    dense_score_threshold: float  # min cosine similarity for dense retrieval (0 = off)
    rrf_alpha: float              # dense weight in weighted RRF (0-1, 1-α = sparse weight)
    ef_search: int                # HNSW ef_search (higher = better recall, slower query)


class SettingsWrite(BaseModel):
    llm_model: Optional[str] = None
    llm_api_base: Optional[str] = None
    llm_api_key: Optional[str] = None
    llm_max_tokens: Optional[int] = None
    llm_temperature: Optional[float] = None
    embedding_model: Optional[str] = None
    embedding_api_base: Optional[str] = None
    embedding_api_key: Optional[str] = None
    ragas_llm_model: Optional[str] = None
    retrieval_top_k: Optional[int] = None
    retrieval_top_vector: Optional[int] = None
    rerank_threshold: Optional[float] = None
    chunk_size: Optional[int] = None
    chunk_overlap: Optional[int] = None
    dense_score_threshold: Optional[float] = None
    rrf_alpha: Optional[float] = None
    ef_search: Optional[int] = None


@router.get("", response_model=SettingsRead)
async def get_settings():
    s = load_settings()

    def _str(field: str, env_var: str, default: str = "") -> str:
        return s.get(field) or os.getenv(env_var, default)

    def _int(field: str, env_var: str, default: int = 0) -> int:
        v = s.get(field)
        if v is not None:
            return int(v)
        return int(os.getenv(env_var, str(default)))

    def _float(field: str, env_var: str, default: float = 0.0) -> float:
        v = s.get(field)
        if v is not None:
            return float(v)
        return float(os.getenv(env_var, str(default)))

    llm_key = _str("llm_api_key", "LLM_API_KEY") or os.getenv("OPENAI_API_KEY", "")
    emb_key = _str("embedding_api_key", "EMBEDDING_API_KEY") or llm_key

    return SettingsRead(
        llm_model=_str("llm_model", "LLM_MODEL", "qwen-plus"),
        llm_api_base=_str(
            "llm_api_base", "LLM_API_BASE",
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
        ),
        llm_api_key_masked=_mask(llm_key),
        llm_max_tokens=_int("llm_max_tokens", "LLM_MAX_TOKENS", 800),
        llm_temperature=_float("llm_temperature", "LLM_TEMPERATURE", 0.2),
        embedding_model=_str("embedding_model", "EMBEDDING_MODEL", "text-embedding-v3"),
        embedding_api_base=_str(
            "embedding_api_base", "EMBEDDING_API_BASE",
            _str("llm_api_base", "LLM_API_BASE", ""),
        ),
        embedding_api_key_masked=_mask(emb_key),
        ragas_llm_model=_str("ragas_llm_model", "RAGAS_LLM_MODEL", "qwen-turbo"),
        retrieval_top_k=_int("retrieval_top_k", "RETRIEVAL_TOP_K", 6),
        retrieval_top_vector=_int("retrieval_top_vector", "RETRIEVAL_TOP_VECTOR", 50),
        rerank_threshold=_float("rerank_threshold", "RERANK_THRESHOLD", 0.38),
        chunk_size=_int("chunk_size", "CHUNK_SIZE", 600),
        chunk_overlap=_int("chunk_overlap", "CHUNK_OVERLAP", 80),
        dense_score_threshold=_float("dense_score_threshold", "DENSE_SCORE_THRESHOLD", 0.0),
        rrf_alpha=_float("rrf_alpha", "RRF_ALPHA", 0.6),
        ef_search=_int("ef_search", "EF_SEARCH", 40),
    )


@router.put("", status_code=204)
async def update_settings(body: SettingsWrite):
    from eval.ragas_eval import reset_evaluator

    s = load_settings()
    updates = body.model_dump(exclude_none=True)
    # Empty strings mean "clear override; fall back to env var"
    for k, v in list(updates.items()):
        if isinstance(v, str) and v.strip() == "":
            s.pop(k, None)
        else:
            s[k] = v
    save_settings(s)
    reset_evaluator()
    logger.info("Settings saved. Fields updated: %s", list(updates.keys()))
