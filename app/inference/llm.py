"""Chat LLM 调用 — 网关方案待确认（LiteLLM vs 直连 SDK，见 doc/plan.md §3.11）。

P1 先直连通义千问（DashScope OpenAI 兼容模式），已验证可用（见 config/litellm.yaml 注释）。
对外只暴露 stream_chat()，后续切换 LiteLLM 网关或换模型只改这个模块内部实现，
graph/nodes/generate.py 不用跟着改。
"""
import os
from collections.abc import AsyncIterator

from openai import AsyncOpenAI

_MODEL = os.getenv("LLM_MODEL", "qwen-plus")
_BASE_URL = os.getenv("LLM_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
_API_KEY = os.getenv("QWEN_API_KEY", "")
_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.2"))

_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        assert _API_KEY, "QWEN_API_KEY not set"
        _client = AsyncOpenAI(api_key=_API_KEY, base_url=_BASE_URL)
    return _client


async def stream_chat(messages: list[dict]) -> AsyncIterator[str]:
    stream = await _get_client().chat.completions.create(
        model=_MODEL,
        messages=messages,
        temperature=_TEMPERATURE,
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta
