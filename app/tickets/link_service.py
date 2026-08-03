"""工单链接配置服务层。

ticket_link_configs 表由 main.py _run_migrations() 创建并种入默认数据。
"""
import logging

from db import get_pool

logger = logging.getLogger(__name__)


async def list_link_configs() -> list[dict]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM ticket_link_configs ORDER BY sort_order, ticket_type"
        )
    return [dict(r) for r in rows]


async def get_link_config(ticket_type: str) -> dict | None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM ticket_link_configs WHERE ticket_type = $1",
            ticket_type,
        )
    return dict(row) if row else None


async def update_link_config(
    ticket_type: str,
    *,
    label: str | None = None,
    form_url: str | None = None,
    enabled: bool | None = None,
) -> dict | None:
    sets: list[str] = []
    params: list = []

    if label is not None:
        params.append(label)
        sets.append(f"label = ${len(params)}")
    if form_url is not None:
        params.append(form_url)
        sets.append(f"form_url = ${len(params)}")
    if enabled is not None:
        params.append(enabled)
        sets.append(f"enabled = ${len(params)}")

    if not sets:
        return await get_link_config(ticket_type)

    params.append(ticket_type)
    sql = (
        f"UPDATE ticket_link_configs SET {', '.join(sets)}, updated_at = now()"
        f" WHERE ticket_type = ${len(params)} RETURNING *"
    )
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(sql, *params)

    if not row:
        return None
    logger.info("Updated ticket_link_config [type=%s enabled=%s]", ticket_type, enabled)
    return dict(row)
