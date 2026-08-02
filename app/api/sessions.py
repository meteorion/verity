"""In-memory session store + REST API for session monitoring.

Sessions and turns are stored in process memory — they reset on restart,
which is acceptable for the current MemorySaver-backed graph.
"""
import time
from collections import OrderedDict
from fastapi import APIRouter, HTTPException

router = APIRouter()

# session_id → {"meta": {...}, "turns": [...]}
_store: OrderedDict[str, dict] = OrderedDict()
_MAX_SESSIONS = 2000


def record_turn(
    session_id: str,
    uid: str | None,
    roles: list[str],
    region: str,
    query: str,
    answer: str,
    intent: str | None,
    faq_hit: bool,
    chunks: list[dict],
    transferred: bool,
    transfer_reason: str | None,
    first_token_ms: int | None = None,
    total_ms: int | None = None,
    cache_hit: bool = False,
):
    now = time.time()
    safe_chunks = [
        {k: c.get(k, "") for k in ("chunk_id", "title", "breadcrumb", "source_url")}
        for c in chunks[:8]
    ]

    if session_id not in _store:
        if len(_store) >= _MAX_SESSIONS:
            _store.popitem(last=False)  # evict oldest
        _store[session_id] = {
            "session_id": session_id,
            "uid": uid,
            "roles": roles,
            "region": region,
            "created_at": now,
            "updated_at": now,
            "turn_count": 0,
            "transferred": False,
            "has_nli_flag": False,
            "turns": [],
        }

    sess = _store[session_id]
    sess["updated_at"] = now
    sess["turn_count"] += 1
    if transferred:
        sess["transferred"] = True

    sess["turns"].append({
        "turn_id": sess["turn_count"],
        "query": query,
        "answer": answer,
        "intent": intent,
        "faq_hit": faq_hit,
        "cache_hit": cache_hit,
        "chunks": safe_chunks,
        "transferred": transferred,
        "transfer_reason": transfer_reason,
        "first_token_ms": first_token_ms,
        "total_ms": total_ms,
        "created_at": now,
    })

    # Move to end (most-recently-updated)
    _store.move_to_end(session_id)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/v1/sessions")
async def list_sessions(limit: int = 100):
    sessions = list(reversed(list(_store.values())))[:limit]
    return {
        "sessions": [
            {
                "session_id": s["session_id"],
                "uid": s["uid"],
                "roles": s["roles"],
                "region": s["region"],
                "turn_count": s["turn_count"],
                "transferred": s["transferred"],
                "last_query": s["turns"][-1]["query"] if s["turns"] else "",
                "last_intent": s["turns"][-1]["intent"] if s["turns"] else None,
                "created_at": s["created_at"],
                "updated_at": s["updated_at"],
            }
            for s in sessions
        ]
    }


@router.get("/v1/sessions/{session_id}")
async def get_session(session_id: str):
    sess = _store.get(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    return sess
