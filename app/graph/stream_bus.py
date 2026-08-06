"""Per-turn token bus bridging generate_node's live LLM stream to the chat
endpoint's SSE loop.

A LangGraph node reports its state update only once, on completion — that's
too coarse for token-level streaming. This sidesteps it with a plain
asyncio.Queue keyed by session_id, kept entirely outside the checkpointed
graph state (which must stay picklable/JSON-safe for the postgres
checkpointer).

Terminal nodes that resolve instantly with a complete string (safety reject,
FAQ hit, semantic-cache hit, transfer, LLM-call failure) don't push here
themselves — chat.py relays their one-shot `answer_stream` value through the
same queue, so the consumer only ever needs one code path.
"""
import asyncio
from typing import Any

DONE: Any = object()

_queues: dict[str, asyncio.Queue] = {}


def open_stream(session_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    _queues[session_id] = q
    return q


def push(session_id: str, token: str) -> None:
    q = _queues.get(session_id)
    if q is not None:
        q.put_nowait(token)


def close(session_id: str) -> None:
    q = _queues.pop(session_id, None)
    if q is not None:
        q.put_nowait(DONE)
