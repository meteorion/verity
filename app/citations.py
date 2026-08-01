"""Shared source-citation numbering.

Same source_url → same [n]; no URL → group by breadcrumb head / title / doc_id.
Used by generate_node (stamps _src_idx into the LLM prompt) and the API layer
(builds the refs array shown to the UI), so the [n] the model emits always
matches the reference card the frontend renders. Keep the keying rule here and
only here — three divergent copies previously risked silent citation drift.
"""

# Chunk fields safe to surface to the client in a reference entry.
REF_KEYS = ("chunk_id", "title", "breadcrumb", "source_url")


def source_key(chunk: dict) -> str:
    """The grouping key: a source_url if present, else breadcrumb head / title / doc_id."""
    url = (chunk.get("source_url") or "").strip()
    if url:
        return url
    return (
        chunk.get("breadcrumb", "").split(" > ")[0].strip()
        or chunk.get("title", "").strip()
        or chunk.get("doc_id", "")
    )


def assign_source_indices(chunks: list[dict]) -> list[dict]:
    """Return chunks each stamped with a 1-based _src_idx (same source → same index)."""
    key_to_idx: dict[str, int] = {}
    result = []
    for c in chunks:
        key = source_key(c)
        if key not in key_to_idx:
            key_to_idx[key] = len(key_to_idx) + 1
        result.append({**c, "_src_idx": key_to_idx[key]})
    return result


def build_refs(chunks: list[dict]) -> list[dict]:
    """Return a deduped, idx-sorted refs array for the UI — one entry per source."""
    key_to_idx: dict[str, int] = {}
    seen: set[int] = set()
    refs = []
    for c in chunks:
        key = source_key(c)
        if key not in key_to_idx:
            key_to_idx[key] = len(key_to_idx) + 1
        idx = key_to_idx[key]
        if idx in seen:
            continue
        seen.add(idx)
        refs.append({"idx": idx, **{k: c.get(k, "") for k in REF_KEYS}})
    refs.sort(key=lambda r: r["idx"])
    return refs
