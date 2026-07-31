"""chinese-roberta NLI in-process async validator — P1 暂不引入，见 doc/plan.md §3.8。

由 ENABLE_NLI 开关控制是否加载/启用；关闭时本模块不导入 transformers，
不要求安装该依赖或下载模型，P2 幻觉抑制专项落地时只改 .env，无需改调用点。
"""
import asyncio
import os

_pipe = None
_MODEL_PATH = os.getenv("NLI_MODEL_PATH", "/models/chinese-roberta-nli")
_ENABLED = os.getenv("ENABLE_NLI", "false").lower() == "true"


def is_enabled() -> bool:
    return _ENABLED


def load_nli_model() -> None:
    global _pipe
    from transformers import pipeline as hf_pipeline  # noqa: PLC0415 — 延迟到真正启用时才要求该依赖

    _pipe = hf_pipeline("text-classification", model=_MODEL_PATH, device=-1)


async def nli_check(answer: str, chunks: list[str]) -> list[dict]:
    """Run NLI in thread pool to avoid blocking the event loop."""
    assert _pipe is not None, "NLI model not loaded"

    def _run():
        flags = []
        for i, chunk in enumerate(chunks):
            result = _pipe(f"{chunk} [SEP] {answer}", truncation=True)[0]
            if result["label"] == "CONTRADICTION" and result["score"] > 0.8:
                flags.append({"chunk_index": i, "score": result["score"]})
        return flags

    return await asyncio.get_event_loop().run_in_executor(None, _run)
