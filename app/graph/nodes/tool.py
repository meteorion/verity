"""Tool node — 工单自动提取与创建。

路由：intent_node 分类为 "tool"（触发词含"工单/报障/反馈"等）时进入。
主路径：LLM 从对话提取工单字段，简单工单直接创建，复杂工单返回预填表单链接。
表单 URL 从 ticket_link_configs 表读取（运营后台可配置）。
"""
import base64
import json
import logging
import os

from db import get_pool
from graph.state import OrchestratorState
from tickets.service import create_ticket

logger = logging.getLogger(__name__)

# ── 配置 ─────────────────────────────────────────────────────────────────────

_TICKET_KEYWORDS = ["工单", "报障", "申诉", "反馈问题", "提交反馈", "人工处理"]

_COMPLEX_AMOUNT_THRESHOLD = float(os.getenv("COMPLEX_AMOUNT_THRESHOLD", "1000"))
# 仅在 DB 不可用时的回退地址
_FALLBACK_FORM_URL = os.getenv(
    "ADMIN_UI_BASE_URL", "http://localhost:5173"
) + "/tickets/new"

# ── 提示词 ───────────────────────────────────────────────────────────────────

_SYS_PROMPT = "你是工单信息提取助手，只返回合法 JSON，不加任何说明或代码块标记。"

_USER_TMPL = """\
从以下客服对话中提取工单信息。若某字段无法推断，值设为 null。

返回 JSON，包含以下字段：
- ticket_type: "after_sales_refund" | "complaint" | "inquiry" | "technical_issue"
- summary: 一句话描述（≤50字）
- contact: 联系方式（手机/邮箱/uid，null 表示未提供）
- amount: 涉及金额（数字，单位元，null 表示无）
- order_id: 订单号（null 表示无）
- priority: "low" | "normal" | "high"（默认 "normal"）
- detail: 详细描述（≤200字，null 表示无）
- confidence: 0.0~1.0，字段提取置信度
- is_complex: 复杂工单判定（true/false）；满足任意一项则为 true：
    1. amount 不为 null 且 amount > {threshold}
    2. ticket_type == "complaint"
    3. contact 为 null
    4. 诉求涉及 ≥ 3 个独立问题
    5. confidence < 0.7
- complex_reason: is_complex=true 时的原因（简短字符串），否则为 null

对话：
{conversation}"""

# ── 主节点 ───────────────────────────────────────────────────────────────────


async def tool_node(state: OrchestratorState) -> dict:
    query = state.get("query_raw", "")
    if not any(k in query for k in _TICKET_KEYWORDS):
        # 其他 tool 类意图（订单查询、物流、开票）在 P2 扩展
        return {"tool_results": []}

    session_id = state.get("session_id", "")
    history = state.get("history_recent", [])
    conversation = _format_conversation(history, query)

    try:
        fields = await _extract_fields(conversation)
    except Exception:
        logger.exception("Ticket field extraction failed [session=%s]", session_id)
        return {"tool_results": [await _link_result({}, session_id, "字段提取失败，请人工填写")]}

    logger.info(
        "Ticket extraction [session=%s type=%s confidence=%.2f is_complex=%s]",
        session_id,
        fields.get("ticket_type"),
        float(fields.get("confidence") or 0),
        fields.get("is_complex"),
    )

    if fields.get("is_complex", True):
        return {"tool_results": [await _link_result(fields, session_id, fields.get("complex_reason"))]}

    try:
        existing = await _find_recent_ticket(session_id, fields.get("ticket_type", "inquiry"))
        if existing:
            return {"tool_results": [{
                "type": "ticket_exists",
                "ticket_id": existing,
                "message": f"您已有处理中的工单 {existing}，我们将尽快跟进，无需重复提交。",
            }]}
        ticket = await create_ticket(
            fields.get("ticket_type", "inquiry"), session_id, fields
        )
        return {"tool_results": [{
            "type": "ticket_created",
            "ticket_id": ticket["ticket_id"],
            "message": f"已为您创建工单 {ticket['ticket_id']}，预计24小时内联系您处理。",
        }]}
    except Exception:
        logger.exception("Ticket creation failed [session=%s]", session_id)
        return {"tool_results": [await _link_result(fields, session_id, "系统繁忙，请通过链接提交")]}


# ── 辅助函数 ─────────────────────────────────────────────────────────────────


def _format_conversation(history: list[dict], query: str) -> str:
    lines = []
    for turn in history[-10:]:
        role = "用户" if turn.get("role") == "user" else "客服"
        lines.append(f"{role}：{turn.get('content', '')}")
    lines.append(f"用户：{query}")
    return "\n".join(lines)


async def _extract_fields(conversation: str) -> dict:
    from langchain_core.messages import HumanMessage, SystemMessage

    from inference.llm import get_llm

    prompt = _USER_TMPL.format(
        threshold=int(_COMPLEX_AMOUNT_THRESHOLD),
        conversation=conversation,
    )
    llm = get_llm(temperature=0.0)
    response = await llm.ainvoke(
        [SystemMessage(content=_SYS_PROMPT), HumanMessage(content=prompt)]
    )
    content = response.content
    if isinstance(content, list):
        content = "".join(
            b.get("text", "") if isinstance(b, dict) else str(b) for b in content
        )

    # Strip markdown code fences if the model ignores the instruction
    content = content.strip()
    if content.startswith("```"):
        parts = content.split("```")
        content = parts[1].lstrip("json").strip() if len(parts) > 1 else content

    fields: dict = json.loads(content)
    fields.setdefault("ticket_type", "inquiry")
    fields.setdefault("confidence", 0.5)
    fields.setdefault("is_complex", True)
    fields.setdefault("priority", "normal")
    return fields


async def _find_recent_ticket(session_id: str, ticket_type: str) -> str | None:
    """同 session 1 小时内已有同类型未关闭工单时返回其 ticket_id，避免重复创建。"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT ticket_id FROM tickets
               WHERE session_id  = $1
                 AND ticket_type = $2
                 AND status NOT IN ('resolved', 'closed')
                 AND created_at  > now() - interval '1 hour'
               ORDER BY created_at DESC
               LIMIT 1""",
            session_id,
            ticket_type,
        )
    return row["ticket_id"] if row else None


async def _link_result(fields: dict, session_id: str, reason: str | None) -> dict:
    ticket_type = fields.get("ticket_type", "inquiry")

    try:
        from tickets.link_service import get_link_config
        cfg = await get_link_config(ticket_type)
        if cfg and cfg.get("enabled") and cfg.get("form_url"):
            base_url = cfg["form_url"]
        else:
            # 类型已停用：不生成链接，回退纯文本提示
            return {
                "type": "ticket_link",
                "url": None,
                "message": "请联系人工客服，我们将尽快处理您的问题。",
            }
    except Exception:
        logger.warning("Failed to load ticket link config, using fallback URL")
        base_url = _FALLBACK_FORM_URL

    prefill_data = {
        k: v for k, v in fields.items()
        if k not in ("is_complex", "complex_reason", "confidence") and v is not None
    }
    prefill = base64.b64encode(
        json.dumps(prefill_data, ensure_ascii=False).encode()
    ).decode()
    url = f"{base_url}?type={ticket_type}&session={session_id}&prefill={prefill}"
    return {
        "type": "ticket_link",
        "url": url,
        "reason": reason or "",
        "message": "您的问题需要专员处理，请点击链接填写工单，我们将尽快联系您。",
    }
