from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter()


class ChatRequest(BaseModel):
    session_id: str
    message: str
    stream: bool = True
    options: dict = {}


@router.post("/v1/chat")
async def chat(req: ChatRequest, request: Request):
    uid = request.headers.get("X-UID")
    roles = request.headers.get("X-Roles", "").split(",")
    region = request.headers.get("X-Region", "default")

    graph = request.app.state.graph

    async def event_stream():
        async for chunk in graph.astream(
            {
                "session_id": req.session_id,
                "uid": uid,
                "roles": [r for r in roles if r],
                "region": region,
                "query_raw": req.message,
            },
            stream_mode="values",
        ):
            if token := chunk.get("answer_stream"):
                yield f"data: {token}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
