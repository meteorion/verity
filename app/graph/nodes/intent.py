from graph.state import OrchestratorState


async def intent_node(state: OrchestratorState) -> dict:
    # TODO: FastText classifier + coreference-based query rewrite
    return {"intent": "rag", "query_rewritten": state["query_raw"]}
