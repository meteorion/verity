from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.chat import router as chat_router
from api.pipeline import router as pipeline_router
from api.ops import router as ops_router
from db import ensure_schema
from inference.embedding import load_embedding_model
from inference import rerank as rerank_mod
from inference import nli as nli_mod
from graph.graph import build_graph
from graph.nodes.faq import load_faq_index


_graph = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _graph
    await ensure_schema()
    load_embedding_model()
    load_faq_index()
    # Rerank/NLI 是 P2 能力（见 doc/plan.md §3.3/§3.8），P1 默认关闭：
    # 不装对应依赖、不下载模型也能启动。P2 需要时把 ENABLE_RERANK/ENABLE_NLI 设为 true。
    if rerank_mod.is_enabled():
        rerank_mod.load_rerank_model()
    if nli_mod.is_enabled():
        nli_mod.load_nli_model()
    _graph = build_graph()
    app.state.graph = _graph
    yield


app = FastAPI(title="Verity", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat_router)
app.include_router(pipeline_router)
app.include_router(ops_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
