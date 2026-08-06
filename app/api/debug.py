"""Debug endpoint — streaming SSE response for the admin Playground.

POST /v1/debug  →  SSE stream:
  data: [SPAN]{json}          — emitted per node as it completes
  data: "token"               — answer tokens from generate node
  data: [DEBUG]{json}         — final frame: chunks / refs / spans / meta
  data: [DONE]

Uses stream_mode=["updates","messages"] so node spans and LLM tokens
arrive concurrently without a separate request.
"""
import json
import time
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from api.sessions import record_turn
from citations import build_refs

router = APIRouter()

_SAFE_CHUNK_KEYS = {"chunk_id", "doc_id", "title", "breadcrumb", "content", "source_url", "score"}


def _span_detail(node: str, output: dict) -> str:
    match node:
        case "safety":
            return "拦截" if output.get("intent") == "reject" else "通过"
        case "faq":
            return "命中" if output.get("faq_hit") else "未命中"
        case "intent":
            return f"意图 = {output.get('intent', '?')}"
        case "rag":
            n = len(output.get("retrieved_chunks") or [])
            return f"检索到 {n} 个 chunk"
        case "tool":
            n = len(output.get("tool_results") or [])
            return f"工具调用 {n} 条结果"
        case "generate":
            n = len(output.get("answer_stream") or "")
            return f"生成 {n} 字"
        case "transfer":
            return f"转人工：{output.get('transfer_reason', '')}"
        case _:
            return ""


class DebugRequest(BaseModel):
    session_id: str
    message: str
    options: dict = {}


@router.post("/v1/debug")
async def debug_chat(req: DebugRequest, request: Request):
    uid = request.headers.get("X-UID", "debug_user")
    roles = [r for r in request.headers.get("X-Roles", "customer").split(",") if r]
    region = request.headers.get("X-Region", "default")
    project_group = request.headers.get("X-Project-Group") or None

    graph = request.app.state.graph
    top_k = int(req.options.get("top_k", 6))
    temperature = float(req.options.get("temperature", 0.2))

    async def event_stream():
        spans: list[dict] = []
        accumulated: dict = {}
        t0 = time.perf_counter()
        t_prev = t0
        tokens_emitted = False  # True once any answer token is sent via messages mode

        async for mode, chunk in graph.astream(
            {
                "session_id": req.session_id,
                "uid": uid,
                "roles": roles,
                "region": region,
                "project_group": project_group,
                "query_raw": req.message,
                "top_k": top_k,
                "llm_temperature": temperature,
                "answer_stream": None,
                "retrieved_chunks": [],
            },
            config={"configurable": {"thread_id": req.session_id}},
            stream_mode=["updates", "messages"],
        ):
            t_now = time.perf_counter()

            if mode == "updates":
                for node_name, node_output in chunk.items():
                    if not node_output:
                        continue
                    span = {
                        "span": node_name,
                        "detail": _span_detail(node_name, node_output),
                        "latency_ms": round((t_now - t_prev) * 1000),
                    }
                    spans.append(span)
                    accumulated.update(node_output)
                    t_prev = t_now
                    yield f"data: [SPAN]{json.dumps(span, ensure_ascii=False)}\n\n"

            elif mode == "messages":
                msg_chunk, metadata = chunk
                node = metadata.get("langgraph_node", "")
                if node == "generate":
                    content = msg_chunk.content if hasattr(msg_chunk, "content") else ""
                    if isinstance(content, list):
                        content = "".join(
                            p.get("text", "") for p in content if isinstance(p, dict)
                        )
                    if content:
                        yield f"data: {json.dumps(content, ensure_ascii=False)}\n\n"
                        tokens_emitted = True

        # ── final frame ──────────────────────────────────────────────────
        # Cache hit / FAQ hit / transfer: graph short-circuits before generate,
        # so messages mode never fires.  Emit the answer now as a single chunk.
        answer = accumulated.get("answer_stream") or ""
        if answer and not tokens_emitted:
            yield f"data: {json.dumps(answer, ensure_ascii=False)}\n\n"
        raw_chunks = accumulated.get("retrieved_chunks") or []
        chunks_safe = [
            {k: (float(v) if k == "score" else v)
             for k, v in c.items() if k in _SAFE_CHUNK_KEYS}
            for c in raw_chunks
        ]
        refs = build_refs(raw_chunks)
        total_ms = round((time.perf_counter() - t0) * 1000)

        debug_payload = {
            "chunks": chunks_safe,
            "refs": refs,
            "intent": accumulated.get("intent"),
            "faq_hit": bool(accumulated.get("faq_hit")),
            "cache_hit": bool(accumulated.get("cache_hit")),
            "spans": spans,
            "total_ms": total_ms,
        }
        yield f"data: [DEBUG]{json.dumps(debug_payload, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

        try:
            record_turn(
                session_id=req.session_id,
                uid=uid,
                roles=[r for r in roles if r],
                region=region,
                query=req.message,
                answer=answer,
                intent=accumulated.get("intent"),
                faq_hit=bool(accumulated.get("faq_hit")),
                chunks=raw_chunks,
                transferred=bool(accumulated.get("transferred")),
                transfer_reason=accumulated.get("transfer_reason"),
                first_token_ms=None,
                total_ms=total_ms,
                cache_hit=bool(accumulated.get("cache_hit")),
            )
        except Exception:
            pass

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
