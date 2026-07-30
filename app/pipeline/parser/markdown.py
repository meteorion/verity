from pathlib import Path
from typing import Any


async def parse_markdown(path: Path) -> dict[str, Any]:
    return {"path": str(path), "format": "markdown", "markdown": path.read_text(encoding="utf-8")}
