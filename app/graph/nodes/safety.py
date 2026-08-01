import logging
import os

from graph.state import OrchestratorState

logger = logging.getLogger(__name__)

_DEFAULT_BLOCKED = ["fuck", "shit", "傻逼", "操你", "垃圾服务", "去死", "骗子"]


def _load_blocked_words() -> list[str]:
    env_val = os.getenv("SAFETY_BLOCKED_WORDS", "")
    if env_val.strip():
        return [w.strip() for w in env_val.split(",") if w.strip()]
    return _DEFAULT_BLOCKED


async def safety_node(state: OrchestratorState) -> dict:
    blocked_words = _load_blocked_words()
    query_lower = state["query_raw"].lower()

    for word in blocked_words:
        if word.lower() in query_lower:
            logger.warning(
                "Query blocked [session=%s uid=%s matched=%r]",
                state.get("session_id"), state.get("uid"), word,
            )
            return {
                "answer_stream": "很抱歉，您的问题包含不当内容，无法回答。如需帮助请联系人工客服。",
                "intent": "reject",
            }

    return {}
