import logging
import os
from contextlib import asynccontextmanager

import asyncpg
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.auth import router as auth_router, require_admin
from db import close_pool
from api.chat import router as chat_router
from api.debug import router as debug_router
from api.pipeline import router as pipeline_router
from api.ops import router as ops_router
from api.sessions import router as sessions_router
from inference.embedding import load_embedding_model
from inference.rerank import load_rerank_model
from inference.nli import load_nli_model
from graph.graph import build_graph

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

_graph = None


async def _run_migrations():
    dsn = os.environ.get("PGVECTOR_DSN", "")
    if not dsn:
        return
    try:
        conn = await asyncpg.connect(dsn)
        try:
            await conn.execute(
                "ALTER TABLE documents ADD COLUMN IF NOT EXISTS"
                " acl text[] DEFAULT '{role:public}'"
            )
            await conn.execute(
                """CREATE TABLE IF NOT EXISTS prompt_versions (
                    version    TEXT PRIMARY KEY,
                    content    TEXT NOT NULL,
                    note       TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    is_active  BOOLEAN NOT NULL DEFAULT FALSE
                )"""
            )
            count = await conn.fetchval("SELECT COUNT(*) FROM prompt_versions")
            if count == 0:
                from pathlib import Path
                prompt_path = Path(os.getenv("SYSTEM_PROMPT_PATH", "/app/prompts/system_prompt.txt"))
                try:
                    content = prompt_path.read_text(encoding="utf-8").strip()
                except FileNotFoundError:
                    content = "你是智能客服助手，依据 <知识> 回答问题，每条事实后标注 [序号]。"
                await conn.execute(
                    "INSERT INTO prompt_versions(version, content, note, is_active)"
                    " VALUES($1, $2, $3, TRUE)",
                    "v1.0.0", content, "初始版本",
                )
                logger.info("Seeded initial prompt version v1.0.0 from %s", prompt_path)
            logger.info("DB migration: prompt_versions table ensured")
        finally:
            await conn.close()
    except Exception:
        logger.exception("DB migration failed (non-fatal)")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _graph
    await _run_migrations()
    # load_*_model() are no-ops when provider != "local"; fast in API mode
    logger.info("Loading inference models …")
    load_embedding_model()
    load_rerank_model()
    load_nli_model()
    logger.info("Building LangGraph orchestration graph …")
    _graph = build_graph()
    app.state.graph = _graph
    logger.info("Startup complete — graph ready")
    yield
    # Shutdown: release the shared DB pool so connections don't leak on reload.
    await close_pool()


app = FastAPI(title="Verity", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(chat_router)
# Admin-console + ingestion + debug routers expose destructive / sensitive
# operations (doc delete, ACL rewrite, prompt swap, raw chunk content) and must
# sit behind an authenticated admin token — never mount them unguarded.
_admin = [Depends(require_admin)]
app.include_router(debug_router, dependencies=_admin)
app.include_router(pipeline_router, dependencies=_admin)
app.include_router(ops_router, dependencies=_admin)
app.include_router(sessions_router, dependencies=_admin)


@app.get("/health")
async def health():
    return {"status": "ok"}
