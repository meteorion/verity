"""Unified LangChain chat model factory.

get_llm() returns a configured ChatOpenAI based on LLM_PROVIDER:
  openai  (default) → ChatOpenAI (any OpenAI-compatible endpoint, e.g. DashScope)
  litellm           → ChatOpenAI pointing at LiteLLM gateway

All provider-specific env-var reading lives here so callers never branch on LLM_PROVIDER.
"""
import os

from langchain_openai import ChatOpenAI

_LLM_PROVIDER = os.getenv("LLM_PROVIDER", "openai")
_MODEL = os.getenv("LLM_MODEL", "qwen-plus")
_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "800"))
_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.2"))


def get_llm(
    *,
    model: str | None = None,
    max_tokens: int | None = None,
    temperature: float | None = None,
    streaming: bool = False,
) -> ChatOpenAI:
    """Return a configured LangChain ChatOpenAI per LLM_PROVIDER."""
    _model = model or _MODEL
    _max_tokens = max_tokens if max_tokens is not None else _MAX_TOKENS
    _temp = temperature if temperature is not None else _TEMPERATURE

    if _LLM_PROVIDER == "litellm":
        litellm_url = os.getenv("LITELLM_URL", "http://litellm:4000")
        master_key = os.getenv("LITELLM_MASTER_KEY", "sk-litellm")
        return ChatOpenAI(
            model=_model,
            api_key=master_key,
            base_url=litellm_url,
            max_tokens=_max_tokens,
            temperature=_temp,
            streaming=streaming,
        )

    # openai-compatible (default) — handles DashScope, SiliconFlow, local vLLM, etc.
    api_base = os.getenv("LLM_API_BASE", "https://api.openai.com/v1")
    api_key = os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY", "")
    return ChatOpenAI(
        model=_model,
        api_key=api_key,
        base_url=api_base,
        max_tokens=_max_tokens,
        temperature=_temp,
        streaming=streaming,
    )
