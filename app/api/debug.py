"""Debug endpoint — non-streaming full-trace response for the admin Playground.

POST /v1/debug  →  {answer, intent, faq_hit, chunks, refs, spans, total_ms}

Uses stream_mode="updates" so each node update arrives in order;
timestamps are captured on arrival to produce per-node latency.
"""
import time
from fastapi import APIRouter, Request
from pydantic import BaseModel

from api.sessions import record_turn

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

    spans: list[dict] = []
    accumulated: dict = {}
    t0 = time.perf_counter()
    t_prev = t0

    top_k = int(req.options.get("top_k", 6))
    temperature = float(req.options.get("temperature", 0.2))

    async for update in graph.astream(
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
        stream_mode="updates",
    ):
        t_now = time.perf_counter()
        for node_name, node_output in update.items():
            if not node_output:
                continue
            spans.append({
                "span": node_name,
                "detail": _span_detail(node_name, node_output),
                "latency_ms": round((t_now - t_prev) * 1000),
            })
            accumulated.update(node_output)
        t_prev = t_now

    # Strip embedding / sparse_vector — safe display subset only
    chunks = [
        {k: (float(v) if k == "score" else v)
         for k, v in c.items()
         if k in _SAFE_CHUNK_KEYS}
        for c in (accumulated.get("retrieved_chunks") or [])
    ]

    raw_chunks = accumulated.get("retrieved_chunks") or []
    key_to_idx: dict[str, int] = {}
    seen_idx: set[int] = set()
    refs = []
    for c in raw_chunks:
        url = (c.get("source_url") or "").strip()
        key = url if url else (
            c.get("breadcrumb", "").split(" > ")[0].strip()
            or c.get("title", "").strip()
            or c.get("doc_id", "")
        )
        if key not in key_to_idx:
            key_to_idx[key] = len(key_to_idx) + 1
        src_idx = key_to_idx[key]
        if src_idx in seen_idx:
            continue
        seen_idx.add(src_idx)
        refs.append({"idx": src_idx, **{k: c.get(k, "") for k in ("chunk_id", "title", "breadcrumb", "source_url")}})
    refs.sort(key=lambda r: r["idx"])

    answer = accumulated.get("answer_stream") or ""

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
        )
    except Exception:
        pass

    return {
        "answer": answer,
        "intent": accumulated.get("intent"),
        "faq_hit": bool(accumulated.get("faq_hit")),
        "chunks": chunks,
        "refs": refs,
        "spans": spans,
        "total_ms": round((time.perf_counter() - t0) * 1000),
    }
