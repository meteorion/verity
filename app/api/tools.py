"""Tools API: document utilities that produce output without writing to the DB."""
import asyncio
import dataclasses
import json
import logging
import os
import re
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from job_registry import create_job, mark_running, publish_progress
from pipeline.chunker import chunk_document
from pipeline.models import Chunk, Document
from pipeline.parser import parse_document
from pipeline.structurer import structure_with_llm

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/tools")

_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
_TIMEOUT_EXPORT_S = 300          # background export timeout
_STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "/data/rag"))


def _slugify(name: str) -> str:
    name = re.sub(r"[^\w一-鿿-]", "-", name)
    return re.sub(r"-+", "-", name).strip("-").lower()


def _split_csv(s: str) -> list[str]:
    return [x.strip() for x in s.split(",") if x.strip()]


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    from datetime import timezone
    return datetime.fromisoformat(s).astimezone(timezone.utc)


def _chunk_to_dict(chunk: Chunk) -> dict:
    d = dataclasses.asdict(chunk)
    d.pop("embedding", None)
    d.pop("sparse_vector", None)
    d["tokens_est"] = len(chunk.content) // 3
    for k in list(d.keys()):
        if isinstance(d[k], datetime):
            d[k] = d[k].isoformat()
    return d


async def _run_chunk_export(
    job_id: str,
    raw: bytes,
    file_suffix: str,
    doc: Document,
    filename: str,
    fmt: str,
    use_llm_structure: bool = False,
) -> None:
    export_dir = _STORAGE_ROOT / "exports"
    export_dir.mkdir(parents=True, exist_ok=True)
    export_path = export_dir / f"{job_id}.{fmt}"

    try:
        await mark_running(job_id)
        await publish_progress(job_id, "running", 0, 3, "解析文档中…")

        with tempfile.NamedTemporaryFile(suffix=file_suffix, delete=False) as tmp:
            tmp.write(raw)
            tmp_path = Path(tmp.name)
        try:
            parsed = await asyncio.wait_for(parse_document(tmp_path), timeout=_TIMEOUT_EXPORT_S)
        finally:
            tmp_path.unlink(missing_ok=True)

        doc.title = parsed.get("metadata", {}).get("title", doc.doc_id)

        if use_llm_structure:
            await publish_progress(job_id, "running", 1, 4, "LLM 结构化中…")
            result = await asyncio.wait_for(structure_with_llm(parsed["markdown"]), timeout=_TIMEOUT_EXPORT_S)
            parsed["markdown"] = result.markdown
            doc.doc_type = doc.doc_type or result.doc_type
            doc.source_url = doc.source_url or result.source_url

        total_phases = 4 if use_llm_structure else 3
        await publish_progress(job_id, "running", total_phases - 2, total_phases, "切分中…")
        chunks = await chunk_document(parsed, doc, dry_run=True)
        retrieval_chunks = [c for c in chunks if not c.is_parent]

        await publish_progress(job_id, "running", total_phases - 1, total_phases, "写文件…")
        rows = [_chunk_to_dict(c) for c in chunks]
        if fmt == "jsonl":
            content = "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n"
        else:
            content = json.dumps(rows, ensure_ascii=False, indent=2)

        export_path.write_text(content, encoding="utf-8")
        file_size = export_path.stat().st_size

        await publish_progress(
            job_id, "completed",
            current=total_phases,
            total=total_phases,
            result_data={
                "file_path": str(export_path),
                "file_size_bytes": file_size,
                "chunk_count": len(retrieval_chunks),
                "format": fmt,
                "filename": f"chunks_{doc.doc_id}.{fmt}",
            },
        )
        logger.info("Chunk export job %s completed: %d chunks → %s", job_id, len(retrieval_chunks), export_path.name)

    except asyncio.TimeoutError:
        export_path.unlink(missing_ok=True)
        await publish_progress(job_id, "failed", error_message="处理超时，请减小文件或关闭 LLM 结构化")
    except Exception as exc:
        export_path.unlink(missing_ok=True)
        logger.exception("Chunk export job %s failed", job_id)
        await publish_progress(job_id, "failed", error_message=str(exc))


@router.post("/chunk-export", status_code=202)
async def chunk_export(
    file: UploadFile,
    format: Literal["json", "jsonl"] = Form("jsonl"),
    chunk_size: int | None = Form(None),
    chunk_overlap: int | None = Form(None),
    use_llm_structure: bool = Form(False),
    doc_id: str | None = Form(None),
    doc_type: str | None = Form(None),
    category: str | None = Form(None),
    source_url: str | None = Form(None),
    product_line: str = Form("global"),
    acl: str = Form("role:public"),
    version: str | None = Form(None),
    effective_from: str | None = Form(None),
    effective_to: str | None = Form(None),
    tags: str | None = Form(None),
):
    """Parse + chunk a document in the background; result downloadable via /api/jobs/{id}/download."""
    raw = await file.read()
    if len(raw) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="文件超过 10 MB 限制")

    file_suffix = Path(file.filename or "file").suffix or ".txt"
    _doc_id = doc_id or _slugify(Path(file.filename or "doc").stem)
    filename = file.filename or "file"

    doc = Document(
        doc_id=_doc_id,
        title=_doc_id,
        owner_email="",
        business_line="",
        product_line=_split_csv(product_line),
        source_url=source_url,
        doc_type=doc_type,
        default_category=category,
        acl=_split_csv(acl),
        version=version,
        effective_from=_parse_dt(effective_from),
        effective_to=_parse_dt(effective_to),
        default_tags=_split_csv(tags or ""),
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
    )

    job_id = await create_job(
        job_type="chunk_export",
        display_name=f"导出 {filename}",
        ref_id=_doc_id,
        created_by="admin",
    )

    asyncio.create_task(_run_chunk_export(job_id, raw, file_suffix, doc, filename, format, use_llm_structure))

    return JSONResponse(
        status_code=202,
        content={"job_id": job_id, "doc_id": _doc_id, "status": "pending"},
    )
