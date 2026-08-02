import logging

from graph.state import OrchestratorState

logger = logging.getLogger(__name__)

_TRANSFER_KEYWORDS   = ["人工", "转接", "客服", "坐席", "真人"]
_COMPLAINT_KEYWORDS  = ["投诉", "举报", "骗", "欺骗", "差评", "要求赔偿", "起诉", "维权", "媒体曝光"]
_TOOL_KEYWORDS       = ["订单", "物流", "快递", "发货", "开票", "发票", "工单", "余额", "账户"]
_CHITCHAT_KEYWORDS   = ["你好", "hi", "hello", "谢谢", "感谢", "再见", "拜拜", "你是谁", "你叫什么"]

# P2: finer-grained intents that drive retrieval strategy
_AFTER_SALES_KEYWORDS = ["退款", "退货", "换货", "维修", "保修", "售后", "理赔", "申诉"]
_PRODUCT_KEYWORDS     = [
    "型号", "规格", "价格", "配置", "版本", "哪款", "区别", "对比", "比较",
    "参数", "优缺点", "推荐", "选购", "功能", "支持", "兼容",
]


async def intent_node(state: OrchestratorState) -> dict:
    query = state.get("query_rewritten") or state["query_raw"]
    query_lower = query.lower()

    # Priority order: transfer > complaint > tool > after_sales > product > chitchat > rag
    if any(k in query_lower for k in _TRANSFER_KEYWORDS):
        intent = "transfer"
    elif any(k in query_lower for k in _COMPLAINT_KEYWORDS):
        intent = "transfer"
    elif any(k in query_lower for k in _TOOL_KEYWORDS):
        intent = "tool"
    elif any(k in query_lower for k in _AFTER_SALES_KEYWORDS):
        # Policy/procedure questions — go through RAG with time-prioritised results
        intent = "after_sales_refund"
    elif any(k in query_lower for k in _PRODUCT_KEYWORDS):
        # Comparison/selection questions — trigger multi-query expansion in rewrite_node
        intent = "product_inquiry"
    elif any(k in query_lower for k in _CHITCHAT_KEYWORDS):
        intent = "chitchat"
    else:
        intent = "rag"

    logger.info(
        "Intent classified [session=%s intent=%s query=%r]",
        state.get("session_id"), intent, query[:60],
    )
    return {"intent": intent, "query_rewritten": query}
