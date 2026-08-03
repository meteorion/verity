"""Tools API: stateless document utilities that produce output without writing to the DB."""
import asyncio
import csv
import dataclasses
import io
import json
import re
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import Response

from pipeline.chunker import chunk_document
from pipeline.models import Chunk, Document
from pipeline.parser import parse_document
from pipeline.structurer import structure_with_llm

router = APIRouter(prefix="/api/tools")

_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
_TIMEOUT_S = 55

_CSV_FIELDS = [
    "chunk_id", "doc_id", "chunk_index", "title", "breadcrumb", "content",
    "tokens_est", "is_parent", "parent_chunk_id", "source_url",
    "doc_type", "category", "product_line", "region", "acl",
    "version", "effective_from", "effective_to", "tags", "updated_at",
]


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
    for k, v in d.items():
        if isinstance(v, datetime):
            d[k] = v.isoformat()
    return d


def _format_response(chunks: list[Chunk], fmt: str) -> Response:
    rows = [_chunk_to_dict(c) for c in chunks]

    if fmt == "json":
        return Response(
            content=json.dumps(rows, ensure_ascii=False, indent=2).encode("utf-8"),
            media_type="application/json",
            headers={"Content-Disposition": 'attachment; filename="chunks.json"'},
        )

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=_CSV_FIELDS, lineterminator="\n", extrasaction="ignore")
    writer.writeheader()
    for r in rows:
        row = {}
        for f in _CSV_FIELDS:
            v = r.get(f)
            if isinstance(v, list):
                row[f] = json.dumps(v, ensure_ascii=False)
            else:
                row[f] = "" if v is None else v
        writer.writerow(row)

    return Response(
        content=buf.getvalue().encode("utf-8"),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="chunks.csv"'},
    )


@router.post("/chunk-export")
async def chunk_export(
    file: UploadFile,
    format: Literal["json", "csv"] = "json",
    chunk_size: int | None = None,
    chunk_overlap: int | None = None,
    use_llm_structure: bool = False,
    doc_id: str | None = None,
    doc_type: str | None = None,
    category: str | None = None,
    source_url: str | None = None,
    product_line: str = "global",
    acl: str = "role:public",
    version: str | None = None,
    effective_from: str | None = None,
    effective_to: str | None = None,
    tags: str | None = None,
):
    """Parse an uploaded document into chunks and return without writing to the DB."""
    raw = await file.read()
    if len(raw) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="文件超过 10 MB 限制")

    suffix = Path(file.filename or "file").suffix or ".txt"
    _doc_id = doc_id or _slugify(Path(file.filename or "doc").stem)

    async def _process() -> list[Chunk]:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(raw)
            tmp_path = Path(tmp.name)
        try:
            parsed = await parse_document(tmp_path)
        finally:
            tmp_path.unlink(missing_ok=True)

        _doc_type = doc_type
        _source_url = source_url
        if use_llm_structure:
            result = await structure_with_llm(parsed["markdown"])
            parsed["markdown"] = result.markdown
            _doc_type = doc_type or result.doc_type
            _source_url = source_url or result.source_url

        doc = Document(
            doc_id=_doc_id,
            title=parsed["metadata"].get("title", _doc_id),
            owner_email="",
            business_line="",
            group_ids=_split_csv(product_line),
            source_url=_source_url,
            doc_type=_doc_type,
            category=category,
            acl=_split_csv(acl),
            version=version,
            effective_from=_parse_dt(effective_from),
            effective_to=_parse_dt(effective_to),
            tags=_split_csv(tags or ""),
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )
        return await chunk_document(parsed, doc, dry_run=True)

    try:
        chunks = await asyncio.wait_for(_process(), timeout=_TIMEOUT_S)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=503, detail="处理超时，请减小文件或关闭 use_llm_structure")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return _format_response(chunks, format)
