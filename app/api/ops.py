"""Ops API: document management, knowledge-base metrics, and project group CRUD."""
import csv
import io
import json
import logging
import os
import shutil
import time as _time
from pathlib import Path
from typing import List

import asyncpg
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from db import get_pool

logger = logging.getLogger(__name__)

_STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "/data/rag"))

router = APIRouter(prefix="/api/ops")


async def _get_conn() -> asyncpg.pool.PoolConnectionProxy:
    """Acquire a connection from the shared pool. Pair with _release_conn()."""
    pool = await get_pool()
    return await pool.acquire()


async def _release_conn(conn) -> None:
    pool = await get_pool()
    await pool.release(conn)


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------

@router.get("/documents")
async def list_documents(status: str = "active", limit: int = 50):
    conn = await _get_conn()
    try:
        _select = (
            "SELECT d.doc_id, d.title, d.owner_email, d.business_line, d.status,"
            "       d.admission_score, d.updated_at, d.version, d.source_type,"
            "       d.source_url, d.effective_from, d.effective_to,"
            "       COALESCE(d.acl, '{role:public}') AS acl,"
            "       COALESCE(d.group_ids, '{global}') AS group_ids,"
            "       d.doc_type, d.chunk_size, d.chunk_overlap,"
            "       COUNT(c.chunk_id) FILTER (WHERE c.is_parent = FALSE) AS chunk_count"
            " FROM documents d"
            " LEFT JOIN chunks c ON c.doc_id = d.doc_id"
            "   AND (c.effective_to IS NULL OR c.effective_to > now())"
        )
        if status == "all":
            rows = await conn.fetch(
                _select + " GROUP BY d.doc_id ORDER BY d.updated_at DESC LIMIT $1",
                limit,
            )
        else:
            rows = await conn.fetch(
                _select + " WHERE d.status=$1 GROUP BY d.doc_id ORDER BY d.updated_at DESC LIMIT $2",
                status,
                limit,
            )
        return {"documents": [dict(r) for r in rows]}
    except Exception:
        logger.exception("list_documents failed")
        raise HTTPException(status_code=500, detail="Failed to list documents")
    finally:
        await _release_conn(conn)


@router.delete("/documents/{doc_id}", status_code=204)
async def delete_document(doc_id: str):
    conn = await _get_conn()
    try:
        async with conn.transaction():
            await conn.execute("DELETE FROM chunks WHERE doc_id=$1", doc_id)
            await conn.execute("DELETE FROM documents WHERE doc_id=$1", doc_id)
    finally:
        await _release_conn(conn)


@router.post("/documents/{doc_id}/rebuild")
async def rebuild_document(doc_id: str, file: UploadFile | None = File(None)):
    """Re-parse and re-index a document.

    If `file` is provided, the stored source is replaced before re-processing.
    Otherwise the existing source file on disk is used.
    """
    conn = await _get_conn()
    try:
        doc = await conn.fetchrow(
            "SELECT title, owner_email, business_line, source_path,"
            " version, effective_from, effective_to, doc_type,"
            " chunk_size, chunk_overlap,"
            " COALESCE(acl, '{role:public}') AS acl,"
            " COALESCE(group_ids, '{global}') AS group_ids"
            " FROM documents WHERE doc_id=$1",
            doc_id,
        )
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        groups = list(doc["group_ids"]) or ["global"]
        owner = doc["owner_email"] or ""
        business_line = doc["business_line"] or "default"
        stored_source_path: str | None = doc["source_path"]
        doc_version: str = doc["version"] or "1.0"
        doc_eff_from = doc["effective_from"]
        doc_eff_to = doc["effective_to"]
        doc_acl: list[str] = list(doc["acl"]) if doc["acl"] else ["role:public"]
        doc_type: str | None = doc["doc_type"]
        doc_chunk_size: int | None = doc["chunk_size"]
        doc_chunk_overlap: int | None = doc["chunk_overlap"]
    finally:
        await _release_conn(conn)

    raw_dir = _STORAGE_ROOT / "raw" / doc_id
    raw_dir.mkdir(parents=True, exist_ok=True)

    if file is not None:
        # Replace stored source with the newly uploaded file
        for old in raw_dir.iterdir():
            if old.is_file():
                old.unlink()
        source_file = raw_dir / file.filename
        with source_file.open("wb") as f:
            shutil.copyfileobj(file.file, f)
    else:
        # Resolve existing source file
        source_file = None
        if stored_source_path:
            candidate = Path(stored_source_path)
            if candidate.exists():
                source_file = candidate
        if source_file is None:
            existing = [f for f in raw_dir.iterdir() if f.is_file()]
            if existing:
                source_file = existing[0]
        if source_file is None:
            raise HTTPException(status_code=404, detail="Source file not found on disk")

    # Hard-delete old chunks so stale chunk_ids from removed sections don't linger
    conn = await _get_conn()
    try:
        await conn.execute("DELETE FROM chunks WHERE doc_id=$1", doc_id)
    finally:
        await _release_conn(conn)

    from pipeline.models import Document as PipelineDocument
    from pipeline.parser import parse_document
    from pipeline.chunker import chunk_document
    from pipeline.embedder import embed_chunks
    from pipeline.indexer import index_chunks

    parsed = await parse_document(source_file)
    pipeline_doc = PipelineDocument(
        doc_id=doc_id,
        title=doc["title"] or doc_id,
        owner_email=owner,
        business_line=business_line,
        group_ids=groups,
        source_path=str(source_file),
        version=doc_version,
        effective_from=doc_eff_from,
        effective_to=doc_eff_to,
        acl=doc_acl,
        doc_type=doc_type,
        chunk_size=doc_chunk_size,
        chunk_overlap=doc_chunk_overlap,
    )
    chunks = await chunk_document(parsed, pipeline_doc)
    embedded = await embed_chunks(chunks)
    result = await index_chunks(embedded)

    return {
        "doc_id": doc_id,
        "chunk_count": result["chunk_count"],
        "admission_score": result["admission_score"],
    }


@router.get("/documents/{doc_id}/source")
async def get_document_source(doc_id: str):
    """Return the original document's full text, re-parsed from its stored source file.

    Reuses the same on-disk source resolution as `rebuild_document` but performs
    no writes — parsing is transient, purely for display.
    """
    conn = await _get_conn()
    try:
        doc = await conn.fetchrow(
            "SELECT title, source_path FROM documents WHERE doc_id=$1",
            doc_id,
        )
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        stored_source_path: str | None = doc["source_path"]
    finally:
        await _release_conn(conn)

    source_file = None
    if stored_source_path:
        candidate = Path(stored_source_path)
        if candidate.exists():
            source_file = candidate
    if source_file is None:
        raw_dir = _STORAGE_ROOT / "raw" / doc_id
        if raw_dir.is_dir():
            existing = [f for f in raw_dir.iterdir() if f.is_file()]
            if existing:
                source_file = existing[0]
    if source_file is None:
        raise HTTPException(status_code=404, detail="Source file not found on disk")

    from pipeline.parser import parse_document

    try:
        parsed = await parse_document(source_file)
    except ValueError as e:
        raise HTTPException(status_code=415, detail=str(e))

    return {
        "doc_id": doc_id,
        "title": doc["title"],
        "format": parsed.get("format"),
        "markdown": parsed.get("markdown", ""),
    }


@router.post("/documents/{doc_id}/disable")
async def disable_document(doc_id: str):
    conn = await _get_conn()
    try:
        async with conn.transaction():
            await conn.execute(
                "UPDATE documents SET status='rejected', updated_at=now() WHERE doc_id=$1",
                doc_id,
            )
            await conn.execute(
                "UPDATE chunks SET effective_to=now() WHERE doc_id=$1",
                doc_id,
            )
        return {"doc_id": doc_id, "status": "disabled"}
    finally:
        await _release_conn(conn)


# ---------------------------------------------------------------------------
# Document metadata update
# ---------------------------------------------------------------------------

class DocUpdate(BaseModel):
    title: str | None = None
    owner_email: str | None = None
    version: str | None = None
    source_url: str | None = None
    effective_from: str | None = None
    effective_to: str | None = None
    doc_type: str | None = None
    chunk_size: int | None = None
    chunk_overlap: int | None = None


@router.put("/documents/{doc_id}")
async def update_document(doc_id: str, body: DocUpdate):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        return {"doc_id": doc_id}
    set_clause = ", ".join(f"{k}=${i + 2}" for i, k in enumerate(updates))
    values = list(updates.values())
    conn = await _get_conn()
    try:
        result = await conn.execute(
            f"UPDATE documents SET {set_clause}, updated_at=now() WHERE doc_id=$1",
            doc_id, *values,
        )
        if result == "UPDATE 0":
            raise HTTPException(status_code=404, detail="Document not found")
        return {"doc_id": doc_id, **updates}
    finally:
        await _release_conn(conn)


# ---------------------------------------------------------------------------
# Document ACL
# ---------------------------------------------------------------------------

class AclUpdate(BaseModel):
    acl: List[str]


@router.put("/documents/{doc_id}/acl")
async def set_doc_acl(doc_id: str, body: AclUpdate):
    acl = body.acl or ["role:public"]
    conn = await _get_conn()
    try:
        async with conn.transaction():
            await conn.execute(
                "UPDATE documents SET acl=$2, updated_at=now() WHERE doc_id=$1",
                doc_id, acl,
            )
            await conn.execute(
                "UPDATE chunks SET acl=$2 WHERE doc_id=$1",
                doc_id, acl,
            )
        return {"doc_id": doc_id, "acl": acl}
    finally:
        await _release_conn(conn)


# ---------------------------------------------------------------------------
# Document ↔ group assignment
# ---------------------------------------------------------------------------

class GroupAssign(BaseModel):
    group_ids: List[str]


@router.get("/documents/{doc_id}/groups")
async def get_doc_groups(doc_id: str):
    conn = await _get_conn()
    try:
        rows = await conn.fetch(
            "SELECT pg.group_id, pg.name, pg.description"
            " FROM project_groups pg"
            " WHERE pg.group_id = ANY("
            "   SELECT UNNEST(group_ids) FROM documents WHERE doc_id=$1"
            ")",
            doc_id,
        )
        return {"groups": [dict(r) for r in rows]}
    finally:
        await _release_conn(conn)


@router.put("/documents/{doc_id}/groups")
async def set_doc_groups(doc_id: str, body: GroupAssign):
    """Replace the project groups of a document and sync chunks.product_line."""
    groups = body.group_ids or ["global"]
    conn = await _get_conn()
    try:
        async with conn.transaction():
            await conn.execute(
                "UPDATE documents SET group_ids=$2, updated_at=now() WHERE doc_id=$1",
                doc_id, groups,
            )
            await conn.execute(
                "UPDATE chunks SET product_line=$2 WHERE doc_id=$1",
                doc_id, groups,
            )
        return {"doc_id": doc_id, "group_ids": groups}
    finally:
        await _release_conn(conn)


# ---------------------------------------------------------------------------
# Project groups CRUD
# ---------------------------------------------------------------------------

class GroupCreate(BaseModel):
    group_id: str
    name: str
    description: str = ""


@router.get("/groups")
async def list_groups():
    conn = await _get_conn()
    try:
        rows = await conn.fetch(
            "SELECT group_id, name, description, created_at"
            " FROM project_groups ORDER BY created_at"
        )
        return {"groups": [dict(r) for r in rows]}
    except Exception:
        logger.exception("list_groups failed")
        raise HTTPException(status_code=500, detail="Failed to list groups")
    finally:
        await _release_conn(conn)


@router.post("/groups", status_code=201)
async def create_group(body: GroupCreate):
    conn = await _get_conn()
    try:
        await conn.execute(
            "INSERT INTO project_groups(group_id, name, description)"
            " VALUES($1, $2, $3)",
            body.group_id, body.name, body.description,
        )
        return {"group_id": body.group_id, "name": body.name}
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=409, detail=f"group_id '{body.group_id}' already exists")
    finally:
        await _release_conn(conn)


@router.delete("/groups/{group_id}", status_code=204)
async def delete_group(group_id: str):
    if group_id == "global":
        raise HTTPException(status_code=400, detail="Cannot delete the built-in 'global' group")
    conn = await _get_conn()
    try:
        await conn.execute("DELETE FROM project_groups WHERE group_id=$1", group_id)
    finally:
        await _release_conn(conn)


# ---------------------------------------------------------------------------
# Admission analysis
# ---------------------------------------------------------------------------

@router.get("/documents/{doc_id}/admission")
async def document_admission(doc_id: str):
    """Re-compute admission score breakdown from stored chunks."""
    import statistics as _stats

    conn = await _get_conn()
    try:
        doc = await conn.fetchrow(
            "SELECT admission_score, status FROM documents WHERE doc_id=$1", doc_id
        )
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        # Fetch text fields only — no embedding column to avoid type-codec issues
        rows = await conn.fetch(
            "SELECT content, breadcrumb FROM chunks WHERE doc_id=$1"
            " AND (effective_to IS NULL OR effective_to > now())",
            doc_id,
        )
        chunks = [dict(r) for r in rows]
        chunk_count = len(chunks)

        if not chunks:
            return {
                "doc_id": doc_id,
                "admission_score": doc["admission_score"],
                "status": doc["status"],
                "chunk_count": 0,
                "dimensions": [],
                "issues": ["文档暂无有效知识块，请先重构文档"],
            }

        contents = [c["content"] for c in chunks]
        token_counts = [len(t) // 3 for t in contents]
        total_chars = sum(len(t) for t in contents)
        avg_tokens = _stats.mean(token_counts)

        # ── 1. Content quality (0-30) ─────────────────────────────────────
        content_score = min(30, total_chars // 150)
        content_detail = f"总 {total_chars} 字符 / {chunk_count} 个知识块，满分需 ≥ 4500 字符"

        # ── 2. Structure (0-20) ───────────────────────────────────────────
        depths = [c.get("breadcrumb", "").count(" > ") for c in chunks]
        max_depth = max(depths) if depths else 0
        depth_score = min(10, max_depth * 3)
        if len(token_counts) > 1 and avg_tokens > 0:
            cv = _stats.stdev(token_counts) / avg_tokens
            uniformity = 10 if cv < 0.5 else 7 if cv < 1.0 else 4 if cv < 1.5 else 1
            cv_label = f"CV={cv:.2f}"
        else:
            uniformity = 5
            cv_label = "仅单块"
        struct_score = depth_score + uniformity
        struct_detail = (
            f"最大标题深度 {max_depth} 层（{depth_score}/10），"
            f"块大小均匀度 {uniformity}/10（{cv_label}）"
        )

        # ── 3. Retrievability (0-20) ──────────────────────────────────────
        if 60 <= avg_tokens <= 600:
            tok_score, tok_label = 10, "理想区间"
        elif 30 <= avg_tokens < 60 or 600 < avg_tokens <= 900:
            tok_score, tok_label = 6, "可接受"
        else:
            tok_score, tok_label = 2, "偏差较大"
        short_ratio = sum(1 for t in token_counts if t < 20) / len(token_counts)
        short_score = 10 if short_ratio < 0.1 else 7 if short_ratio < 0.3 else 4 if short_ratio < 0.5 else 1
        ret_score = tok_score + short_score
        ret_detail = (
            f"平均 {int(avg_tokens)} tokens（{tok_label}），"
            f"超短块（<20 tokens）占比 {short_ratio:.0%}"
        )

        # ── 4. Novelty (0-20) — computed entirely in SQL, no vectors to Python ──
        novelty_score = 0
        novelty_detail = "语料库暂无向量数据"
        sims: list[float] = []
        try:
            avg_sim_val = await conn.fetchval(
                """
                SELECT AVG(max_sim) FROM (
                    SELECT (
                        SELECT MAX(1 - (embedding <=> c.embedding))
                        FROM chunks
                        WHERE doc_id != $1
                          AND embedding IS NOT NULL
                    ) AS max_sim
                    FROM chunks c
                    WHERE c.doc_id = $1
                      AND c.embedding IS NOT NULL
                      AND (c.effective_to IS NULL OR c.effective_to > now())
                    LIMIT 5
                ) t
                """,
                doc_id,
            )
            if avg_sim_val is not None:
                avg_sim = float(avg_sim_val)
                sims = [avg_sim]
                novelty_score = int((1.0 - min(avg_sim, 1.0)) * 20)
                novelty_detail = f"与语料库平均余弦相似度 {avg_sim:.2f}（越低越新颖）"
            else:
                novelty_score = 20
                novelty_detail = "语料库中无其他文档，视为完全新颖"
        except Exception as exc:
            novelty_detail = f"向量计算失败：{exc}"

        # ── Issues ───────────────────────────────────────────────────────
        issues: list[str] = []
        if content_score < 15:
            issues.append(f"内容量偏少（当前 {total_chars} 字符），建议补充更多内容")
        if depth_score < 6:
            issues.append(f"标题层级不足（最深 {max_depth} 层），增加章节结构可提升结构分")
        if uniformity <= 4:
            issues.append("知识块大小差异悬殊（CV 偏高），建议检查文档分段格式")
        if avg_tokens < 30:
            issues.append(f"平均知识块过短（{int(avg_tokens)} tokens），可能导致检索召回不足")
        elif avg_tokens > 900:
            issues.append(f"平均知识块过长（{int(avg_tokens)} tokens），建议增加段落分隔")
        if short_ratio >= 0.3:
            issues.append(f"超短知识块占比 {short_ratio:.0%}，建议合并或补充内容")
        if sims and novelty_score < 10:
            issues.append("内容与已有知识库相似度较高，建议确认是否重复导入")

        return {
            "doc_id": doc_id,
            "admission_score": doc["admission_score"],
            "status": doc["status"],
            "chunk_count": chunk_count,
            "dimensions": [
                {"key": "content_quality", "label": "内容质量",  "score": content_score, "max": 30, "detail": content_detail},
                {"key": "structure",       "label": "结构完整性", "score": struct_score,   "max": 20, "detail": struct_detail},
                {"key": "retrievability",  "label": "可检索性",   "score": ret_score,      "max": 20, "detail": ret_detail},
                {"key": "novelty",         "label": "内容新颖度", "score": novelty_score,  "max": 20, "detail": novelty_detail},
                {"key": "base",            "label": "基础分",     "score": 10,             "max": 10, "detail": "固定基础分"},
            ],
            "issues": issues,
        }
    finally:
        await _release_conn(conn)


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

@router.get("/metrics")
async def metrics():
    conn = await _get_conn()
    try:
        chunk_count = await conn.fetchval(
            "SELECT COUNT(*) FROM chunks"
            " WHERE (effective_to IS NULL OR effective_to > now())"
        )
        doc_count = await conn.fetchval(
            "SELECT COUNT(*) FROM documents WHERE status='active'"
        )
        return {
            "chunk_count": chunk_count or 0,
            "doc_count": doc_count or 0,
            "cache_hit_rate": 0.0,
        }
    except Exception:
        logger.exception("metrics failed")
        raise HTTPException(status_code=500, detail="Failed to load metrics")
    finally:
        await _release_conn(conn)


# ---------------------------------------------------------------------------
# Chunks CRUD
# ---------------------------------------------------------------------------

class ChunkUpsert(BaseModel):
    title: str = ""
    breadcrumb: str = ""
    content: str
    version: str | None = None
    source_url: str | None = None
    acl: List[str] | None = None
    region: List[str] | None = None
    effective_from: str | None = None  # ISO datetime string, optional
    effective_to: str | None = None    # ISO datetime string, optional
    doc_type: str | None = None
    category: str | None = None
    tags: List[str] | None = None


@router.get("/documents/{doc_id}/chunks")
async def list_chunks(doc_id: str):
    conn = await _get_conn()
    try:
        rows = await conn.fetch(
            "SELECT chunk_id, title, breadcrumb, content,"
            " version, effective_from, effective_to, updated_at"
            " FROM chunks WHERE doc_id=$1"
            "  AND (effective_to IS NULL OR effective_to > now())"
            " ORDER BY chunk_id",
            doc_id,
        )
        return {"chunks": [dict(r) for r in rows]}
    except Exception:
        logger.exception("list_chunks failed")
        raise HTTPException(status_code=500, detail="Failed to list chunks")
    finally:
        await _release_conn(conn)


_EXPORT_FIELDS = [
    "chunk_id", "doc_id", "doc_title", "title", "breadcrumb", "content",
    "version", "source_url", "effective_from", "effective_to",
    "product_line", "category", "tags", "is_parent", "chunk_index",
]


@router.get("/chunks/export")
async def export_chunks(doc_id: str = "", keyword: str = "", format: str = "csv"):
    """Export all matching chunks as CSV or JSONL, streamed row by row."""
    if format not in ("csv", "jsonl"):
        raise HTTPException(status_code=400, detail="format 必须为 csv 或 jsonl")

    conditions = ["(c.effective_to IS NULL OR c.effective_to > now())"]
    args: list = []
    idx = 1
    if doc_id:
        conditions.append(f"c.doc_id=${idx}")
        args.append(doc_id)
        idx += 1
    if keyword:
        # Escape ILIKE metacharacters so user input is treated as literals.
        escaped = keyword.replace("!", "!!").replace("%", "!%").replace("_", "!_")
        conditions.append(
            f"(c.content ILIKE ${idx} ESCAPE '!'"
            f" OR c.title ILIKE ${idx} ESCAPE '!'"
            f" OR c.breadcrumb ILIKE ${idx} ESCAPE '!')"
        )
        args.append(f"%{escaped}%")
        idx += 1

    where = "WHERE " + " AND ".join(conditions)
    query = (
        f"SELECT c.chunk_id, c.doc_id, d.title AS doc_title,"
        f" c.title, c.breadcrumb, c.content, c.version,"
        f" c.source_url, c.effective_from, c.effective_to,"
        f" c.product_line, c.category, c.tags, c.is_parent, c.chunk_index"
        f" FROM chunks c"
        f" JOIN documents d ON d.doc_id = c.doc_id"
        f" {where}"
        f" ORDER BY c.doc_id, c.chunk_index ASC"
    )

    def _str(v):
        if v is None:
            return ""
        if hasattr(v, "isoformat"):
            return v.isoformat()
        if isinstance(v, list):
            return json.dumps(v, ensure_ascii=False)
        return str(v)

    pool = await get_pool()

    if format == "csv":
        async def generate():
            header = io.StringIO()
            csv.DictWriter(header, fieldnames=_EXPORT_FIELDS, lineterminator="\n").writeheader()
            yield header.getvalue().encode("utf-8")
            async with pool.acquire() as conn:
                async with conn.transaction():
                    async for row in conn.cursor(query, *args):
                        buf = io.StringIO()
                        csv.DictWriter(buf, fieldnames=_EXPORT_FIELDS, lineterminator="\n").writerow(
                            {f: _str(dict(row).get(f)) for f in _EXPORT_FIELDS}
                        )
                        yield buf.getvalue().encode("utf-8")
        media_type = "text/csv"
        suffix = "csv"
    else:
        async def generate():
            async with pool.acquire() as conn:
                async with conn.transaction():
                    async for row in conn.cursor(query, *args):
                        yield (
                            json.dumps(
                                {f: _str(dict(row).get(f)) for f in _EXPORT_FIELDS},
                                ensure_ascii=False,
                            )
                            + "\n"
                        ).encode("utf-8")
        media_type = "application/x-ndjson"
        suffix = "jsonl"

    return StreamingResponse(
        generate(),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="chunks_export.{suffix}"'},
    )


@router.get("/chunks/{chunk_id}")
async def get_chunk(chunk_id: str):
    conn = await _get_conn()
    try:
        row = await conn.fetchrow(
            "SELECT c.chunk_id, c.doc_id, d.title AS doc_title,"
            " c.title, c.breadcrumb, c.content, c.source_url,"
            " c.acl, c.region, c.product_line, c.version,"
            " c.effective_from, c.effective_to,"
            " c.parent_chunk_id, c.doc_type, c.category, c.tags, c.updated_at"
            " FROM chunks c"
            " JOIN documents d ON d.doc_id = c.doc_id"
            " WHERE c.chunk_id=$1",
            chunk_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Chunk not found")
        return dict(row)
    finally:
        await _release_conn(conn)


@router.put("/chunks/{chunk_id}")
async def update_chunk(chunk_id: str, body: ChunkUpsert):
    from inference.embedding import embed
    from pgvector.asyncpg import register_vector

    embedding = None
    try:
        vecs = embed([body.content])
        embedding = vecs[0].dense
    except Exception:
        pass

    # Parse effective_from / effective_to ISO strings
    eff_from = None
    eff_to = None
    if body.effective_from:
        try:
            from datetime import datetime, timezone
            eff_from = datetime.fromisoformat(body.effective_from.replace("Z", "+00:00"))
        except Exception:
            pass
    if body.effective_to:
        try:
            from datetime import datetime, timezone
            eff_to = datetime.fromisoformat(body.effective_to.replace("Z", "+00:00"))
        except Exception:
            pass

    conn = await _get_conn()
    try:
        if embedding is not None:
            await register_vector(conn)
            await conn.execute(
                "UPDATE chunks SET title=$2, breadcrumb=$3, content=$4,"
                " version=COALESCE($5, version),"
                " source_url=COALESCE($6, source_url),"
                " acl=COALESCE($7, acl),"
                " region=COALESCE($8, region),"
                " effective_from=COALESCE($9, effective_from),"
                " effective_to=COALESCE($10, effective_to),"
                " embedding=$11,"
                " doc_type=COALESCE($12, doc_type),"
                " category=COALESCE($13, category),"
                " tags=COALESCE($14, tags),"
                " updated_at=now() WHERE chunk_id=$1",
                chunk_id, body.title, body.breadcrumb, body.content,
                body.version, body.source_url, body.acl, body.region,
                eff_from, eff_to, embedding,
                body.doc_type, body.category, body.tags,
            )
        else:
            await conn.execute(
                "UPDATE chunks SET title=$2, breadcrumb=$3, content=$4,"
                " version=COALESCE($5, version),"
                " source_url=COALESCE($6, source_url),"
                " acl=COALESCE($7, acl),"
                " region=COALESCE($8, region),"
                " effective_from=COALESCE($9, effective_from),"
                " effective_to=COALESCE($10, effective_to),"
                " doc_type=COALESCE($11, doc_type),"
                " category=COALESCE($12, category),"
                " tags=COALESCE($13, tags),"
                " updated_at=now() WHERE chunk_id=$1",
                chunk_id, body.title, body.breadcrumb, body.content,
                body.version, body.source_url, body.acl, body.region,
                eff_from, eff_to,
                body.doc_type, body.category, body.tags,
            )
        row = await conn.fetchrow(
            "SELECT chunk_id, title, breadcrumb, content, source_url,"
            " acl, region, version, effective_from, effective_to,"
            " doc_type, category, tags, updated_at"
            " FROM chunks WHERE chunk_id=$1",
            chunk_id,
        )
        return dict(row) if row else {}
    finally:
        await _release_conn(conn)


@router.delete("/chunks/{chunk_id}", status_code=204)
async def delete_chunk(chunk_id: str):
    conn = await _get_conn()
    try:
        await conn.execute(
            "UPDATE chunks SET effective_to=now() WHERE chunk_id=$1", chunk_id
        )
    finally:
        await _release_conn(conn)


@router.get("/chunks/{chunk_id}/questions")
async def list_questions(chunk_id: str):
    """Return all generated questions for a chunk (without embedding vectors)."""
    conn = await _get_conn()
    try:
        rows = await conn.fetch(
            "SELECT id, question, created_at FROM question_embeddings"
            " WHERE chunk_id=$1 ORDER BY id",
            chunk_id,
        )
    finally:
        await _release_conn(conn)
    return {"chunk_id": chunk_id, "questions": [
        {"id": r["id"], "question": r["question"], "created_at": r["created_at"]}
        for r in rows
    ]}


class QuestionUpdate(BaseModel):
    question: str


@router.post("/chunks/{chunk_id}/questions", status_code=201)
async def add_question(chunk_id: str, body: QuestionUpdate):
    """Manually add a single question for a chunk, embed and store it."""
    import asyncio
    from inference.embedding import embed
    from pgvector.asyncpg import register_vector

    if not body.question.strip():
        raise HTTPException(status_code=422, detail="question cannot be empty")

    embed_results = await asyncio.to_thread(embed, [body.question], "dense")
    vec = embed_results[0].dense

    pool = await get_pool()
    async with pool.acquire() as conn:
        await register_vector(conn)
        row = await conn.fetchrow(
            "INSERT INTO question_embeddings (chunk_id, question, embedding)"
            " VALUES ($1, $2, $3) RETURNING id, question, created_at",
            chunk_id, body.question.strip(), vec,
        )
    return {"id": row["id"], "question": row["question"], "created_at": row["created_at"]}


@router.post("/chunks/{chunk_id}/questions/generate", status_code=201)
async def generate_questions(chunk_id: str, k: int = 4):
    """Use LLM to generate k alternative questions for the chunk, embed and store them.
    Replaces any previously generated questions for this chunk.
    """
    import asyncio
    from inference.embedding import embed
    from inference.llm import get_llm
    from langchain_core.messages import HumanMessage, SystemMessage
    from pgvector.asyncpg import register_vector

    conn = await _get_conn()
    try:
        row = await conn.fetchrow(
            "SELECT content, title FROM chunks WHERE chunk_id=$1", chunk_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="Chunk not found")
        content = row["content"] or ""
        title = row["title"] or ""
    finally:
        await _release_conn(conn)

    # Ask LLM for k questions
    system = (
        f"根据以下知识块内容，生成{k}个用户可能提出的不同问法。"
        "每行一个，不要编号、不要解释、不要重复原文。"
    )
    user = f"标题：{title}\n内容：{content[:1200]}"
    llm = get_llm(max_tokens=300, temperature=0.5)
    resp = await llm.ainvoke([SystemMessage(content=system), HumanMessage(content=user)])
    raw = resp.content
    if isinstance(raw, list):
        raw = "".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in raw)
    questions = [ln.strip() for ln in raw.strip().splitlines() if ln.strip()][:k]

    if not questions:
        raise HTTPException(status_code=502, detail="LLM returned no questions")

    # Batch-embed questions
    embed_results = await asyncio.to_thread(embed, questions, "dense")
    vecs = [r.dense for r in embed_results]

    # Replace old questions and insert new ones
    pool = await get_pool()
    async with pool.acquire() as conn2:
        await register_vector(conn2)
        async with conn2.transaction():
            await conn2.execute("DELETE FROM question_embeddings WHERE chunk_id=$1", chunk_id)
            await conn2.executemany(
                "INSERT INTO question_embeddings(chunk_id, question, embedding)"
                " VALUES($1, $2, $3)",
                [(chunk_id, q, v) for q, v in zip(questions, vecs)],
            )
    logger.info("Generated %d questions for chunk_id=%s", len(questions), chunk_id)
    return {"chunk_id": chunk_id, "generated": len(questions), "questions": questions}


@router.put("/chunks/{chunk_id}/questions/{q_id}")
async def update_question(chunk_id: str, q_id: int, body: QuestionUpdate):
    """Edit question text and re-embed."""
    import asyncio
    from inference.embedding import embed
    from pgvector.asyncpg import register_vector

    if not body.question.strip():
        raise HTTPException(status_code=422, detail="question cannot be empty")

    embed_results = await asyncio.to_thread(embed, [body.question], "dense")
    vec = embed_results[0].dense

    pool = await get_pool()
    async with pool.acquire() as conn:
        await register_vector(conn)
        result = await conn.execute(
            "UPDATE question_embeddings SET question=$1, embedding=$2"
            " WHERE id=$3 AND chunk_id=$4",
            body.question, vec, q_id, chunk_id,
        )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Question not found")
    return {"id": q_id, "question": body.question}


@router.delete("/chunks/{chunk_id}/questions/{q_id}", status_code=204)
async def delete_question(chunk_id: str, q_id: int):
    conn = await _get_conn()
    try:
        await conn.execute(
            "DELETE FROM question_embeddings WHERE id=$1 AND chunk_id=$2",
            q_id, chunk_id,
        )
    finally:
        await _release_conn(conn)


@router.post("/documents/{doc_id}/chunks", status_code=201)
async def create_chunk(doc_id: str, body: ChunkUpsert):
    import time as _time
    from inference.embedding import embed
    from pgvector.asyncpg import register_vector

    chunk_id = f"{doc_id}#manual_{int(_time.time() * 1000)}"

    embedding = None
    try:
        vecs = embed([body.content])
        embedding = vecs[0].dense
    except Exception:
        pass

    conn = await _get_conn()
    try:
        doc_row = await conn.fetchrow(
            "SELECT COALESCE(group_ids, '{global}') AS group_ids FROM documents WHERE doc_id=$1",
            doc_id,
        )
        product_line = list(doc_row["group_ids"]) if doc_row else ["global"]

        if embedding is not None:
            await register_vector(conn)
            await conn.execute(
                "INSERT INTO chunks(chunk_id, doc_id, title, breadcrumb, content,"
                " product_line, embedding, updated_at)"
                " VALUES($1, $2, $3, $4, $5, $6, $7, now())",
                chunk_id, doc_id, body.title, body.breadcrumb, body.content,
                product_line, embedding,
            )
        else:
            await conn.execute(
                "INSERT INTO chunks(chunk_id, doc_id, title, breadcrumb, content,"
                " product_line, updated_at)"
                " VALUES($1, $2, $3, $4, $5, $6, now())",
                chunk_id, doc_id, body.title, body.breadcrumb, body.content,
                product_line,
            )
        return {"chunk_id": chunk_id, "doc_id": doc_id}
    finally:
        await _release_conn(conn)


# ---------------------------------------------------------------------------
# Chunks — cross-document listing & bulk import
# (export is registered above get_chunk so the literal path wins over {chunk_id})
# ---------------------------------------------------------------------------

@router.get("/chunks")
async def list_all_chunks(doc_id: str = "", keyword: str = "", limit: int = 50, offset: int = 0):
    """List chunks across all documents, optionally filtered by doc_id or keyword."""
    conn = await _get_conn()
    try:
        conditions = ["(c.effective_to IS NULL OR c.effective_to > now())"]
        args: list = []
        idx = 1

        if doc_id:
            conditions.append(f"c.doc_id=${idx}")
            args.append(doc_id)
            idx += 1
        if keyword:
            conditions.append(f"(c.content ILIKE ${idx} OR c.title ILIKE ${idx} OR c.breadcrumb ILIKE ${idx})")
            args.append(f"%{keyword}%")
            idx += 1

        where = "WHERE " + " AND ".join(conditions)
        rows = await conn.fetch(
            f"SELECT c.chunk_id, c.doc_id, d.title AS doc_title,"
            f" c.title, c.breadcrumb, c.content, c.version,"
            f" c.source_url, c.acl, c.region, c.product_line,"
            f" c.effective_from, c.effective_to, c.updated_at,"
            f" c.doc_type, c.category, c.tags, c.is_parent"
            f" FROM chunks c"
            f" JOIN documents d ON d.doc_id = c.doc_id"
            f" {where}"
            f" ORDER BY c.updated_at DESC"
            f" LIMIT ${idx} OFFSET ${idx + 1}",
            *args, limit, offset,
        )
        total = await conn.fetchval(
            f"SELECT COUNT(*) FROM chunks c {where}", *args
        )
        return {"chunks": [dict(r) for r in rows], "total": total}
    except Exception:
        logger.exception("list_all_chunks failed")
        raise HTTPException(status_code=500, detail="Failed to list chunks")
    finally:
        await _release_conn(conn)


def _parse_chunk_file(text: str, filename: str) -> list[dict]:
    """Parse a JSONL or CSV file into chunk dicts. CSV must have a 'content' column."""
    ext = (filename or "").rsplit(".", 1)[-1].lower()
    if ext == "csv":
        reader = csv.DictReader(io.StringIO(text))
        items: list[dict] = []
        for row_num, row in enumerate(reader, 2):
            content = row.get("content", "").strip()
            if not content:
                raise HTTPException(status_code=422, detail=f"Missing 'content' at row {row_num}")
            items.append({k: v.strip() for k, v in row.items()})
        return items
    # Default: JSONL
    items = []
    for lineno, line in enumerate(text.splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            raise HTTPException(status_code=422, detail=f"Invalid JSON at line {lineno}")
        if not obj.get("content", "").strip():
            raise HTTPException(status_code=422, detail=f"Missing 'content' at line {lineno}")
        items.append(obj)
    return items


@router.post("/chunks/import", status_code=201)
async def import_chunks_jsonl(
    file: UploadFile = File(...),
    doc_id: str = "",
    doc_title: str = "",
):
    """Bulk-import chunks from a JSONL or CSV file.

    JSONL: {"title": "...", "breadcrumb": "...", "content": "...", "version": "1.0"}
    CSV:   columns title,breadcrumb,content,version (content required)

    Supply doc_id to append to an existing document, or doc_title to create a new one.
    """
    if not doc_id and not doc_title:
        raise HTTPException(status_code=422, detail="Either doc_id or doc_title is required")

    raw = await file.read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=422, detail="File must be UTF-8 encoded")

    items = _parse_chunk_file(text, file.filename or "")

    if not items:
        raise HTTPException(status_code=422, detail="No valid items found in file")

    conn = await _get_conn()
    try:
        # Resolve or create the target document
        if doc_id:
            row = await conn.fetchrow("SELECT doc_id FROM documents WHERE doc_id=$1", doc_id)
            if not row:
                raise HTTPException(status_code=404, detail=f"Document '{doc_id}' not found")
            target_doc_id = doc_id
        else:
            target_doc_id = f"doc_{int(_time.time() * 1000)}"
            await conn.execute(
                "INSERT INTO documents(doc_id, title, owner_email, business_line, status, updated_at)"
                " VALUES($1, $2, 'import', 'default', 'active', now())",
                target_doc_id, doc_title.strip(),
            )

        from inference.embedding import embed
        from pgvector.asyncpg import register_vector
        await register_vector(conn)

        doc_row = await conn.fetchrow(
            "SELECT COALESCE(group_ids, '{global}') AS group_ids FROM documents WHERE doc_id=$1",
            target_doc_id,
        )
        product_line = list(doc_row["group_ids"]) if doc_row else ["global"]

        ts = int(_time.time() * 1000)
        contents = [item["content"].strip() for item in items]
        chunk_ids = [f"{target_doc_id}#import_{ts}_{i:04d}" for i in range(len(items))]

        embeddings: list = [None] * len(items)
        try:
            vecs = embed(contents)
            for i, v in enumerate(vecs):
                embeddings[i] = v.dense
        except Exception:
            pass

        with_emb = []
        without_emb = []
        for i, item in enumerate(items):
            row = (
                chunk_ids[i], target_doc_id,
                item.get("title", ""), item.get("breadcrumb", ""),
                contents[i], item.get("version"),
                product_line,
            )
            if embeddings[i] is not None:
                with_emb.append((*row, embeddings[i]))
            else:
                without_emb.append(row)

        if with_emb:
            await conn.executemany(
                "INSERT INTO chunks(chunk_id, doc_id, title, breadcrumb, content,"
                " version, product_line, embedding, updated_at)"
                " VALUES($1, $2, $3, $4, $5, $6, $7, $8, now())",
                with_emb,
            )
        if without_emb:
            await conn.executemany(
                "INSERT INTO chunks(chunk_id, doc_id, title, breadcrumb, content,"
                " version, product_line, updated_at)"
                " VALUES($1, $2, $3, $4, $5, $6, $7, now())",
                without_emb,
            )

        return {
            "doc_id": target_doc_id,
            "imported": len(items),
        }
    finally:
        await _release_conn(conn)


# ---------------------------------------------------------------------------
# Prompt version management (source of truth: prompt_versions table)
# ---------------------------------------------------------------------------

PROMPT_TYPES = ["chat", "rewrite", "summary"]


class PromptCreate(BaseModel):
    version: str
    note: str = ""
    content: str
    prompt_type: str = "chat"


@router.get("/prompts")
async def list_prompts(prompt_type: str | None = None):
    conn = await _get_conn()
    try:
        if prompt_type:
            rows = await conn.fetch(
                "SELECT version, note, created_at, is_active, prompt_type"
                " FROM prompt_versions WHERE prompt_type=$1 ORDER BY created_at DESC",
                prompt_type,
            )
        else:
            rows = await conn.fetch(
                "SELECT version, note, created_at, is_active, prompt_type"
                " FROM prompt_versions ORDER BY created_at DESC"
            )
        return {"prompts": [dict(r) for r in rows]}
    except Exception:
        logger.exception("list_prompts failed")
        raise HTTPException(status_code=500, detail="Failed to list prompts")
    finally:
        await _release_conn(conn)


@router.get("/prompts/{version}")
async def get_prompt(version: str):
    conn = await _get_conn()
    try:
        row = await conn.fetchrow(
            "SELECT version, content, note, created_at, is_active, prompt_type"
            " FROM prompt_versions WHERE version=$1",
            version,
        )
        if not row:
            raise HTTPException(status_code=404, detail=f"Version '{version}' not found")
        return dict(row)
    finally:
        await _release_conn(conn)


@router.post("/prompts", status_code=201)
async def create_prompt(body: PromptCreate):
    if not body.version.strip():
        raise HTTPException(status_code=422, detail="version is required")
    if not body.content.strip():
        raise HTTPException(status_code=422, detail="content is required")
    pt = body.prompt_type.strip() or "chat"
    conn = await _get_conn()
    try:
        try:
            await conn.execute(
                "INSERT INTO prompt_versions(version, content, note, prompt_type)"
                " VALUES($1, $2, $3, $4)",
                body.version.strip(), body.content.strip(), body.note, pt,
            )
        except asyncpg.UniqueViolationError:
            raise HTTPException(status_code=409, detail=f"Version '{body.version}' already exists")
        return {"version": body.version.strip()}
    finally:
        await _release_conn(conn)


@router.post("/prompts/{version}/activate")
async def activate_prompt(version: str):
    conn = await _get_conn()
    try:
        row = await conn.fetchrow(
            "SELECT content, prompt_type FROM prompt_versions WHERE version=$1", version
        )
        if not row:
            raise HTTPException(status_code=404, detail=f"Version '{version}' not found")
        async with conn.transaction():
            # Only deactivate versions of the same type
            await conn.execute(
                "UPDATE prompt_versions SET is_active=FALSE WHERE prompt_type=$1",
                row["prompt_type"],
            )
            await conn.execute(
                "UPDATE prompt_versions SET is_active=TRUE WHERE version=$1", version
            )
    finally:
        await _release_conn(conn)
    # Refresh Redis cache for chat type (best-effort)
    if row["prompt_type"] == "chat":
        try:
            import redis.asyncio as aioredis
            rc = aioredis.from_url(os.getenv("REDIS_URL", "redis://redis:6379/0"))
            await rc.set("verity:prompt:active", row["content"])
            await rc.aclose()
        except Exception:
            pass
    return {"activated": version}
