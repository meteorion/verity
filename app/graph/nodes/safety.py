"""安全过滤 — P1 只用本地敏感词词典（见 doc/plan.md §3.9），P1 不接商用付费 API。"""
import os

from graph.state import OrchestratorState

_BLOCKLIST = [w.strip() for w in os.getenv("SAFETY_BLOCKLIST", "").split(",") if w.strip()]
_REJECT_MESSAGE = "很抱歉，我无法回答这个问题，请换个问法，或联系人工客服。"


async def safety_node(state: OrchestratorState) -> dict:
    # TODO: 换成 AC 自动机做多模式匹配（词典变大后逐词 `in` 扫描会变慢），见 §3.9
    query = state["query_raw"]
    if any(word in query for word in _BLOCKLIST):
        return {"blocked": True, "answer_stream": _REJECT_MESSAGE}
    return {"blocked": False}
