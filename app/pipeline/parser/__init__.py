from pathlib import Path
from typing import Any


async def parse_document(path: Path) -> dict[str, Any]:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        from .pdf import parse_pdf
        return await parse_pdf(path)
    elif suffix in (".docx", ".doc"):
        from .word import parse_word
        return await parse_word(path)
    elif suffix in (".md", ".markdown"):
        from .markdown import parse_markdown
        return await parse_markdown(path)
    else:
        raise ValueError(f"Unsupported file type: {suffix}")
