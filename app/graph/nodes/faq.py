"""FAQ 精准匹配 — P1 用进程内索引（见 doc/plan.md §3.13），不依赖 Redis。

数据来源为本地 JSON 文件（知识运营后台后续可改为写这个文件或对应的生成脚本）。
P2 多实例化后如需跨实例共享，把 _index 的读写实现换成 Redis Hash（faq:{id}，
见 doc/arch.md §6.2）即可，faq_node 对外行为不变。
"""
import json
import os
from pathlib import Path

from graph.state import OrchestratorState

_FAQ_INDEX_PATH = Path(os.getenv("FAQ_INDEX_PATH", "/data/rag/faq/faq.json"))
_index: dict[str, dict] = {}


def load_faq_index() -> None:
    global _index
    if _FAQ_INDEX_PATH.exists():
        entries = json.loads(_FAQ_INDEX_PATH.read_text(encoding="utf-8"))
        _index = {entry["question"]: entry for entry in entries}
    else:
        _index = {}


async def faq_node(state: OrchestratorState) -> dict:
    # TODO: 归一化 + 倒排匹配（当前占位为精确匹配），延迟 ≤20ms
    hit = _index.get(state["query_raw"])
    if hit:
        return {"faq_hit": True, "answer_stream": hit["answer"]}
    return {"faq_hit": False}
