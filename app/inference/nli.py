"""NLI provider: 'none' (skip) or 'local' (chinese-roberta in-process async).

Set NLI_PROVIDER=none|local  (default: none)
none  → returns empty flags; disables post-generation reference checking
local → chinese-roberta-wwm-ext-nli, CPU async, flags contradictions ≥ 0.8
"""
import asyncio
import logging
import os

logger = logging.getLogger(__name__)

_PROVIDER = os.getenv("NLI_PROVIDER", "none")
_LOCAL_PATH = os.getenv("NLI_MODEL_PATH", "/models/chinese-roberta-nli")

_pipe = None


def load_nli_model() -> None:
    global _pipe
    if _PROVIDER != "local":
        logger.info("NLI provider=none, skipping local model load")
        return
    logger.info("Loading NLI model from %s …", _LOCAL_PATH)
    from transformers import pipeline as hf_pipeline
    _pipe = hf_pipeline("text-classification", model=_LOCAL_PATH, device=-1)
    logger.info("NLI model loaded")


async def nli_check(answer: str, chunks: list[str]) -> list[dict]:
    if _PROVIDER != "local":
        return []
    assert _pipe is not None, "Call load_nli_model() first"
    flags = await asyncio.get_event_loop().run_in_executor(None, _run_local, answer, chunks)
    if flags:
        logger.warning("NLI contradiction detected: %d chunk(s) flagged", len(flags))
    return flags


def _run_local(answer: str, chunks: list[str]) -> list[dict]:
    flags = []
    for i, chunk in enumerate(chunks):
        result = _pipe(f"{chunk} [SEP] {answer}", truncation=True)[0]
        # threshold 0.8 balances precision vs recall; calibrate against gold set in P2
        if result["label"] == "CONTRADICTION" and result["score"] > 0.8:
            flags.append({"chunk_index": i, "score": result["score"]})
    return flags
