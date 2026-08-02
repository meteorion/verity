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

-- Documents: source of truth for all knowledge-base documents.
-- group_ids replaces the old document_groups junction table.
CREATE TABLE IF NOT EXISTS documents (
    doc_id          TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    owner_email     TEXT,
    business_line   TEXT,
    source_type     TEXT DEFAULT 'upload',
    source_path     TEXT,
    source_url      TEXT DEFAULT '',
    admission_score INT DEFAULT 100,
    status          TEXT DEFAULT 'pending',
    version         TEXT,
    effective_from  TIMESTAMPTZ,
    effective_to    TIMESTAMPTZ,
    acl             TEXT[] DEFAULT '{{role:public}}',
    group_ids       TEXT[] DEFAULT '{{global}}',
    doc_type        TEXT,
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_groups (
    group_id    TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
    chunk_id        TEXT PRIMARY KEY,
    doc_id          TEXT NOT NULL,
    parent_chunk_id TEXT,
    title           TEXT,
    breadcrumb      TEXT,
    content         TEXT NOT NULL,
    source_url      TEXT,
    product_line    TEXT[] DEFAULT '{{}}',
    region          TEXT[] DEFAULT '{{global}}',
    version         TEXT,
    effective_from  TIMESTAMPTZ,
    effective_to    TIMESTAMPTZ,
    acl             TEXT[] DEFAULT '{{role:public}}',
    doc_type        TEXT,
    category        TEXT,
    tags            TEXT[] DEFAULT '{{}}',
    chunk_index     INT DEFAULT 0,
    is_parent       BOOL DEFAULT FALSE,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    embedding       vector({_EMBEDDING_DIM}),
    sparse_vector   sparsevec(30522)
);

CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw
    ON chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 200);
CREATE INDEX IF NOT EXISTS chunks_doc_version_idx ON chunks (doc_id, version);

-- Question augmentation index: LLM-generated alternative phrasings per chunk.
-- Generated on demand from the admin UI (not auto-generated at ingest time).
CREATE TABLE IF NOT EXISTS question_embeddings (
    id         BIGSERIAL PRIMARY KEY,
    chunk_id   TEXT NOT NULL REFERENCES chunks(chunk_id) ON DELETE CASCADE,
    question   TEXT NOT NULL,
    embedding  vector({_EMBEDDING_DIM}),
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS question_embeddings_hnsw
    ON question_embeddings USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 200);
CREATE INDEX IF NOT EXISTS question_embeddings_chunk_idx ON question_embeddings (chunk_id);

-- Evaluation tables
CREATE TABLE IF NOT EXISTS eval_datasets (
    dataset_id   TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT DEFAULT '',
    source_type  TEXT NOT NULL DEFAULT 'manual',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ragas-standard dataset items: question + ground_truth
-- (answer and contexts are produced at eval time, not stored here)
CREATE TABLE IF NOT EXISTS eval_dataset_items (
    item_id      TEXT PRIMARY KEY,
    dataset_id   TEXT NOT NULL REFERENCES eval_datasets(dataset_id) ON DELETE CASCADE,
    question     TEXT NOT NULL,
    ground_truth TEXT DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_eval_items_dataset ON eval_dataset_items(dataset_id);

-- Ragas-standard eval records: stores full RAG pipeline output
CREATE TABLE IF NOT EXISTS eval_records (
    record_id            TEXT PRIMARY KEY,
    dataset_id           TEXT NOT NULL,
    item_id              TEXT,
    batch_record_id      TEXT,
    run_type             TEXT NOT NULL DEFAULT 'single',
    question             TEXT NOT NULL,
    answer               TEXT DEFAULT '',
    contexts             TEXT[] DEFAULT '{{}}',
    ground_truth         TEXT DEFAULT '',
    retrieved_chunk_ids  TEXT[] DEFAULT '{{}}',
    top_k                INT DEFAULT 5,
    latency_ms           INT DEFAULT 0,
    ragas_metrics        JSONB DEFAULT '{{}}',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_eval_records_dataset ON eval_records(dataset_id);
CREATE INDEX IF NOT EXISTS idx_eval_records_item ON eval_records(item_id);
CREATE INDEX IF NOT EXISTS idx_eval_records_batch ON eval_records(batch_record_id);

CREATE TABLE IF NOT EXISTS eval_batch_runs (
    batch_record_id   TEXT PRIMARY KEY,
    dataset_id        TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'running',
    total_items       INT DEFAULT 0,
    completed_items   INT DEFAULT 0,
    error_msg         TEXT DEFAULT '',
    aggregate_metrics JSONB DEFAULT '{{}}',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at      TIMESTAMPTZ
);

ALTER TABLE eval_records ADD COLUMN IF NOT EXISTS retrieval_ms INT DEFAULT 0;

-- Ticket tables
CREATE TABLE IF NOT EXISTS tickets (
    ticket_id    TEXT PRIMARY KEY,
    ticket_type  TEXT NOT NULL,
    session_id   TEXT,
    status       TEXT NOT NULL DEFAULT 'open',
    fields       JSONB NOT NULL DEFAULT '{{}}',
    contact      TEXT,
    assignee_id  TEXT,
    assigned_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now(),
    resolved_at  TIMESTAMPTZ,
    closed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS tickets_status_created_idx ON tickets (status, created_at);
CREATE INDEX IF NOT EXISTS tickets_assignee_status_idx ON tickets (assignee_id, status);

CREATE TABLE IF NOT EXISTS notification_logs (
    id          BIGSERIAL PRIMARY KEY,
    ticket_id   TEXT NOT NULL,
    handler_id  TEXT NOT NULL,
    notify_type TEXT NOT NULL,
    channel     TEXT NOT NULL,
    status      TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_logs_ticket_handler_idx
    ON notification_logs (ticket_id, handler_id, notify_type);

-- Column migrations for existing installs.
-- Wrapped in DO blocks so that references to old column names (ground_truth_answer,
-- query, retrieved_contexts) are silently skipped on fresh installs where those
-- columns never existed; existing installs get the data copied as before.
ALTER TABLE eval_dataset_items ADD COLUMN IF NOT EXISTS ground_truth TEXT DEFAULT '';
DO $$
BEGIN
    UPDATE eval_dataset_items SET ground_truth = ground_truth_answer
        WHERE ground_truth = '' AND ground_truth_answer IS NOT NULL AND ground_truth_answer != '';
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

ALTER TABLE eval_records ADD COLUMN IF NOT EXISTS question TEXT;
DO $$
BEGIN
    UPDATE eval_records SET question = query WHERE question IS NULL;
EXCEPTION WHEN undefined_column THEN NULL;
END $$;
ALTER TABLE eval_records ALTER COLUMN question SET DEFAULT '';
ALTER TABLE eval_records ADD COLUMN IF NOT EXISTS answer TEXT DEFAULT '';
ALTER TABLE eval_records ADD COLUMN IF NOT EXISTS contexts TEXT[] DEFAULT '{{}}';
DO $$
BEGIN
    UPDATE eval_records SET contexts = retrieved_contexts
        WHERE contexts = '{{}}' AND retrieved_contexts != '{{}}';
EXCEPTION WHEN undefined_column THEN NULL;
END $$;
ALTER TABLE eval_records ADD COLUMN IF NOT EXISTS ground_truth TEXT DEFAULT '';
DO $$
BEGIN
    ALTER TABLE eval_records ALTER COLUMN query DROP NOT NULL;
    ALTER TABLE eval_records ALTER COLUMN query SET DEFAULT '';
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_url TEXT DEFAULT '';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS group_ids TEXT[] DEFAULT '{{global}}';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS doc_type TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS acl TEXT[] DEFAULT '{{role:public}}';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS chunk_size INT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS chunk_overlap INT;

-- Migrate existing document_groups data into documents.group_ids for installs
-- that still have the old junction table.
DO $$
BEGIN
    UPDATE documents d
    SET group_ids = sub.gids
    FROM (
        SELECT doc_id, ARRAY_AGG(group_id) AS gids
        FROM document_groups
        GROUP BY doc_id
    ) sub
    WHERE sub.doc_id = d.doc_id
      AND (d.group_ids IS NULL OR d.group_ids = '{{global}}');
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

ALTER TABLE chunks ADD COLUMN IF NOT EXISTS doc_type TEXT;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{{}}';
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS chunk_index INT DEFAULT 0;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS is_parent BOOL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS chunks_is_parent_idx ON chunks (is_parent) WHERE is_parent = FALSE;
DO $$
BEGIN
    ALTER TABLE chunks ADD COLUMN sparse_vector sparsevec(30522);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$
BEGIN
    ALTER TABLE chunks DROP COLUMN parent_path;
EXCEPTION WHEN undefined_column THEN NULL;
END $$;
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


# ---------------------------------------------------------------------------
# Shared connection pool
#
# One process-wide asyncpg pool, created lazily on first use (bound to the
# running event loop) and closed on app shutdown. All request handlers should
# acquire from this pool instead of opening a fresh connection per call —
# a new connect() per request pays a full TCP+auth handshake and can exhaust
# Postgres max_connections under load. Callers that need pgvector codecs call
# register_vector() on the acquired connection themselves (it persists for the
# pooled connection's lifetime).
# ---------------------------------------------------------------------------

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(_DSN, min_size=2, max_size=10)
        async with _pool.acquire() as conn:
            await conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
