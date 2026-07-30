import shutil
from pathlib import Path

from fastapi import APIRouter, UploadFile, Form
import os

from pipeline.parser import parse_document
from pipeline.chunker import chunk_document
from pipeline.embedder import embed_chunks
from pipeline.indexer import index_chunks

router = APIRouter(prefix="/api/pipeline")
_STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "/data/rag"))


@router.post("/ingest")
async def ingest(
    file: UploadFile,
    doc_id: str = Form(...),
    owner: str = Form(...),
    business_line: str = Form("default"),
):
    raw_path = _STORAGE_ROOT / "raw" / doc_id / file.filename
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    with raw_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    parsed = await parse_document(raw_path)
    chunks = await chunk_document(parsed, doc_id=doc_id, owner=owner, business_line=business_line)
    embedded = await embed_chunks(chunks)
    await index_chunks(embedded)

    return {"doc_id": doc_id, "chunk_count": len(chunks)}
