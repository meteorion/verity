import logging

from graph.state import OrchestratorState

logger = logging.getLogger(__name__)

_TRANSFER_KEYWORDS = ["人工", "转接", "客服", "坐席", "真人"]
_COMPLAINT_KEYWORDS = ["投诉", "举报", "骗", "欺骗", "差评", "要求赔偿", "起诉", "维权", "媒体曝光"]
_TOOL_KEYWORDS = ["订单", "物流", "快递", "发货", "开票", "发票", "工单", "退款", "余额", "账户"]
_CHITCHAT_KEYWORDS = ["你好", "hi", "hello", "谢谢", "感谢", "再见", "拜拜", "你是谁", "你叫什么"]


async def intent_node(state: OrchestratorState) -> dict:
    query = state.get("query_rewritten") or state["query_raw"]
    query_lower = query.lower()

    # P1 规则分类；P2 替换为 FastText fine-tune（F1 ≥ 0.85）
    # transfer 优先于 tool，防止"投诉+退款"被误路由到工具调用
    if any(k in query_lower for k in _TRANSFER_KEYWORDS):
        intent = "transfer"
    elif any(k in query_lower for k in _COMPLAINT_KEYWORDS):
        intent = "transfer"
    elif any(k in query_lower for k in _TOOL_KEYWORDS):
        intent = "tool"
    elif any(k in query_lower for k in _CHITCHAT_KEYWORDS):
        intent = "chitchat"
    else:
        intent = "rag"

    logger.info(
        "Intent classified [session=%s intent=%s query=%r]",
        state.get("session_id"), intent, query[:60],
    )
    return {"intent": intent, "query_rewritten": query}
