"""Markdown / plain-text parser.

- .md / .markdown: read as-is (already valid Markdown).
- .txt: read as plain text; no heading detection; content becomes a plain
  paragraph block (no ATX headings are injected).

Title extraction for .md: first ATX heading (# ...) found in the file.
Title extraction for .txt / fallback: filename stem.

The parser is synchronous (no async).
"""

import logging
from pathlib import Path
from typing import Any
import re

logger = logging.getLogger(__name__)

_ATX_HEADING_RE = re.compile(r'^#{1,6}\s+(.*)', re.MULTILINE)

# Tried in order with strict decoding; the first that decodes without raising
# wins. utf-8-sig handles BOM'd UTF-8 (common on Windows); gb18030 covers
# GBK/GB2312 Chinese; big5 covers traditional Chinese. latin-1 is deliberately
# NOT in this list because it decodes ANY byte sequence and would silently
# mojibake non-UTF-8 Chinese text — it is only used as an explicit last resort.
_TEXT_ENCODINGS = ("utf-8-sig", "gb18030", "big5")


def _read_text_best_effort(path: Path) -> str:
    for enc in _TEXT_ENCODINGS:
        try:
            return path.read_text(encoding=enc)
        except UnicodeDecodeError:
            continue
    logger.warning(
        "Could not decode %s as any of %s; falling back to latin-1 — text may be garbled",
        path, _TEXT_ENCODINGS,
    )
    return path.read_text(encoding="latin-1")


def _extract_title_from_markdown(text: str, fallback: str) -> str:
    """Return the text of the first ATX heading, or *fallback* if none found."""
    m = _ATX_HEADING_RE.search(text)
    if m:
        return m.group(1).strip()
    return fallback


def parse_markdown(path: Path) -> dict[str, Any]:
    """Parse *path* (.md or .txt) and return the standard parser output dict."""
    str_path = str(path)
    suffix = path.suffix.lower()

    try:
        raw_text = _read_text_best_effort(path)
    except Exception as exc:
        return {
            "path": str_path,
            "format": "markdown",
            "markdown": f"<!-- ERROR reading file: {exc} -->",
            "metadata": {"title": path.stem},
        }

    if suffix in (".md", ".markdown"):
        markdown = raw_text
        title = _extract_title_from_markdown(raw_text, path.stem)
    else:
        # Plain text: wrap as a paragraph block (no heading conversion)
        markdown = raw_text
        title = path.stem

    return {
        "path": str_path,
        "format": "markdown",
        "markdown": markdown,
        "metadata": {"title": title},
    }
