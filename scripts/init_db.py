"""
scripts/init_db.py — Idempotent database schema initialization for Verity.

Usage:
    python scripts/init_db.py

Environment variables:
    PGVECTOR_DSN   PostgreSQL connection string
                   (default: postgresql://raguser:changeme@localhost:5432/ragdb)
    EMBEDDING_DIM  Vector dimension (default: 1536 for text-embedding-3-small;
                   set to 1024 for BGE-M3)
"""

import asyncio
import json
import os
import sys

import asyncpg


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

PGVECTOR_DSN: str = os.getenv(
    "PGVECTOR_DSN",
    "postgresql://raguser:changeme@localhost:5432/ragdb",
)

EMBEDDING_DIM: int = int(os.getenv("EMBEDDING_DIM", "1536"))

REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379")

# ---------------------------------------------------------------------------
# DDL statements
# ---------------------------------------------------------------------------

DDL_EXTENSION = "CREATE EXTENSION IF NOT EXISTS vector;"

DDL_DOCUMENTS = """
CREATE TABLE IF NOT EXISTS documents (
    doc_id          TEXT        PRIMARY KEY,
    title           TEXT        NOT NULL,
    owner_email     TEXT,
    business_line   TEXT,
    source_type     TEXT,
    source_path     TEXT,
    admission_score INT         DEFAULT 100,
    status          TEXT        DEFAULT 'active',
    version         TEXT,
    effective_from  TIMESTAMPTZ,
    effective_to    TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ DEFAULT now()
);
"""

DDL_CHUNKS = """
CREATE TABLE IF NOT EXISTS chunks (
    chunk_id        TEXT        PRIMARY KEY,
    doc_id          TEXT        NOT NULL,
    parent_chunk_id TEXT,
    parent_path     TEXT,
    title           TEXT,
    breadcrumb      TEXT,
    content         TEXT        NOT NULL,
    source_url      TEXT,
    product_line    TEXT[]      DEFAULT '{{}}',
    region          TEXT[]      DEFAULT '{{global}}',
    version         TEXT,
    effective_from  TIMESTAMPTZ,
    effective_to    TIMESTAMPTZ,
    acl             TEXT[]      DEFAULT '{{role:public}}',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    embedding       vector({dim}),
    sparse_vector   sparsevec(30522)
);
"""

# HNSW index on the embedding column for approximate nearest-neighbour search.
# Using a named index so idempotency is reliable.
DDL_IDX_EMBEDDING = """
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx
    ON chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 200);
"""

DDL_IDX_DOC_ID = """
CREATE INDEX IF NOT EXISTS chunks_doc_id_idx
    ON chunks (doc_id);
"""

DDL_IDX_EFFECTIVE_TO = """
CREATE INDEX IF NOT EXISTS chunks_effective_to_idx
    ON chunks (effective_to)
    WHERE effective_to IS NOT NULL;
"""

DDL_PROJECT_GROUPS = """
CREATE TABLE IF NOT EXISTS project_groups (
    group_id    TEXT        PRIMARY KEY,
    name        TEXT        NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);
"""

DDL_DOCUMENT_GROUPS = """
CREATE TABLE IF NOT EXISTS document_groups (
    doc_id      TEXT NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
    group_id    TEXT NOT NULL REFERENCES project_groups(group_id) ON DELETE CASCADE,
    PRIMARY KEY (doc_id, group_id)
);
"""

DDL_IDX_DOCUMENT_GROUPS = """
CREATE INDEX IF NOT EXISTS document_groups_group_id_idx ON document_groups (group_id);
"""

DDL_SESSION_LOGS = """
CREATE TABLE IF NOT EXISTS session_logs (
    id              BIGSERIAL   PRIMARY KEY,
    session_id      TEXT        NOT NULL,
    turn_id         INT         DEFAULT 0,
    uid             TEXT,
    query_raw       TEXT,
    query_rewritten TEXT,
    intent          TEXT,
    chunk_ids       TEXT[],
    prompt_version  TEXT,
    model_id        TEXT,
    output_tokens   INT,
    first_token_ms  INT,
    answer          TEXT,
    nli_flags       JSONB,
    created_at      TIMESTAMPTZ DEFAULT now()
);
"""

DDL_IDX_SESSION_ID = """
CREATE INDEX IF NOT EXISTS session_logs_session_id_idx
    ON session_logs (session_id);
"""

# ---------------------------------------------------------------------------
# Default FAQ seed for Redis
# ---------------------------------------------------------------------------

FAQ_KEY = "faq:1"
FAQ_VALUE = {
    "question": "你好",
    "answer": "您好！我是智能客服，有什么可以帮您？",
    "intent": "chitchat",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _seed_redis_faq() -> None:
    """Optionally seed a default FAQ entry into Redis.

    Silently skips if Redis is unavailable or the *redis* package is not
    installed — the FAQ seed is non-critical for the DB schema init.
    """
    try:
        import redis.asyncio as aioredis  # type: ignore
    except ImportError:
        print("[redis] redis-py not installed — skipping FAQ seed.")
        return

    try:
        r = aioredis.from_url(REDIS_URL, decode_responses=True)
        await r.set(FAQ_KEY, json.dumps(FAQ_VALUE, ensure_ascii=False))
        await r.aclose()
        print(f"[redis] Seeded {FAQ_KEY} → {FAQ_VALUE}")
    except Exception as exc:  # noqa: BLE001
        print(f"[redis] Could not connect ({exc}) — skipping FAQ seed.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


async def main() -> None:
    print("=" * 60)
    print("Verity — DB schema initialisation")
    print(f"  DSN           : {PGVECTOR_DSN}")
    print(f"  embedding_dim : {EMBEDDING_DIM}")
    print("=" * 60)

    conn = await asyncpg.connect(PGVECTOR_DSN)
    try:
        # ------------------------------------------------------------------
        # Extension
        # ------------------------------------------------------------------
        print("[pg] Creating extension vector …")
        await conn.execute(DDL_EXTENSION)
        print("[pg] Extension vector: OK")

        # ------------------------------------------------------------------
        # Tables
        # ------------------------------------------------------------------
        print("[pg] Creating table: documents …")
        await conn.execute(DDL_DOCUMENTS)
        print("[pg] Table documents: OK")

        print(f"[pg] Creating table: chunks (embedding vector({EMBEDDING_DIM})) …")
        await conn.execute(DDL_CHUNKS.format(dim=EMBEDDING_DIM))
        print("[pg] Table chunks: OK")

        print("[pg] Creating table: project_groups …")
        await conn.execute(DDL_PROJECT_GROUPS)
        print("[pg] Table project_groups: OK")

        print("[pg] Creating table: document_groups …")
        await conn.execute(DDL_DOCUMENT_GROUPS)
        print("[pg] Table document_groups: OK")

        print("[pg] Creating table: session_logs …")
        await conn.execute(DDL_SESSION_LOGS)
        print("[pg] Table session_logs: OK")

        # ------------------------------------------------------------------
        # Indexes
        # ------------------------------------------------------------------
        print("[pg] Creating HNSW index on chunks.embedding …")
        await conn.execute(DDL_IDX_EMBEDDING)
        print("[pg] Index chunks_embedding_hnsw_idx: OK")

        print("[pg] Creating index on chunks.doc_id …")
        await conn.execute(DDL_IDX_DOC_ID)
        print("[pg] Index chunks_doc_id_idx: OK")

        print("[pg] Creating partial index on chunks.effective_to …")
        await conn.execute(DDL_IDX_EFFECTIVE_TO)
        print("[pg] Index chunks_effective_to_idx: OK")

        print("[pg] Creating index on document_groups.group_id …")
        await conn.execute(DDL_IDX_DOCUMENT_GROUPS)
        print("[pg] Index document_groups_group_id_idx: OK")

        print("[pg] Creating index on session_logs.session_id …")
        await conn.execute(DDL_IDX_SESSION_ID)
        print("[pg] Index session_logs_session_id_idx: OK")

        await conn.execute("""
            INSERT INTO project_groups(group_id, name, description)
            VALUES('global', '全局共享', '所有项目组均可检索')
            ON CONFLICT (group_id) DO NOTHING
        """)
        print("[pg] Seeded default project group: global")

    finally:
        await conn.close()

    print("[pg] All schema objects created / verified.")

    # ------------------------------------------------------------------
    # Optional Redis seed
    # ------------------------------------------------------------------
    await _seed_redis_faq()

    print("=" * 60)
    print("init_db complete — database is ready.")
    print("=" * 60)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:  # noqa: BLE001
        print(f"\n[ERROR] {exc}", file=sys.stderr)
        sys.exit(1)
