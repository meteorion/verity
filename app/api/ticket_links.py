"""工单链接配置管理 API（仅管理员）。

GET    /api/ticket-links               配置列表
PATCH  /api/ticket-links/{ticket_type} 更新配置
"""
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from tickets.link_service import get_link_config, list_link_configs, update_link_config

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ticket-links", tags=["ticket-links"])

_VALID_TYPES = {"after_sales_refund", "complaint", "inquiry", "technical_issue"}


class UpdateLinkConfigRequest(BaseModel):
    label: str | None = None
    form_url: str | None = None
    enabled: bool | None = None


@router.get("")
async def api_list_link_configs():
    return await list_link_configs()


@router.patch("/{ticket_type}")
async def api_update_link_config(ticket_type: str, req: UpdateLinkConfigRequest):
    if ticket_type not in _VALID_TYPES:
        raise HTTPException(400, f"ticket_type 无效，可选值: {', '.join(sorted(_VALID_TYPES))}")
    if req.form_url is not None and not req.form_url.startswith(("http://", "https://")):
        raise HTTPException(400, "form_url 必须以 http:// 或 https:// 开头")
    cfg = await update_link_config(
        ticket_type,
        label=req.label,
        form_url=req.form_url,
        enabled=req.enabled,
    )
    if not cfg:
        raise HTTPException(404, "配置不存在，请检查数据库是否已完成初始化")
    return cfg
