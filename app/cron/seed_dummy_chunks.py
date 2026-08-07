"""手动灌几条 dummy chunk，用于在知识管道（pipeline/*）写完之前先验证问答链路能不能跑通。

用法（容器内）：
    docker compose exec app python cron/seed_dummy_chunks.py
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from inference.embedding import embed, load_embedding_model  # noqa: E402
from pipeline.indexer import index_chunks  # noqa: E402
from pipeline.models import Chunk  # noqa: E402

_DUMMY_CHUNKS = [
    {
        "chunk_id": "dummy_001#c01",
        "doc_id": "dummy_001",
        "title": "生鲜商品退换货政策",
        "breadcrumb": "售后手册 > 退换货 > 生鲜类目",
        "content": "生鲜商品若存在质量问题（腐坏、变质），支持签收后 24 小时内申请仅退款，需上传商品照片作为凭证。",
    },
    {
        "chunk_id": "dummy_002#c01",
        "doc_id": "dummy_002",
        "title": "普通商品退换货政策",
        "breadcrumb": "售后手册 > 退换货 > 普通类目",
        "content": "普通商品支持签收后 7 天无理由退货，商品需保持包装完好、不影响二次销售。",
    },
    {
        "chunk_id": "dummy_003#c01",
        "doc_id": "dummy_003",
        "title": "退款到账时间说明",
        "breadcrumb": "售后手册 > 退款",
        "content": "退款审核通过后，原路退回一般 1~3 个工作日到账，具体以支付渠道为准。",
    },
]


async def main() -> None:
    load_embedding_model()
    vecs = embed([c["content"] for c in _DUMMY_CHUNKS], mode="dense")
    chunks = [Chunk(**c, embedding=v.dense) for c, v in zip(_DUMMY_CHUNKS, vecs)]
    await index_chunks(chunks)
    print(f"写入 {len(chunks)} 条 dummy chunk")


if __name__ == "__main__":
    asyncio.run(main())
