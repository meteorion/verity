from graph.state import OrchestratorState


async def transfer_node(state: OrchestratorState) -> dict:
    # TODO: push session summary to ticketing/IM system
    return {
        "answer_stream": "正在为您转接人工客服，请稍候...",
        "transfer_reason": state.get("transfer_reason", "user_request"),
    }
