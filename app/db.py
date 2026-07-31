"""PGVector schema bootstrap.

P1 用幂等 DDL（CREATE ... IF NOT EXISTS）代替迁移框架——规模和团队都还不需要 Alembic 这类工具。
换 Embedding 模型（改变向量维度）或引入稀疏向量（P2 混合检索）时，这份 DDL 需要手动 ALTER
或删表重建，不会自动迁移。
"""
import os

import asyncpg
from pgvector.asyncpg import register_vector

_DSN = os.environ.get("PGVECTOR_DSN", "")
_EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", "384"))  # 384 = paraphrase-multilingual-MiniLM-L12-v2

_SCHEMA_SQL = f"""
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS chunks (
    chunk_id        TEXT PRIMARY KEY,
    doc_id          TEXT NOT NULL,
    parent_chunk_id TEXT,
    parent_path     TEXT,
    title           TEXT,
    breadcrumb      TEXT,
    content         TEXT NOT NULL,
    source_url      TEXT,
    product_line    TEXT[],
    region          TEXT[],
    version         TEXT,
    effective_from  TIMESTAMPTZ,
    effective_to    TIMESTAMPTZ,
    acl             TEXT[],
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    embedding       vector({_EMBEDDING_DIM})
);

CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw
    ON chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 200);
CREATE INDEX IF NOT EXISTS chunks_doc_version_idx ON chunks (doc_id, version);
"""


async def ensure_schema() -> None:
    conn = await asyncpg.connect(_DSN)
    try:
        await conn.execute(_SCHEMA_SQL)
    finally:
        await conn.close()


async def get_connection() -> asyncpg.Connection:
    conn = await asyncpg.connect(_DSN)
    await register_vector(conn)
    return conn
