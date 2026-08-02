"""Hierarchical chunker: heading-aware split + breadcrumb injection + Small-to-Big parent storage."""
import logging
import os
import re
from pathlib import Path
from datetime import datetime, timezone
from typing import Any

from db import get_pool

logger = logging.getLogger(__name__)

_STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "/data/rag"))
_CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "600"))
_CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "80"))


def _get_chunk_params() -> tuple[int, int]:
    try:
        from api.settings import load_settings
        s = load_settings()
        size = int(s.get("chunk_size") or _CHUNK_SIZE)
        overlap = int(s.get("chunk_overlap") or _CHUNK_OVERLAP)
        return size, overlap
    except Exception:
        return _CHUNK_SIZE, _CHUNK_OVERLAP
_HEADING_RE = re.compile(r"^(#{1,4})\s+(.+)", re.MULTILINE)


def _token_est(text: str) -> int:
    return len(text) // 3


def _parse_sections(markdown: str) -> list[tuple[int, str, str]]:
    """Return list of (heading_level, heading_text, body_text) tuples."""
    matches = list(_HEADING_RE.finditer(markdown))
    if not matches:
        return [(0, "", markdown.strip())]

    sections: list[tuple[int, str, str]] = []

    # Text before first heading
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
        # If adding this paragraph exceeds the limit and we already have content, flush first
        if current_tokens + para_tokens > chunk_size and current_paras:
            flush()
            # Overlap: keep last overlap-worth of tokens from previous paragraphs
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
) -> list[dict[str, Any]]:
    markdown: str = parsed.get("markdown", "")
    doc_title: str = parsed.get("metadata", {}).get("title", doc_id)
    updated_at = datetime.now(timezone.utc)
    product_line = list(groups) if groups else ["global"]
    chunk_acl = list(acl) if acl else ["role:public"]

    sections = _parse_sections(markdown)
    chunk_size, chunk_overlap = _get_chunk_params()

    # heading_stack[0] = H1, heading_stack[1] = H2, heading_stack[2] = H3, heading_stack[3] = H4
    heading_stack: list[str] = []
    all_chunks: list[dict[str, Any]] = []

    chunk_dir = _STORAGE_ROOT / "chunks" / doc_id
    chunk_dir.mkdir(parents=True, exist_ok=True)

    for section_idx, (level, heading_text, body) in enumerate(sections):
        # Maintain heading stack
        if level == 0:
            # preamble — don't alter stack
            pass
        else:
            # level is 1-based; stack is 0-based list of H1..H4 texts
            stack_idx = level - 1
            # Trim deeper headings
            heading_stack = heading_stack[:stack_idx]
            # Pad if needed (shouldn't happen in well-formed docs)
            while len(heading_stack) < stack_idx:
                heading_stack.append("")
            heading_stack.append(heading_text)

        breadcrumb = _build_breadcrumb(doc_title, heading_stack)
        section_title = heading_text if heading_text else doc_title
        parent_chunk_id = f"{doc_id}#{section_idx:03d}_parent"

        if not body:
            continue

        if _token_est(body) <= chunk_size:
            # Single chunk — content is the body itself (no split)
            chunk_id = f"{doc_id}#{section_idx:03d}_000"
            all_chunks.append(
                {
                    "chunk_id": chunk_id,
                    "doc_id": doc_id,
                    "parent_chunk_id": parent_chunk_id,
                    "parent_path": None,
                    "title": section_title,
                    "breadcrumb": breadcrumb,
                    "content": body,
                    "source_url": source_url,
                    "product_line": product_line,
                    "region": ["global"],
                    "version": version,
                    "effective_from": effective_from,
                    "effective_to": effective_to,
                    "acl": chunk_acl,
                    "updated_at": updated_at,
                }
            )
        else:
            # Write parent chunk to FS
            parent_path = chunk_dir / f"{parent_chunk_id}.txt"
            parent_path.write_text(body, encoding="utf-8")

            breadcrumb_line = breadcrumb + ":"
            sub_texts = _split_by_paragraphs(body, breadcrumb_line, chunk_size, chunk_overlap)

            first_chunk_id: str | None = None
            for chunk_idx, content in enumerate(sub_texts):
                chunk_id = f"{doc_id}#{section_idx:03d}_{chunk_idx:03d}"
                if first_chunk_id is None:
                    first_chunk_id = chunk_id

                all_chunks.append(
                    {
                        "chunk_id": chunk_id,
                        "doc_id": doc_id,
                        "parent_chunk_id": parent_chunk_id,
                        "parent_path": str(parent_path),
                        "title": section_title,
                        "breadcrumb": breadcrumb,
                        "content": content,
                        "source_url": source_url,
                        "product_line": product_line,
                        "region": ["global"],
                        "version": version,
                        "effective_from": effective_from,
                        "effective_to": effective_to,
                        "acl": chunk_acl,
                        "updated_at": updated_at,
                    }
                )

    logger.info(
        "Chunked doc_id=%s sections=%d chunks=%d",
        doc_id, len(sections), len(all_chunks),
    )

    # Upsert into documents table
    if os.environ.get("PGVECTOR_DSN", ""):
        pool = await get_pool()
        await pool.execute(
            """
            INSERT INTO documents(
                doc_id, title, owner_email, business_line,
                source_type, source_path,
                version, effective_from, effective_to,
                acl, status, updated_at
            )
            VALUES($1, $2, $3, $4, 'upload', $5, $6, $7, $8, $9, 'pending', now())
            ON CONFLICT (doc_id) DO UPDATE SET
                updated_at     = now(),
                status         = 'pending',
                acl            = EXCLUDED.acl,
                source_path    = COALESCE(EXCLUDED.source_path, documents.source_path),
                version        = COALESCE(EXCLUDED.version, documents.version),
                effective_from = COALESCE(EXCLUDED.effective_from, documents.effective_from),
                effective_to   = COALESCE(EXCLUDED.effective_to, documents.effective_to)
            """,
            doc_id, doc_title, owner, business_line,
            source_path, version, effective_from, effective_to, chunk_acl,
        )

    return all_chunks
