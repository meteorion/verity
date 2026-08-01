from typing_extensions import TypedDict


class OrchestratorState(TypedDict):
    session_id:       str
    uid:              str | None
    roles:            list[str]
    region:           str
    project_group:    str | None
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
    transferred:      bool
    transfer_reason:  str | None
    # Per-request runtime options (set by API layer, read by nodes)
    top_k:            int | None
    llm_temperature:  float | None
