"""工单 CRUD 服务层。"""
import json
import logging
from datetime import date

from db import get_pool
from tickets.config import ASSIGNMENT

logger = logging.getLogger(__name__)


async def _next_ticket_id(conn) -> str:
    today = date.today().strftime("%Y%m%d")
    count = await conn.fetchval(
        "SELECT COUNT(*) FROM tickets WHERE ticket_id LIKE $1",
        f"T-{today}-%",
    )
    return f"T-{today}-{int(count) + 1:04d}"


async def create_ticket(ticket_type: str, session_id: str | None, fields: dict) -> dict:
    pool = await get_pool()
    async with pool.acquire() as conn:
        ticket_id = await _next_ticket_id(conn)
        assignee_id = ASSIGNMENT.get(ticket_type, ASSIGNMENT["default"])
        contact = fields.get("contact", "")
        await conn.execute(
            """INSERT INTO tickets
               (ticket_id, ticket_type, session_id, fields, contact, assignee_id, assigned_at)
               VALUES($1, $2, $3, $4::jsonb, $5, $6, now())""",
            ticket_id, ticket_type, session_id, json.dumps(fields), contact, assignee_id,
        )
        logger.info("Created ticket %s type=%s assignee=%s", ticket_id, ticket_type, assignee_id)
        return {"ticket_id": ticket_id, "status": "open"}


async def list_tickets(
    *,
    status: str | None = None,
    assignee_id: str | None = None,
    limit: int = 50,
) -> list[dict]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        where_parts: list[str] = []
        params: list = []
        if status:
            params.append(status)
            where_parts.append(f"status = ${len(params)}")
        if assignee_id:
            params.append(assignee_id)
            where_parts.append(f"assignee_id = ${len(params)}")
        params.append(limit)
        where_clause = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
        rows = await conn.fetch(
            f"SELECT * FROM tickets {where_clause} ORDER BY created_at DESC LIMIT ${len(params)}",
            *params,
        )
        return [_row_to_dict(r) for r in rows]


async def get_ticket(ticket_id: str) -> dict | None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM tickets WHERE ticket_id = $1", ticket_id)
        return _row_to_dict(row) if row else None


async def update_status(ticket_id: str, status: str) -> dict | None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        extra = ", resolved_at = now()" if status == "resolved" else ""
        row = await conn.fetchrow(
            f"UPDATE tickets SET status=$1, updated_at=now(){extra}"
            " WHERE ticket_id=$2 RETURNING *",
            status, ticket_id,
        )
        return _row_to_dict(row) if row else None


async def assign_ticket(ticket_id: str, handler_id: str) -> dict | None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """UPDATE tickets
               SET assignee_id=$1, assigned_at=now(), status='notified', updated_at=now()
               WHERE ticket_id=$2 RETURNING *""",
            handler_id, ticket_id,
        )
        return _row_to_dict(row) if row else None


def _row_to_dict(row) -> dict:
    d = dict(row)
    if isinstance(d.get("fields"), str):
        d["fields"] = json.loads(d["fields"])
    # asyncpg returns datetime objects; convert to ISO string for JSON
    for k, v in d.items():
        if hasattr(v, "isoformat"):
            d[k] = v.isoformat()
    return d
