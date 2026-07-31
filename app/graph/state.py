from typing_extensions import TypedDict


class OrchestratorState(TypedDict):
    session_id:       str
    uid:              str | None
    roles:            list[str]
    region:           str
    query_raw:        str
    query_rewritten:  str | None
    blocked:          bool
    intent:           str | None
    faq_hit:          bool
    retrieved_chunks: list[dict]
    tool_results:     list[dict]
    history_summary:  str | None
    history_recent:   list[dict]
    prompt_version:   str
    answer_stream:    str | None
    nli_flags:        list[dict]
    turn_count:       int
    transfer_reason:  str | None
