from pathlib import Path
from typing import Any


async def parse_pdf(path: Path) -> dict[str, Any]:
    # TODO: Marker for text PDFs; PaddleOCR fallback for scanned pages
    return {"path": str(path), "format": "pdf", "markdown": ""}
