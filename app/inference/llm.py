"""Unified LangChain chat model factory.

get_llm() reads config from settings.json at call time (env-var fallback),
so admin-UI changes take effect on the next request without a restart.

Instance cache: keyed by (provider, api_base, model, max_tokens, temperature).
Same key → same ChatOpenAI → same httpx.AsyncClient → connection pool reused.
"""
import os
from typing import Any

from langchain_openai import ChatOpenAI

_cache: dict[tuple[Any, ...], ChatOpenAI] = {}


def _llm_cfg() -> dict:
    """Effective LLM config: settings.json first, env-var fallback."""
    try:
        from api.settings import load_settings
        s = load_settings()
    except Exception:
        s = {}

    def _s(key: str, env: str, default: str = "") -> str:
        return s.get(key) or os.getenv(env, default)

    primary = _s("llm_model", "LLM_MODEL", "qwen-plus")
    return {
        "provider":   _s("llm_provider",   "LLM_PROVIDER",  "openai"),
        "model":      primary,
        "fast_model": _s("llm_fast_model", "LLM_FAST_MODEL", "") or primary,
        "api_base":   _s("llm_api_base",   "LLM_API_BASE",  "https://api.openai.com/v1"),
        "api_key":    s.get("llm_api_key") or os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY", ""),
        "max_tokens": int(s.get("llm_max_tokens") or os.getenv("LLM_MAX_TOKENS", "800")),
        "temperature": float(s.get("llm_temperature") or os.getenv("LLM_TEMPERATURE", "0.2")),
        "litellm_url": os.getenv("LITELLM_URL", "http://litellm:4000"),
        "litellm_key": os.getenv("LITELLM_MASTER_KEY", "sk-litellm"),
    }


def _make_instance(cfg: dict, model: str, max_tokens: int, temperature: float) -> ChatOpenAI:
    if cfg["provider"] == "litellm":
        return ChatOpenAI(
            model=model,
            api_key=cfg["litellm_key"],
            base_url=cfg["litellm_url"],
            max_tokens=max_tokens,
            temperature=temperature,
        )
    return ChatOpenAI(
        model=model,
        api_key=cfg["api_key"],
        base_url=cfg["api_base"],
        max_tokens=max_tokens,
        temperature=temperature,
    )


def get_llm(
    *,
    model: str | None = None,
    max_tokens: int | None = None,
    temperature: float | None = None,
) -> ChatOpenAI:
    """Return a cached ChatOpenAI instance. Config is read from settings + env each call."""
    cfg = _llm_cfg()
    _model      = model      or cfg["model"]
    _max_tokens = max_tokens if max_tokens  is not None else cfg["max_tokens"]
    _temp       = temperature if temperature is not None else cfg["temperature"]

    cache_key = (cfg["provider"], cfg["api_base"], _model, _max_tokens, _temp)
    if cache_key in _cache:
        return _cache[cache_key]

    instance = _make_instance(cfg, _model, _max_tokens, _temp)
    _cache[cache_key] = instance
    return instance


def get_fast_llm(
    *,
    max_tokens: int | None = None,
    temperature: float | None = None,
) -> ChatOpenAI:
    """Cached instance of the fast/cheap model (llm_fast_model). Falls back to primary."""
    cfg = _llm_cfg()
    return get_llm(model=cfg["fast_model"], max_tokens=max_tokens, temperature=temperature)
