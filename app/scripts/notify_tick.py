"""工单通知定时脚本 — 每 10 分钟由 Cron 调用。

功能：
  1. notify_open     — 首次/转派通知（防重发：只通知 assigned_at 之后尚未发送的）
  2. escalate_stale  — 超时未处理 → 升级通知
  3. auto_close      — resolved 超 48h 自动关闭

用法（容器内）:
  docker compose exec app python scripts/notify_tick.py

Cron:
  */10 * * * * cd /app && python scripts/notify_tick.py >> /var/log/verity/notify.log 2>&1
"""
import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402
from db import get_pool  # noqa: E402
from tickets.config import (  # noqa: E402
    ASSIGNMENT,
    CLOSE_AFTER_HOURS,
    ESCALATE_AFTER_MINUTES,
    HANDLERS,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


async def run():
    pool = await get_pool()
    async with pool.acquire() as conn:
        await notify_open(conn)
        await escalate_stale(conn)
        await auto_close(conn)
    logger.info("Tick complete")


async def notify_open(conn):
    rows = await conn.fetch("""
        SELECT t.* FROM tickets t
        WHERE t.status IN ('open', 'notified')
          AND t.assignee_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM notification_logs n
            WHERE n.ticket_id  = t.ticket_id
              AND n.handler_id = t.assignee_id
              AND n.notify_type IN ('first', 'reassigned')
              AND n.created_at >= t.assigned_at
              AND n.status = 'sent'
          )
        ORDER BY t.created_at
        LIMIT 50
    """)
    for row in rows:
        handler_id = ASSIGNMENT.get(row["ticket_type"], ASSIGNMENT["default"])
        notify_type = "first" if row["status"] == "open" else "reassigned"
        await _send_and_log(conn, dict(row), handler_id, notify_type)
        await conn.execute(
            """UPDATE tickets
               SET status='notified', assignee_id=$1, assigned_at=now(), updated_at=now()
               WHERE ticket_id=$2""",
            handler_id, row["ticket_id"],
        )


async def escalate_stale(conn):
    rows = await conn.fetch("""
        SELECT t.* FROM tickets t
        WHERE t.status = 'notified'
          AND t.updated_at < now() - ($1 || ' minutes')::interval
          AND NOT EXISTS (
            SELECT 1 FROM notification_logs n
            WHERE n.ticket_id = t.ticket_id AND n.notify_type = 'escalation'
          )
    """, str(ESCALATE_AFTER_MINUTES))
    for row in rows:
        handler_id = ASSIGNMENT.get(row["ticket_type"], ASSIGNMENT["default"])
        await _send_and_log(conn, dict(row), handler_id, "escalation")
        await conn.execute(
            "UPDATE tickets SET status='escalated', updated_at=now() WHERE ticket_id=$1",
            row["ticket_id"],
        )


async def auto_close(conn):
    result = await conn.execute("""
        UPDATE tickets
        SET status='closed', closed_at=now(), updated_at=now()
        WHERE status='resolved'
          AND resolved_at < now() - ($1 || ' hours')::interval
    """, str(CLOSE_AFTER_HOURS))
    if result != "UPDATE 0":
        logger.info("auto_close: %s", result)


async def _send_and_log(conn, ticket: dict, handler_id: str, notify_type: str):
    handler = HANDLERS.get(handler_id)
    if not handler:
        logger.warning("Unknown handler %s for ticket %s", handler_id, ticket["ticket_id"])
        return
    webhook = handler.get("dingtalk_webhook", "")
    text = _build_message(ticket, notify_type)
    status = "failed"
    if webhook:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                await client.post(webhook, json={"msgtype": "text", "text": {"content": text}})
            status = "sent"
        except Exception as exc:
            logger.warning("DingTalk notify failed for %s: %s", ticket["ticket_id"], exc)
    else:
        logger.info("[DRY-RUN] %s → %s: %s", notify_type, handler_id, text[:80])
        status = "sent"  # treat as sent when no webhook configured (dev mode)
    await conn.execute(
        "INSERT INTO notification_logs(ticket_id,handler_id,notify_type,channel,status)"
        " VALUES($1,$2,$3,'dingtalk',$4)",
        ticket["ticket_id"], handler_id, notify_type, status,
    )


def _build_message(ticket: dict, notify_type: str) -> str:
    prefix = {
        "first": "📋 新工单",
        "reassigned": "🔄 工单已转派",
        "escalation": "🔴 工单超时升级",
        "reminder": "⏰ 工单待处理",
    }.get(notify_type, "工单通知")
    fields = ticket.get("fields") or {}
    if isinstance(fields, str):
        import json
        fields = json.loads(fields)
    desc = str(fields.get("description", ""))[:80]
    admin_base = __import__("os").getenv("ADMIN_UI_BASE_URL", "http://localhost:5173")
    return (
        f"{prefix} #{ticket['ticket_id']}\n"
        f"类型：{ticket['ticket_type']}\n"
        f"描述：{desc or '（无）'}\n"
        f"联系：{ticket.get('contact') or '—'}\n"
        f"处理链接：{admin_base}/#tickets"
    )


if __name__ == "__main__":
    asyncio.run(run())
