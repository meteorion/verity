"""LLM-based document structurer.

Converts raw extracted text into a normalized Markdown document with structured
metadata (title, doc_type, summary, source_url).  Uses OpenAI structured output
(function calling) instead of YAML front-matter to avoid LLM formatting errors.
"""
from typing import Literal

from pydantic import BaseModel

from inference.llm import get_llm

_STRUCTURE_PROMPT = """\
你是文档结构化专家。将以下文档整理为规范的 Markdown 格式，并提取元数据。

要求：
1. 提取并保留原始标题层级（# ## ###），补全缺失的节标题
2. 每个独立主题作为单独的二级或三级节
3. 保留所有原始内容，禁止删减或改写事实
4. title：文档标题
5. doc_type：从 FAQ / 操作手册 / 政策说明 / 合同模板 / 其他 中选一
6. summary：50 字以内摘要
7. source_url：从封面页、页眉页脚、文档内容中识别到的原始 URL；识别不到填 null
8. markdown：整理后的完整正文（不含 front-matter，纯 Markdown）

原始文档：
{raw_text}"""


class StructuredResult(BaseModel):
    title: str
    doc_type: Literal["FAQ", "操作手册", "政策说明", "合同模板", "其他"]
    summary: str
    source_url: str | None
    markdown: str


async def structure_with_llm(raw_text: str) -> StructuredResult:
    # max_tokens must be overridden — the global default (800) truncates long docs.
    llm = get_llm(max_tokens=4096, temperature=0.1)
    return await llm.with_structured_output(StructuredResult).ainvoke(
        _STRUCTURE_PROMPT.format(raw_text=raw_text)
    )
