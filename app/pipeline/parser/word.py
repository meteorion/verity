"""Word (.docx) parser using python-docx.

Converts a Word document to ATX Markdown:
- Paragraphs with a style whose name starts with "Heading" become ATX headings
  at the appropriate level (Heading 1 → #, Heading 2 → ##, etc.; level capped at 6).
- All other paragraphs become plain text blocks.
- Tables are rendered as pipe-delimited Markdown tables.

The parser is synchronous (no async).
"""

from pathlib import Path
from typing import Any
import re


# Maximum ATX heading depth
_MAX_HEADING_LEVEL = 6

# Regex to parse the level out of "Heading 1", "Heading 2", etc.
_HEADING_RE = re.compile(r'^Heading\s+(\d+)$', re.IGNORECASE)


def _heading_level(style_name: str) -> int | None:
    """Return ATX heading level (1-6) if *style_name* is a heading, else None."""
    m = _HEADING_RE.match(style_name.strip())
    if m:
        level = int(m.group(1))
        return min(level, _MAX_HEADING_LEVEL)
    return None


def _table_to_markdown(table) -> str:  # type: ignore[no-untyped-def]
    """Render a python-docx Table as a pipe-delimited Markdown table."""
    rows: list[list[str]] = []
    for row in table.rows:
        cells = [cell.text.replace("\n", " ").replace("|", "\\|").strip() for cell in row.cells]
        rows.append(cells)

    if not rows:
        return ""

    col_count = max(len(r) for r in rows)

    def pad_row(cells: list[str]) -> str:
        padded = cells + [""] * (col_count - len(cells))
        return "| " + " | ".join(padded) + " |"

    lines: list[str] = []
    lines.append(pad_row(rows[0]))
    # Separator row
    lines.append("| " + " | ".join(["---"] * col_count) + " |")
    for data_row in rows[1:]:
        lines.append(pad_row(data_row))

    return "\n".join(lines)


def parse_word(path: Path) -> dict[str, Any]:
    """Parse *path* (a .docx file) and return the standard parser output dict."""
    str_path = str(path)
    try:
        from docx import Document  # python-docx
    except ImportError:
        return {
            "path": str_path,
            "format": "word",
            "markdown": "<!-- ERROR: python-docx is not installed -->",
            "metadata": {"title": path.stem},
        }

    try:
        doc = Document(str_path)
    except Exception as exc:
        return {
            "path": str_path,
            "format": "word",
            "markdown": f"<!-- ERROR opening document: {exc} -->",
            "metadata": {"title": path.stem},
        }

    # Build a flat sequence of (kind, content) to interleave paragraphs and tables
    # python-docx exposes doc.element.body children which can be paragraph or table
    from docx.oxml.ns import qn  # type: ignore[import-untyped]
    from docx.table import Table  # type: ignore[import-untyped]
    from docx.text.paragraph import Paragraph  # type: ignore[import-untyped]

    title: str = path.stem
    first_heading_found = False
    md_parts: list[str] = []

    body_children = doc.element.body
    for child in body_children:
        tag = child.tag

        # Paragraph
        if tag == qn("w:p"):
            para = Paragraph(child, doc)
            text = para.text.strip()
            if not text:
                continue
            style_name: str = para.style.name if para.style else ""
            level = _heading_level(style_name)
            if level is not None:
                if not first_heading_found:
                    title = text
                    first_heading_found = True
                md_parts.append(f"{'#' * level} {text}")
            else:
                md_parts.append(text)

        # Table
        elif tag == qn("w:tbl"):
            tbl = Table(child, doc)
            table_md = _table_to_markdown(tbl)
            if table_md:
                md_parts.append(table_md)

    # Join with double newlines so each block is separated by a blank line
    markdown = "\n\n".join(md_parts)

    return {
        "path": str_path,
        "format": "word",
        "markdown": markdown,
        "metadata": {"title": title},
    }
