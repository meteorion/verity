import os
import re
import shutil
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, Form

from db import get_pool
from pipeline.models import Document
from pipeline.parser import parse_document
from pipeline.chunker import chunk_document
from pipeline.embedder import embed_chunks
from pipeline.indexer import index_chunks

router = APIRouter(prefix="/api/pipeline")
_STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "/data/rag")).resolve()
_DOC_ID_RE = re.compile(r"^[A-Za-z0-9_.\-]+$")


def _parse_dt(s: str) -> datetime | None:
    if not s or not s.strip():
        return None
    try:
        return datetime.fromisoformat(s.strip())
    except (ValueError, TypeError):
        return None


def _safe_storage_path(doc_id: str, filename: str | None = None) -> tuple[Path, Path | None]:
    """Return (raw_dir, raw_file) paths that are guaranteed to be inside _STORAGE_ROOT.

    Raises HTTPException(400) on doc_id containing traversal segments or
    disallowed characters, or on filename attempting to escape the directory.
    """
    if not doc_id or not _DOC_ID_RE.match(doc_id):
        raise HTTPException(
            status_code=400,
            detail="doc_id 只能包含字母、数字、下划线、连字符和点",
        )
    raw_dir = (_STORAGE_ROOT / "raw" / doc_id).resolve()
    # The resolved raw_dir must still be exactly one level under _STORAGE_ROOT/raw —
    # catches "." collapsing to the parent dir, ".." escaping, or symlink jumps.
    expected_parent = (_STORAGE_ROOT / "raw").resolve()
    if raw_dir.parent != expected_parent:
        raise HTTPException(status_code=400, detail="doc_id 非法")
    if filename is None:
        return raw_dir, None
    safe_name = Path(filename).name  # basename only — strips any directory components
    if not safe_name or safe_name in (".", ".."):
        raise HTTPException(status_code=400, detail="文件名非法")
    raw_file = (raw_dir / safe_name).resolve()
    if str(raw_file.parent) != str(raw_dir):
        raise HTTPException(status_code=400, detail="文件名非法")
    return raw_dir, raw_file


@router.post("/ingest")
async def ingest(
    file: UploadFile,
    doc_id: str = Form(...),
    owner: str = Form(...),
    business_line: str = Form("default"),
    group_ids: str = Form(""),
    acl_roles: str = Form("role:public"),
    source_url: str = Form(""),
    version: str = Form("1.0"),
    effective_from: str = Form(""),
    effective_to: str = Form(""),
    doc_type: str = Form(""),
    category: str = Form(""),
    tags: str = Form(""),
    chunk_size: int = Form(0),
    chunk_overlap: int = Form(0),
):
    raw_dir, raw_path = _safe_storage_path(doc_id, file.filename)
    assert raw_path is not None
    raw_dir.mkdir(parents=True, exist_ok=True)
    with raw_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    groups = [g.strip() for g in group_ids.split(",") if g.strip()] or ["global"]
    acl = [r.strip() for r in acl_roles.split(",") if r.strip()] or ["role:public"]
    tag_list = [t.strip() for t in tags.split(",") if t.strip()]
    ver = version.strip() or "1.0"
    eff_from = _parse_dt(effective_from)
    eff_to = _parse_dt(effective_to)

    parsed = await parse_document(raw_path)

    doc = Document(
        doc_id=doc_id,
        title=parsed.get("metadata", {}).get("title", doc_id),
        owner_email=owner,
        business_line=business_line,
        group_ids=groups,
        source_path=str(raw_path),
        source_url=source_url or None,
        version=ver,
        effective_from=eff_from,
        effective_to=eff_to,
        acl=acl,
        doc_type=doc_type.strip() or None,
        category=category.strip() or None,
        tags=tag_list,
        chunk_size=chunk_size if chunk_size > 0 else None,
        chunk_overlap=chunk_overlap if chunk_overlap > 0 else None,
    )
    chunks = await chunk_document(parsed, doc)
    embedded = await embed_chunks(chunks)
    result = await index_chunks(embedded)

    return {
        "doc_id": doc_id,
        "chunk_count": result["chunk_count"],
        "admission_score": result["admission_score"],
        "group_ids": groups,
    }
