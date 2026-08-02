import json
import logging
import os
import time

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from api import auth
from api.sessions import record_turn
from citations import build_refs

logger = logging.getLogger(__name__)
router = APIRouter()

# Identity/roles drive ACL filtering, so by default they come ONLY from a
# verified JWT. X-UID/X-Roles headers are trusted only when the service runs
# behind a trusted gateway that authenticates upstream and sets them — opt in
# explicitly via TRUST_FORWARDED_IDENTITY=true. Otherwise a client could send
# `X-Roles: admin` and read restricted chunks.
_TRUST_FORWARDED_IDENTITY = os.getenv("TRUST_FORWARDED_IDENTITY", "false").lower() in ("1", "true", "yes")


class ChatRequest(BaseModel):
    session_id: str
    message: str
    stream: bool = True
    options: dict = {}


def _extract_token_claims(request: Request) -> tuple[str | None, list[str]]:
    """Extract uid and roles from a Bearer token if present (best-effort)."""
    authz = request.headers.get("Authorization", "")
    if not authz.startswith("Bearer "):
        return None, []
    return auth.decode_claims(authz[7:])


@router.post("/v1/chat")
async def chat(req: ChatRequest, request: Request):
    token_uid, token_roles = _extract_token_claims(request)
    if token_uid is not None:
        uid, roles = token_uid, token_roles
    elif _TRUST_FORWARDED_IDENTITY:
        uid = request.headers.get("X-UID")
        roles = [r for r in request.headers.get("X-Roles", "").split(",") if r]
    else:
        # No verified token and forwarded identity not trusted → anonymous.
        uid, roles = None, []
    region = request.headers.get("X-Region", "default")
    project_group = request.headers.get("X-Project-Group") or None

    logger.info(
        "Chat request [session=%s uid=%s region=%s roles=%s message=%r]",
        req.session_id, uid, region, roles, req.message[:60],
    )

    graph = request.app.state.graph

    from api.settings import load_settings as _ls
    _s = _ls()
    top_k = int(req.options.get("top_k", _s.get("retrieval_top_k", 6)))
    temperature = float(req.options.get("temperature", _s.get("llm_temperature", 0.2)))

    async def event_stream():
        last_chunks: list[dict] = []
        answer_tokens: list[str] = []
        last_state: dict = {}
        t0 = time.perf_counter()
        first_token_ms: int | None = None

        try:
            async for chunk in graph.astream(
                {
                    "session_id": req.session_id,
                    "uid": uid,
                    "roles": [r for r in roles if r],
                    "region": region,
                    "project_group": project_group,
                    "query_raw": req.message,
                    "top_k": top_k,
                    "llm_temperature": temperature,
                    # Reset per-turn fields so the previous turn's values don't
                    # leak via the checkpointed state / stream_mode="values" snapshots.
                    # intent/faq_hit in particular are routing keys: a stale
                    # intent="reject" or faq_hit=True would short-circuit every
                    # later turn in the session straight to END.
                    "answer_stream": None,
                    "retrieved_chunks": [],
                    "intent": None,
                    "faq_hit": False,
                    "cache_hit": False,
                    "query_embedding": None,
                    "multi_queries": None,
                    "faq_context": None,
                    "transferred": False,
                    "transfer_reason": None,
                },
                config={"configurable": {"thread_id": req.session_id}},
                stream_mode="values",
            ):
                if retrieved := chunk.get("retrieved_chunks"):
                    last_chunks = retrieved
                # Use `is not None` so an empty string still gets yielded
                if (token := chunk.get("answer_stream")) is not None:
                    if first_token_ms is None:
                        first_token_ms = round((time.perf_counter() - t0) * 1000)
                    answer_tokens.append(token)
                    # JSON-encode so embedded \n\n in the answer doesn't break SSE framing
                    yield f"data: {json.dumps(token, ensure_ascii=False)}\n\n"
                last_state = chunk
        except Exception:
            logger.exception("Graph execution error [session=%s]", req.session_id)
            fallback = "抱歉，处理请求时出现错误，请稍后重试或联系人工客服。"
            answer_tokens.append(fallback)
            yield f"data: {json.dumps(fallback, ensure_ascii=False)}\n\n"

        yield "data: [DONE]\n\n"
        if last_chunks:
            refs = build_refs(last_chunks)
            yield f"data: [REFS]{json.dumps(refs, ensure_ascii=False)}\n\n"

        try:
            record_turn(
                session_id=req.session_id,
                uid=uid,
                roles=[r for r in roles if r],
                region=region,
                query=req.message,
                answer="".join(answer_tokens),
                intent=last_state.get("intent"),
                faq_hit=bool(last_state.get("faq_hit")),
                chunks=last_chunks,
                transferred=bool(last_state.get("transferred")),
                transfer_reason=last_state.get("transfer_reason"),
                first_token_ms=first_token_ms,
            )
        except Exception:
            logger.exception("record_turn failed for session %s", req.session_id)

    return StreamingResponse(event_stream(), media_type="text/event-stream")
