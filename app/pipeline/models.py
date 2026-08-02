"""Domain models for the chunking pipeline."""
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass
class Document:
    doc_id: str
    title: str
    owner_email: str
    business_line: str
    group_ids: list[str] = field(default_factory=lambda: ["global"])
    source_type: str = "upload"
    source_path: str | None = None
    source_url: str | None = None
    version: str | None = None
    effective_from: datetime | None = None
    effective_to: datetime | None = None
    acl: list[str] = field(default_factory=lambda: ["role:public"])
    doc_type: str | None = None  # FAQ / 操作手册 / 政策说明 / 合同模板
    status: str = "pending"


@dataclass
class Chunk:
    chunk_id: str
    doc_id: str
    title: str
    breadcrumb: str
    content: str
    chunk_index: int = 0
    is_parent: bool = False
    parent_chunk_id: str | None = None
    source_url: str | None = None
    product_line: list[str] = field(default_factory=lambda: ["global"])
    region: list[str] = field(default_factory=lambda: ["global"])
    version: str | None = None
    effective_from: datetime | None = None
    effective_to: datetime | None = None
    acl: list[str] = field(default_factory=lambda: ["role:public"])
    doc_type: str | None = None     # FAQ / 操作手册 / 政策说明 / 合同模板
    category: str | None = None     # 退款 / 发货 / 会员 …
    tags: list[str] = field(default_factory=list)  # [高优, 外部, 紧急] …
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    # Filled by embedder, not chunker
    embedding: list[float] | None = None
    sparse_vector: dict[str, Any] | None = None
