"""Transfer node — 无法自助解决时向用户输出工单链接。"""
import os

from graph.state import OrchestratorState

_ADMIN_UI_BASE = os.getenv("ADMIN_UI_BASE_URL", "http://localhost:5173")

_TYPE_MAP = {
    "after_sales": "after_sales_refund",
    "complaint":   "complaint",
    "technical":   "technical_issue",
}


async def transfer_node(state: OrchestratorState) -> dict:
    intent = state.get("intent", "")
    ticket_type = _TYPE_MAP.get(intent, "inquiry")
    session_id = state.get("session_id", "")
    link = f"{_ADMIN_UI_BASE}/tickets/new?type={ticket_type}&session={session_id}"
    return {
        "answer_stream": (
            f"很抱歉暂时无法为您自助解答，请点击以下链接提交工单，"
            f"我们将尽快联系您：\n{link}"
        ),
        "transferred": True,
        "transfer_reason": state.get("transfer_reason", "fallback"),
    }
