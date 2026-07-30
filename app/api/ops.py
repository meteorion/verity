from fastapi import APIRouter

router = APIRouter(prefix="/api/ops")


@router.get("/documents")
async def list_documents():
    # TODO: query PostgreSQL documents table
    return {"documents": []}


@router.post("/documents/{doc_id}/disable")
async def disable_document(doc_id: str):
    # TODO: set status=rejected in documents table, clear related cache
    return {"doc_id": doc_id, "status": "disabled"}


@router.get("/metrics")
async def metrics():
    # TODO: return knowledge base health metrics
    return {"chunk_count": 0, "doc_count": 0, "cache_hit_rate": 0.0}
