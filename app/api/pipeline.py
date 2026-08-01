import os
import shutil
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, UploadFile, Form

from db import get_pool
from pipeline.parser import parse_document
from pipeline.chunker import chunk_document
from pipeline.embedder import embed_chunks
from pipeline.indexer import index_chunks

router = APIRouter(prefix="/api/pipeline")
_STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "/data/rag"))


def _parse_dt(s: str) -> datetime | None:
    if not s or not s.strip():
        return None
    try:
        return datetime.fromisoformat(s.strip())
    except (ValueError, TypeError):
        return None


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
):
    raw_path = _STORAGE_ROOT / "raw" / doc_id / file.filename
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    with raw_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    groups = [g.strip() for g in group_ids.split(",") if g.strip()] or ["global"]
    acl = [r.strip() for r in acl_roles.split(",") if r.strip()] or ["role:public"]
    ver = version.strip() or "1.0"
    eff_from = _parse_dt(effective_from)
    eff_to = _parse_dt(effective_to)

    parsed = await parse_document(raw_path)

    chunks = await chunk_document(
        parsed, doc_id=doc_id, owner=owner, business_line=business_line,
        groups=groups, source_path=str(raw_path),
        source_url=source_url or None,
        version=ver,
        effective_from=eff_from,
        effective_to=eff_to,
        acl=acl,
    )
    embedded = await embed_chunks(chunks)
    result = await index_chunks(embedded)

    if os.environ.get("PGVECTOR_DSN", "") and groups:
        pool = await get_pool()
        await pool.executemany(
            "INSERT INTO document_groups(doc_id, group_id) VALUES($1, $2)"
            " ON CONFLICT DO NOTHING",
            [(doc_id, gid) for gid in groups],
        )

    return {
        "doc_id": doc_id,
        "chunk_count": result["chunk_count"],
        "admission_score": result["admission_score"],
        "group_ids": groups,
    }
