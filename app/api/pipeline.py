import asyncio
import logging
import os
import shutil
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, UploadFile, Form
from fastapi.responses import JSONResponse

from job_registry import create_job, mark_running, publish_progress
from pipeline.models import Document
from pipeline.parser import parse_document
from pipeline.chunker import chunk_document
from pipeline.embedder import embed_chunks
from pipeline.indexer import index_chunks

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/pipeline")
_STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "/data/rag"))


def _parse_dt(s: str) -> datetime | None:
    if not s or not s.strip():
        return None
    try:
        return datetime.fromisoformat(s.strip())
    except (ValueError, TypeError):
        return None


async def _run_ingest(job_id: str, raw_path: Path, doc: Document) -> None:
    try:
        await mark_running(job_id)

        await publish_progress(job_id, "running", 0, 4, "解析文档中…")
        parsed = await parse_document(raw_path)
        doc.title = parsed.get("metadata", {}).get("title", doc.doc_id)

        await publish_progress(job_id, "running", 1, 4, "切分中…")
        chunks = await chunk_document(parsed, doc)

        await publish_progress(job_id, "running", 2, 4, "嵌入中…")
        embedded = await embed_chunks(chunks)

        await publish_progress(job_id, "running", 3, 4, "写入索引…")
        result = await index_chunks(embedded)

        await publish_progress(
            job_id, "completed",
            current=4, total=4,
            result_data={
                "doc_id": doc.doc_id,
                "chunk_count": result["chunk_count"],
                "admission_score": result["admission_score"],
                "status": result.get("status", "pending"),
                "product_line": doc.product_line,
            },
        )
        logger.info("Ingest job %s completed: doc=%s chunks=%d", job_id, doc.doc_id, result["chunk_count"])

    except Exception as exc:
        logger.exception("Ingest job %s failed: %s", job_id, exc)
        await publish_progress(job_id, "failed", error_message=str(exc))


@router.post("/ingest", status_code=202)
async def ingest(
    file: UploadFile,
    doc_id: str = Form(...),
    owner: str = Form(...),
    product_line: str = Form(""),
    acl_roles: str = Form("role:public"),
    source_url: str = Form(""),
    version: str = Form("1.0"),
    effective_from: str = Form(""),
    effective_to: str = Form(""),
    doc_type: str = Form(""),
    default_category: str = Form(""),
    default_tags: str = Form(""),
    region: str = Form(""),
    chunk_size: int = Form(0),
    chunk_overlap: int = Form(0),
):
    raw_path = _STORAGE_ROOT / "raw" / doc_id / file.filename
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    with raw_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    groups = [g.strip() for g in product_line.split(",") if g.strip()] or ["global"]
    acl = [r.strip() for r in acl_roles.split(",") if r.strip()] or ["role:public"]
    tag_list = [t.strip() for t in default_tags.split(",") if t.strip()]
    region_list = [r.strip() for r in region.split(",") if r.strip()] or ["global"]

    doc = Document(
        doc_id=doc_id,
        title=file.filename.rsplit(".", 1)[0],  # updated inside _run_ingest after parse
        owner_email=owner,
        product_line=groups,
        source_path=str(raw_path),
        source_url=source_url or None,
        version=version.strip() or "1.0",
        effective_from=_parse_dt(effective_from),
        effective_to=_parse_dt(effective_to),
        acl=acl,
        region=region_list,
        doc_type=doc_type.strip() or None,
        default_category=default_category.strip() or None,
        default_tags=tag_list,
        chunk_size=chunk_size if chunk_size > 0 else None,
        chunk_overlap=chunk_overlap if chunk_overlap > 0 else None,
    )

    job_id = await create_job(
        job_type="ingest",
        display_name=f"解析 {file.filename}",
        ref_id=doc_id,
        created_by=owner,
    )

    asyncio.create_task(_run_ingest(job_id, raw_path, doc))

    return JSONResponse(
        status_code=202,
        content={"job_id": job_id, "doc_id": doc_id, "status": "pending"},
    )
