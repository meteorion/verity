"""Hierarchical chunker: heading-aware split + breadcrumb injection + parent-child DB storage."""
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any

from db import get_pool
from pipeline.models import Chunk, Document

logger = logging.getLogger(__name__)

_STORAGE_ROOT_ENV = os.getenv("STORAGE_ROOT", "/data/rag")
_CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "600"))
_CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "80"))

_HEADING_RE = re.compile(r"^(#{1,4})\s+(.+)", re.MULTILINE)


def _get_chunk_params() -> tuple[int, int]:
    try:
        from api.settings import load_settings
        s = load_settings()
        size = int(s.get("chunk_size") or _CHUNK_SIZE)
        overlap = int(s.get("chunk_overlap") or _CHUNK_OVERLAP)
        return size, overlap
    except Exception:
        return _CHUNK_SIZE, _CHUNK_OVERLAP


def _token_est(text: str) -> int:
    return len(text) // 3


def _parse_sections(markdown: str) -> list[tuple[int, str, str]]:
    """Return list of (heading_level, heading_text, body_text) tuples."""
    matches = list(_HEADING_RE.finditer(markdown))
    if not matches:
        return [(0, "", markdown.strip())]

    sections: list[tuple[int, str, str]] = []
    preamble = markdown[: matches[0].start()].strip()
    if preamble:
        sections.append((0, "", preamble))

    for i, m in enumerate(matches):
        level = len(m.group(1))
        heading_text = m.group(2).strip()
        body_start = m.end()
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(markdown)
        body = markdown[body_start:body_end].strip()
        sections.append((level, heading_text, body))

    return sections


def _build_breadcrumb(doc_title: str, heading_stack: list[str]) -> str:
    parts = [doc_title] + [h for h in heading_stack if h]
    return " > ".join(parts)


def _split_by_paragraphs(
    text: str,
    breadcrumb_line: str,
    chunk_size: int,
    overlap: int,
) -> list[str]:
    """Split text into chunks by double-newline paragraphs, each prefixed with breadcrumb_line."""
    paragraphs = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    if not paragraphs:
        return []

    chunks: list[str] = []
    current_paras: list[str] = []
    current_tokens = 0

    def flush() -> None:
        if current_paras:
            body = "\n\n".join(current_paras)
            chunks.append(f"{breadcrumb_line}\n{body}")

    for para in paragraphs:
        para_tokens = _token_est(para)
        if current_tokens + para_tokens > chunk_size and current_paras:
            flush()
            overlap_paras: list[str] = []
            overlap_tokens = 0
            for p in reversed(current_paras):
                t = _token_est(p)
                if overlap_tokens + t > overlap:
                    break
                overlap_paras.insert(0, p)
                overlap_tokens += t
            current_paras = overlap_paras
            current_tokens = overlap_tokens

        current_paras.append(para)
        current_tokens += para_tokens

    flush()
    return chunks if chunks else [f"{breadcrumb_line}\n{text}"]


async def chunk_document(
    parsed: dict[str, Any],
    doc_id: str,
    owner: str,
    business_line: str,
    groups: list[str] | None = None,
    source_path: str | None = None,
    source_url: str | None = None,
    version: str | None = None,
    effective_from=None,
    effective_to=None,
    acl: list[str] | None = None,
    doc_type: str | None = None,
    category: str | None = None,
    tags: list[str] | None = None,
    chunk_size: int | None = None,
    chunk_overlap: int | None = None,
) -> list[Chunk]:
    markdown: str = parsed.get("markdown", "")
    doc_title: str = parsed.get("metadata", {}).get("title", doc_id)
    updated_at = datetime.now(timezone.utc)
    product_line = list(groups) if groups else ["global"]
    chunk_acl = list(acl) if acl else ["role:public"]
    chunk_tags = list(tags) if tags else []

    sections = _parse_sections(markdown)
    # doc_chunk_* = explicit per-doc override (stored in DB, None means "use global").
    # effective_* = what actually drives the split logic.
    doc_chunk_size = chunk_size
    doc_chunk_overlap = chunk_overlap
    settings_size, settings_overlap = _get_chunk_params()
    effective_chunk_size = doc_chunk_size if doc_chunk_size is not None else settings_size
    effective_chunk_overlap = doc_chunk_overlap if doc_chunk_overlap is not None else settings_overlap

    heading_stack: list[str] = []
    all_chunks: list[Chunk] = []

    for section_idx, (level, heading_text, body) in enumerate(sections):
        if level > 0:
            stack_idx = level - 1
            heading_stack = heading_stack[:stack_idx]
            while len(heading_stack) < stack_idx:
                heading_stack.append("")
            heading_stack.append(heading_text)

        breadcrumb = _build_breadcrumb(doc_title, heading_stack)
        section_title = heading_text if heading_text else doc_title
        parent_chunk_id = f"{doc_id}#{section_idx:03d}_parent"

        if not body:
            continue

        common: dict[str, Any] = dict(
            doc_id=doc_id,
            title=section_title,
            breadcrumb=breadcrumb,
            source_url=source_url,
            product_line=product_line,
            region=["global"],
            version=version,
            effective_from=effective_from,
            effective_to=effective_to,
            acl=chunk_acl,
            doc_type=doc_type,
            category=category,
            tags=chunk_tags,
            updated_at=updated_at,
        )

        if _token_est(body) <= effective_chunk_size:
            # Small section — single retrieval chunk, no parent row needed.
            # Prefix with breadcrumb for embedding consistency with sub-chunks.
            all_chunks.append(Chunk(
                chunk_id=f"{doc_id}#{section_idx:03d}_000",
                parent_chunk_id=None,
                content=f"{breadcrumb}:\n{body}",
                chunk_index=0,
                is_parent=False,
                **common,
            ))
        else:
            # Large section — write one parent row (full body, no embedding) so
            # retrieval can expand a matched sub-chunk to its full section context.
            all_chunks.append(Chunk(
                chunk_id=parent_chunk_id,
                parent_chunk_id=None,
                content=body,
                chunk_index=-1,
                is_parent=True,
                **common,
            ))

            breadcrumb_line = breadcrumb + ":"
            sub_texts = _split_by_paragraphs(body, breadcrumb_line, effective_chunk_size, effective_chunk_overlap)
            for chunk_idx, content in enumerate(sub_texts):
                all_chunks.append(Chunk(
                    chunk_id=f"{doc_id}#{section_idx:03d}_{chunk_idx:03d}",
                    parent_chunk_id=parent_chunk_id,
                    content=content,
                    chunk_index=chunk_idx,
                    is_parent=False,
                    **common,
                ))

    logger.info(
        "Chunked doc_id=%s sections=%d total_chunks=%d (parents=%d)",
        doc_id, len(sections), len(all_chunks),
        sum(1 for c in all_chunks if c.is_parent),
    )

    # Upsert the document row so downstream indexer can update its status/score.
    if os.environ.get("PGVECTOR_DSN", ""):
        pool = await get_pool()
        await pool.execute(
            """
            INSERT INTO documents(
                doc_id, title, owner_email, business_line,
                source_type, source_path, source_url,
                version, effective_from, effective_to,
                acl, group_ids, doc_type, chunk_size, chunk_overlap,
                status, updated_at
            )
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending',now())
            ON CONFLICT (doc_id) DO UPDATE SET
                updated_at     = now(),
                status         = 'pending',
                acl            = EXCLUDED.acl,
                group_ids      = COALESCE(EXCLUDED.group_ids, documents.group_ids),
                source_path    = COALESCE(EXCLUDED.source_path, documents.source_path),
                source_url     = COALESCE(EXCLUDED.source_url, documents.source_url),
                version        = COALESCE(EXCLUDED.version, documents.version),
                effective_from = COALESCE(EXCLUDED.effective_from, documents.effective_from),
                effective_to   = COALESCE(EXCLUDED.effective_to, documents.effective_to),
                doc_type       = COALESCE(EXCLUDED.doc_type, documents.doc_type),
                chunk_size     = COALESCE(EXCLUDED.chunk_size, documents.chunk_size),
                chunk_overlap  = COALESCE(EXCLUDED.chunk_overlap, documents.chunk_overlap)
            """,
            doc_id, doc_title, owner, business_line,
            "upload", source_path, source_url,
            version, effective_from, effective_to,
            chunk_acl, product_line, doc_type, doc_chunk_size, doc_chunk_overlap,
        )

    return all_chunks
