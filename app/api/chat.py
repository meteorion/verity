import json
import uuid

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter()


class ChatRequest(BaseModel):
    session_id: str
    message: str
    stream: bool = True
    options: dict = {}


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


@router.post("/v1/chat")
async def chat(req: ChatRequest, request: Request):
    uid = request.headers.get("X-UID")
    roles = request.headers.get("X-Roles", "").split(",")
    region = request.headers.get("X-Region", "default")

    graph = request.app.state.graph
    trace_id = f"tr_{uuid.uuid4().hex[:12]}"

    async def event_stream():
        streamed = False
        final_state: dict = {}
        # "custom": generate_node 用 get_stream_writer() 按 token 推送；
        # "values": 每步之后的完整状态快照，用来兜底（FAQ/转人工没走 custom）和取最终引用/意图。
        async for mode, chunk in graph.astream(
            {
                "session_id": req.session_id,
                "uid": uid,
                "roles": [r for r in roles if r],
                "region": region,
                "query_raw": req.message,
            },
            stream_mode=["custom", "values"],
        ):
            if mode == "custom":
                if token := chunk.get("token"):
                    streamed = True
                    yield _sse({"type": "token", "content": token})
            else:
                final_state = chunk

        if not streamed and (answer := final_state.get("answer_stream")):
            yield _sse({"type": "token", "content": answer})

        citations = [
            {
                "chunk_id": c.get("chunk_id"),
                "title": c.get("title"),
                "source_url": c.get("source_url"),
            }
            for c in final_state.get("retrieved_chunks") or []
        ]
        yield _sse({
            "type": "done",
            "citations": citations,
            "intent": final_state.get("intent"),
            "trace_id": trace_id,
        })

    return StreamingResponse(event_stream(), media_type="text/event-stream")
