from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.chat import router as chat_router
from api.pipeline import router as pipeline_router
from api.ops import router as ops_router
from inference.embedding import load_embedding_model
from inference.rerank import load_rerank_model
from inference.nli import load_nli_model
from graph.graph import build_graph


_graph = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _graph
    load_embedding_model()
    load_rerank_model()
    load_nli_model()
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
