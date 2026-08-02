"""工单 REST API。

POST   /api/tickets                    用户提交工单（无需登录）
GET    /api/tickets                    工单列表（管理员）
GET    /api/tickets/link               获取表单链接（供 transfer_node 使用）
GET    /api/tickets/handlers           处理人列表（管理员）
GET    /api/tickets/{ticket_id}        工单详情（管理员）
PATCH  /api/tickets/{ticket_id}/status 变更状态（管理员）
PATCH  /api/tickets/{ticket_id}/assign 转派处理人（管理员）
"""
import logging
import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.auth import require_admin
from tickets.config import ASSIGNMENT, HANDLERS
from tickets.service import (
    assign_ticket,
    create_ticket,
    get_ticket,
    list_tickets,
    update_status,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/tickets", tags=["tickets"])

_ADMIN_UI_BASE = os.getenv("ADMIN_UI_BASE_URL", "http://localhost:5173")

_VALID_TYPES = {"after_sales_refund", "complaint", "inquiry", "technical_issue"}
_VALID_STATUSES = {"open", "processing", "resolved"}


class CreateTicketRequest(BaseModel):
    ticket_type: str
    session_id: str | None = None
    fields: dict = {}


class UpdateStatusRequest(BaseModel):
    status: str


class AssignRequest(BaseModel):
    handler_id: str
    reason: str = ""


@router.post("", status_code=201)
async def api_create_ticket(req: CreateTicketRequest):
    if req.ticket_type not in _VALID_TYPES:
        raise HTTPException(400, f"ticket_type 无效，可选值: {', '.join(sorted(_VALID_TYPES))}")
    return await create_ticket(req.ticket_type, req.session_id, req.fields)


@router.get("/link")
async def api_ticket_link(type: str, session: str | None = None):
    ticket_type = type if type in _VALID_TYPES else "inquiry"
    params = f"type={ticket_type}"
    if session:
        params += f"&session={session}"
    return {"url": f"{_ADMIN_UI_BASE}/tickets/new?{params}"}


@router.get("", dependencies=[Depends(require_admin)])
async def api_list_tickets(
    status: str | None = None,
    assignee_id: str | None = None,
    limit: int = 50,
):
    return await list_tickets(status=status, assignee_id=assignee_id, limit=min(limit, 200))


@router.get("/handlers", dependencies=[Depends(require_admin)])
async def api_list_handlers():
    return [{"handler_id": hid, "name": h["name"]} for hid, h in HANDLERS.items()]


@router.get("/{ticket_id}", dependencies=[Depends(require_admin)])
async def api_get_ticket(ticket_id: str):
    ticket = await get_ticket(ticket_id)
    if not ticket:
        raise HTTPException(404, "工单不存在")
    return ticket


@router.patch("/{ticket_id}/status", dependencies=[Depends(require_admin)])
async def api_update_status(ticket_id: str, req: UpdateStatusRequest):
    if req.status not in _VALID_STATUSES:
        raise HTTPException(400, f"status 无效，可选值: {', '.join(sorted(_VALID_STATUSES))}")
    ticket = await update_status(ticket_id, req.status)
    if not ticket:
        raise HTTPException(404, "工单不存在")
    return ticket


@router.patch("/{ticket_id}/assign", dependencies=[Depends(require_admin)])
async def api_assign_ticket(ticket_id: str, req: AssignRequest):
    if req.handler_id not in HANDLERS:
        raise HTTPException(400, f"handler_id 不存在: {req.handler_id}")
    ticket = await assign_ticket(ticket_id, req.handler_id)
    if not ticket:
        raise HTTPException(404, "工单不存在")
    return ticket
