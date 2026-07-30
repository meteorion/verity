import asyncio
import os

import httpx

from graph.state import OrchestratorState
from inference.nli import nli_check

_LITELLM_URL = os.getenv("LITELLM_URL", "http://litellm:4000")


async def generate_node(state: OrchestratorState) -> dict:
    # TODO: build prompt from retrieved_chunks + tool_results + history
    # TODO: stream from LiteLLM, collect full answer
    # TODO: fire-and-forget NLI check after stream completes
    answer = ""
    asyncio.create_task(
        nli_check(answer, [c.get("content", "") for c in state.get("retrieved_chunks", [])])
    )
    return {"answer_stream": answer, "nli_flags": []}
