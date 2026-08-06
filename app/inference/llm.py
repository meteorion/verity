"""Unified LangChain chat model factory.

get_llm() returns a configured ChatOpenAI based on LLM_PROVIDER:
  openai  (default) → ChatOpenAI (any OpenAI-compatible endpoint, e.g. DashScope)
  litellm           → ChatOpenAI pointing at LiteLLM gateway

Instances are cached by (provider, model, max_tokens, temperature) so the
underlying httpx.AsyncClient and its connection pool are reused across requests.
The streaming flag is intentionally excluded from the cache key — LangChain
ChatOpenAI supports both .ainvoke() and .astream() on the same instance.
"""
import os
from typing import Any

from langchain_openai import ChatOpenAI

_LLM_PROVIDER = os.getenv("LLM_PROVIDER", "openai")
_MODEL         = os.getenv("LLM_MODEL", "qwen-plus")
_FAST_MODEL    = os.getenv("LLM_FAST_MODEL", "")   # optional cheaper model for rewrite/expand
_MAX_TOKENS    = int(os.getenv("LLM_MAX_TOKENS", "800"))
_TEMPERATURE   = float(os.getenv("LLM_TEMPERATURE", "0.2"))

_cache: dict[tuple[Any, ...], ChatOpenAI] = {}


def get_llm(
    *,
    model: str | None = None,
    max_tokens: int | None = None,
    temperature: float | None = None,
    streaming: bool = False,
) -> ChatOpenAI:
    """Return a cached ChatOpenAI instance for the given parameters."""
    _model     = model or _MODEL
    _max_tokens = max_tokens if max_tokens is not None else _MAX_TOKENS
    _temp      = temperature if temperature is not None else _TEMPERATURE

    cache_key = (_LLM_PROVIDER, _model, _max_tokens, _temp)
    if cache_key in _cache:
        return _cache[cache_key]

    if _LLM_PROVIDER == "litellm":
        litellm_url = os.getenv("LITELLM_URL", "http://litellm:4000")
        master_key  = os.getenv("LITELLM_MASTER_KEY", "sk-litellm")
        instance = ChatOpenAI(
            model=_model,
            api_key=master_key,
            base_url=litellm_url,
            max_tokens=_max_tokens,
            temperature=_temp,
        )
    else:
        # openai-compatible (default) — DashScope, SiliconFlow, local vLLM, etc.
        api_base = os.getenv("LLM_API_BASE", "https://api.openai.com/v1")
        api_key  = os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY", "")
        instance = ChatOpenAI(
            model=_model,
            api_key=api_key,
            base_url=api_base,
            max_tokens=_max_tokens,
            temperature=_temp,
        )

    _cache[cache_key] = instance
    return instance


def get_fast_llm(
    *,
    max_tokens: int | None = None,
    temperature: float | None = None,
) -> ChatOpenAI:
    """Return a cached instance of the fast/cheap model (LLM_FAST_MODEL).

    Falls back to the primary model when LLM_FAST_MODEL is not set,
    so callers never need to branch on whether a fast model is configured.
    Used for lightweight tasks: query rewrite, multi-query expansion, etc.
    """
    return get_llm(
        model=_FAST_MODEL or _MODEL,
        max_tokens=max_tokens,
        temperature=temperature,
    )
