from pathlib import Path
from typing import Any


async def parse_word(path: Path) -> dict[str, Any]:
    # TODO: python-docx extraction
    return {"path": str(path), "format": "docx", "markdown": ""}
