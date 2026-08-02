from langgraph.graph import StateGraph, END

from graph.state import OrchestratorState
from graph.nodes.safety import safety_node
from graph.nodes.faq import faq_node
from graph.nodes.intent import intent_node
from graph.nodes.rewrite import rewrite_node
from graph.nodes.rag import rag_node
from graph.nodes.tool import tool_node
from graph.nodes.generate import generate_node
from graph.nodes.transfer import transfer_node


def _route_after_safety(state: OrchestratorState) -> str:
    if state.get("intent") == "reject":
        return END
    return "faq"


def _route_after_faq(state: OrchestratorState) -> str:
    if state.get("faq_hit"):
        return END
    return "intent"


def _route_after_intent(state: OrchestratorState) -> str:
    match state.get("intent", "rag"):
        case "transfer":
            return "transfer"
        case "tool":
            return "tool"
        case _:
            # All RAG/chitchat paths go through rewrite (normalize + cache + coref)
            return "rewrite"


def _route_after_rewrite(state: OrchestratorState) -> str:
    if state.get("cache_hit"):
        return END
    return "rag"


def build_graph(checkpointer=None):
    g = StateGraph(OrchestratorState)

    g.add_node("safety", safety_node)
    g.add_node("faq", faq_node)
    g.add_node("intent", intent_node)
    g.add_node("rewrite", rewrite_node)
    g.add_node("rag", rag_node)
    g.add_node("tool", tool_node)
    g.add_node("generate", generate_node)
    g.add_node("transfer", transfer_node)

    g.set_entry_point("safety")
    g.add_conditional_edges("safety", _route_after_safety, {"faq": "faq", END: END})
    g.add_conditional_edges("faq", _route_after_faq, {"intent": "intent", END: END})
    g.add_conditional_edges("intent", _route_after_intent)
    g.add_conditional_edges("rewrite", _route_after_rewrite, {"rag": "rag", END: END})
    g.add_edge("rag", "generate")
    g.add_edge("tool", "generate")
    g.add_edge("generate", END)
    g.add_edge("transfer", END)

    if checkpointer is None:
        from langgraph.checkpoint.memory import MemorySaver
        checkpointer = MemorySaver()
    return g.compile(checkpointer=checkpointer)
