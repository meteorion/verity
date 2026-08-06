"""Domain models for the chunking pipeline."""
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass
class Document:
    doc_id: str
    title: str
    owner_email: str
    product_line: list[str] = field(default_factory=lambda: ["global"])
    # business_line: free-text informational label (e.g. "payments"); NOT used for retrieval filtering.
    # Use product_line for access-control grouping (shouyintong / saas / lianhe_shoudan / global).
    business_line: str = ""
    source_type: str = "upload"
    source_path: str | None = None
    source_url: str | None = None
    version: str | None = None
    effective_from: datetime | None = None
    effective_to: datetime | None = None
    acl: list[str] = field(default_factory=lambda: ["role:public"])
    region: list[str] = field(default_factory=lambda: ["global"])
    doc_type: str | None = None  # FAQ / 操作手册 / 政策说明 / 合同模板
    # default_category / default_tags: propagated to all child chunks at ingest time.
    # Not a document-level classification — a large doc may span multiple categories.
    default_category: str | None = None
    default_tags: list[str] = field(default_factory=list)
    chunk_size: int | None = None    # per-doc override; None = use global setting
    chunk_overlap: int | None = None
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
