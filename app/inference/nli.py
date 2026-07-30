"""chinese-roberta NLI in-process async validator."""
import asyncio
import os

from transformers import pipeline as hf_pipeline

_pipe = None
_MODEL_PATH = os.getenv("NLI_MODEL_PATH", "/models/chinese-roberta-nli")


def load_nli_model():
    global _pipe
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
