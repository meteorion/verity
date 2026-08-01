"""Post-parse Markdown cleaning.

Runs after the format-specific parser and before the chunker.
Input/output: plain Markdown string.

Cleaning steps (in order):
  1. Unicode NFC normalization
  2. Whitespace variant normalization (NBSP, ZWSP, BOM, CRLF)
  3. Control-character stripping (keeps \\n and \\t)
  4. Page-number / header / footer line removal
  5. Trailing whitespace per line
  6. Excessive blank-line collapse (3+ → 1 blank line)
  7. Repeated-paragraph deduplication (boilerplate appearing ≥3 times)
"""

import re
import unicodedata
from collections import Counter

# Typical PDF page-number / running-header noise patterns
_PAGE_NOISE_RE = re.compile(
    r'(?m)^[ \t]*('
    r'第\s*\d+\s*[页面]'            # 第 3 页 / 第3面
    r'|Page\s+\d+(\s+of\s+\d+)?'   # Page 3 / Page 3 of 10
    r'|\d+\s*/\s*\d+'               # 3 / 10
    r'|[-–—]\s*\d+\s*[-–—]'        # — 3 —
    r')[ \t]*$',
    re.IGNORECASE,
)

_CONTROL_RE = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')
_MULTI_BLANK_RE = re.compile(r'\n{3,}')


def clean_markdown(text: str) -> str:
    # 1. Unicode NFC
    text = unicodedata.normalize('NFC', text)

    # 2. Whitespace variants
    text = (
        text
        .replace(' ', ' ')   # non-breaking space
        .replace('​', '')    # zero-width space
        .replace('﻿', '')    # BOM
        .replace('\r\n', '\n')
        .replace('\r', '\n')
    )

    # 3. Control characters
    text = _CONTROL_RE.sub('', text)

    # 4. Page-number / header / footer lines
    text = _PAGE_NOISE_RE.sub('', text)

    # 5. Trailing whitespace per line
    text = '\n'.join(line.rstrip() for line in text.splitlines())

    # 6. Collapse 3+ blank lines → one blank line
    text = _MULTI_BLANK_RE.sub('\n\n', text)

    # 7. Deduplicate repeated boilerplate paragraphs
    text = _dedup_paragraphs(text)

    return text.strip()


def _dedup_paragraphs(text: str) -> str:
    """Drop non-heading paragraphs that repeat 3 or more times (running headers/footers)."""
    blocks = re.split(r'\n{2,}', text)
    counts = Counter(b.strip() for b in blocks if b.strip())

    seen: set[str] = set()
    result: list[str] = []
    for block in blocks:
        key = block.strip()
        if not key:
            result.append(block)
            continue
        # Always keep headings and unique/rare paragraphs
        if key.startswith('#') or counts[key] < 3:
            result.append(block)
        else:
            # Repeated boilerplate: keep only the first occurrence
            if key not in seen:
                result.append(block)
                seen.add(key)

    return '\n\n'.join(result)
