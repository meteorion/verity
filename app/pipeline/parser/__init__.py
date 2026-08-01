"""Parser dispatcher.

Routes an uploaded document to the correct parser based on file suffix:
  .pdf            → parse_pdf   (PyMuPDF / fitz)
  .docx / .doc    → parse_word  (python-docx)
  .md / .markdown → parse_markdown
  .txt            → parse_markdown

Each individual parser is synchronous; this dispatcher is async to match the
calling convention used by api/pipeline.py (``await parse_document(path)``).
"""

from pathlib import Path
from typing import Any

from pipeline.cleaner import clean_markdown


async def parse_document(path: Path) -> dict[str, Any]:
    """Dispatch *path* to the appropriate parser and return its output dict.

    Returns a dict conforming to the parser output schema:
      {
        path: str,
        format: "pdf" | "word" | "markdown",
        markdown: str,
        metadata: { title: str },
      }

    Raises:
        ValueError: if the file suffix is not supported.
    """
    suffix = path.suffix.lower()

    if suffix == ".pdf":
        from .pdf import parse_pdf
        result = parse_pdf(path)
    elif suffix in (".docx", ".doc"):
        from .word import parse_word
        result = parse_word(path)
    elif suffix in (".md", ".markdown", ".txt"):
        from .markdown import parse_markdown
        result = parse_markdown(path)
    else:
        raise ValueError(
            f"Unsupported file type: {suffix!r}. "
            "Supported types: .pdf, .docx, .doc, .md, .markdown, .txt"
        )

    result["markdown"] = clean_markdown(result["markdown"])
    return result
