from graph.state import OrchestratorState


async def faq_node(state: OrchestratorState) -> dict:
    # TODO: inverted index lookup in Redis, ≤20ms
    return {"faq_hit": False}
