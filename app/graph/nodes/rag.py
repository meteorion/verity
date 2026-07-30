from graph.state import OrchestratorState
from retrieval.hybrid import hybrid_retrieve
from retrieval.small_to_big import expand_to_parent


async def rag_node(state: OrchestratorState) -> dict:
    query = state.get("query_rewritten") or state["query_raw"]
    chunks = await hybrid_retrieve(
        query=query,
        roles=state["roles"],
        region=state["region"],
    )
    chunks = await expand_to_parent(chunks)
    return {"retrieved_chunks": chunks}
