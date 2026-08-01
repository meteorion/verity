"""PDF parser using PyMuPDF (fitz) — fast-validation implementation.

Converts a PDF to clean ATX Markdown by heuristically detecting headings:
- Short lines (<=80 chars) that are ALL-CAPS, or whose ratio of uppercase chars
  is high, are treated as section headings (## level).
- Very short lines that look like a document title on page 0 become the title.
- All other text becomes normal paragraph blocks separated by blank lines.

No heavy dependencies (Marker, PaddleOCR) are used.
"""

from pathlib import Path
from typing import Any
import re


# ---------------------------------------------------------------------------
# Heuristic thresholds
# ---------------------------------------------------------------------------
_MAX_HEADING_LEN = 120       # lines longer than this are never headings
_MIN_HEADING_UPPER_RATIO = 0.6  # fraction of alpha chars that must be upper
_MIN_HEADING_WORDS = 1
_MAX_HEADING_WORDS = 12


def _looks_like_heading(line: str) -> bool:
    """Return True when a text line is likely a section heading."""
    stripped = line.strip()
    if not stripped:
        return False
    if len(stripped) > _MAX_HEADING_LEN:
        return False
    words = stripped.split()
    if len(words) < _MIN_HEADING_WORDS or len(words) > _MAX_HEADING_WORDS:
        return False
    alpha_chars = [c for c in stripped if c.isalpha()]
    if not alpha_chars:
        return False
    upper_ratio = sum(1 for c in alpha_chars if c.isupper()) / len(alpha_chars)
    # ALL-CAPS line or high uppercase ratio → heading
    if upper_ratio >= _MIN_HEADING_UPPER_RATIO:
        return True
    # Lines that start with a numbering pattern like "1.", "1.2", "A." → heading
    if re.match(r'^(\d+\.)+\s+\S|^[A-Z]\.\s+\S', stripped):
        return True
    return False


def _page_to_markdown(page_text: str) -> list[str]:
    """Convert a single page's raw text into a list of Markdown lines."""
    raw_lines = page_text.splitlines()
    md_lines: list[str] = []
    prev_blank = True  # start as if preceded by a blank line

    for raw_line in raw_lines:
        line = raw_line.rstrip()
        if not line.strip():
            if not prev_blank:
                md_lines.append("")
                prev_blank = True
            continue
        if _looks_like_heading(line):
            if not prev_blank:
                md_lines.append("")
            md_lines.append(f"## {line.strip()}")
            md_lines.append("")
            prev_blank = True
        else:
            md_lines.append(line)
            prev_blank = False

    return md_lines


def parse_pdf(path: Path) -> dict[str, Any]:
    """Parse *path* (a PDF file) and return the standard parser output dict."""
    str_path = str(path)
    try:
        import fitz  # PyMuPDF
    except ImportError:
        return {
            "path": str_path,
            "format": "pdf",
            "markdown": "<!-- ERROR: PyMuPDF (fitz) is not installed -->",
            "metadata": {"title": path.stem},
        }

    try:
        doc = fitz.open(str_path)
    except Exception as exc:
        return {
            "path": str_path,
            "format": "pdf",
            "markdown": f"<!-- ERROR opening PDF: {exc} -->",
            "metadata": {"title": path.stem},
        }

    all_md_lines: list[str] = []
    title: str = path.stem

    try:
        for page_index, page in enumerate(doc):
            try:
                page_text: str = page.get_text("text")  # type: ignore[attr-defined]
            except Exception:
                page_text = ""

            if page_index == 0 and page_text.strip():
                # Title = first non-empty line on page 0
                for raw_line in page_text.splitlines():
                    stripped = raw_line.strip()
                    if stripped:
                        title = stripped
                        break

            page_md = _page_to_markdown(page_text)
            if page_md:
                all_md_lines.extend(page_md)
                # Ensure pages are separated by a blank line
                if all_md_lines and all_md_lines[-1] != "":
                    all_md_lines.append("")
    finally:
        doc.close()

    # Collapse runs of more than one consecutive blank line
    markdown = _collapse_blank_lines("\n".join(all_md_lines))

    return {
        "path": str_path,
        "format": "pdf",
        "markdown": markdown,
        "metadata": {"title": title},
    }


def _collapse_blank_lines(text: str) -> str:
    """Replace 3+ consecutive newlines with exactly two (one blank line)."""
    return re.sub(r'\n{3,}', '\n\n', text).strip()
