"""
scripts/check_admission.py — 准入评分诊断工具

用法：
    python scripts/check_admission.py [doc_id]   # 指定文档
    python scripts/check_admission.py             # 列出所有文档并逐一诊断

环境变量：
    PGVECTOR_DSN  (默认 postgresql://raguser:changeme@localhost:5432/ragdb)
"""
import asyncio
import os
import statistics
import sys

import asyncpg
from pgvector.asyncpg import register_vector

DSN = os.getenv("PGVECTOR_DSN", "postgresql://raguser:changeme@localhost:5432/ragdb")
BAR = 28


def bar(score: int, max_score: int) -> str:
    filled = round(BAR * score / max_score) if max_score else 0
    return "█" * filled + "░" * (BAR - filled)


def row(label: str, score: int, max_score: int, note: str = "") -> str:
    pct = f"{score}/{max_score}"
    note_str = f"  {note}" if note else ""
    return f"  {label:<14} [{bar(score, max_score)}] {pct:>5}{note_str}"


async def diagnose(conn: asyncpg.Connection, doc_id: str) -> None:
    doc = await conn.fetchrow(
        "SELECT title, status, admission_score FROM documents WHERE doc_id=$1", doc_id
    )
    if not doc:
        print(f"  [ERROR] doc_id '{doc_id}' not found\n")
        return

    print(f"\n{'─'*62}")
    print(f"  {doc['title']}")
    print(f"  doc_id={doc_id}  status={doc['status']}  存储分={doc['admission_score']}")
    print(f"{'─'*62}")

    rows = await conn.fetch(
        "SELECT content, breadcrumb FROM chunks"
        " WHERE doc_id=$1 AND (effective_to IS NULL OR effective_to > now())",
        doc_id,
    )
    if not rows:
        print("  [WARN] 无有效 chunk\n")
        return

    chunks = [dict(r) for r in rows]
    contents = [c["content"] for c in chunks]
    token_counts = [len(t) // 3 for t in contents]
    total_chars = sum(len(t) for t in contents)
    avg_tokens = statistics.mean(token_counts) if token_counts else 0

    # ── 1. Content quality ─────────────────────────────────────────────────
    content_score = min(30, total_chars // 150)
    need_chars = max(0, (30 - content_score) * 150)
    c_note = f"总字符 {total_chars}" + (f"，再需 {need_chars} 字达满分" if need_chars else " ✓")

    # ── 2. Structure ────────────────────────────────────────────────────────
    depths = [c.get("breadcrumb", "").count(" > ") for c in chunks]
    max_depth = max(depths) if depths else 0
    depth_score = min(10, max_depth * 3)

    if len(token_counts) > 1 and avg_tokens > 0:
        cv = statistics.stdev(token_counts) / avg_tokens
        uniformity = 10 if cv < 0.5 else 7 if cv < 1.0 else 4 if cv < 1.5 else 1
        cv_note = f"CV={cv:.2f}"
    else:
        uniformity = 5
        cv_note = "单 chunk"

    struct_score = depth_score + uniformity
    s_note = f"标题层深={max_depth}(→{depth_score}分)  大小均匀度 {cv_note}(→{uniformity}分)"

    # ── 3. Retrievability ───────────────────────────────────────────────────
    if 60 <= avg_tokens <= 600:
        tok_score = 10
    elif 30 <= avg_tokens < 60 or 600 < avg_tokens <= 900:
        tok_score = 6
    else:
        tok_score = 2

    short_ratio = sum(1 for t in token_counts if t < 20) / len(token_counts)
    short_score = 10 if short_ratio < 0.1 else 7 if short_ratio < 0.3 else 4 if short_ratio < 0.5 else 1
    retrievability_score = tok_score + short_score
    r_note = (f"avg_tokens={avg_tokens:.0f}(→{tok_score}分)  "
              f"短块占比={short_ratio:.0%}(→{short_score}分)")

    # ── 4. Novelty (multi-sample) ───────────────────────────────────────────
    emb_rows = await conn.fetch(
        "SELECT chunk_id, embedding FROM chunks"
        " WHERE doc_id=$1 AND embedding IS NOT NULL LIMIT 5",
        doc_id,
    )
    dedup_sims: list[float] = []
    top_match: tuple | None = None
    for er in emb_rows:
        sim_row = await conn.fetchrow(
            "SELECT c.chunk_id, d.title, 1-(c.embedding<=>$1::vector) AS sim"
            " FROM chunks c JOIN documents d ON d.doc_id=c.doc_id"
            " WHERE c.doc_id!=$2 AND c.embedding IS NOT NULL"
            " ORDER BY c.embedding<=>$1::vector LIMIT 1",
            er["embedding"], doc_id,
        )
        if sim_row:
            dedup_sims.append(float(sim_row["sim"]))
            if top_match is None or float(sim_row["sim"]) > top_match[0]:
                top_match = (float(sim_row["sim"]), sim_row["title"])

    avg_sim = statistics.mean(dedup_sims) if dedup_sims else 0.0
    novelty_score = int((1.0 - min(avg_sim, 1.0)) * 20)
    n_note = f"平均相似度={avg_sim:.3f}({len(dedup_sims)}个样本)"
    if top_match and top_match[0] > 0.7:
        n_note += f"  ← 与《{top_match[1]}》最高{top_match[0]:.3f}"

    # ── Total ───────────────────────────────────────────────────────────────
    total = min(100, content_score + struct_score + retrievability_score + novelty_score + 10)

    print(row("内容质量",      content_score,      30, c_note))
    print(row("文档结构",      struct_score,       20, s_note))
    print(row("可检索性",      retrievability_score, 20, r_note))
    print(row("新颖性",        novelty_score,      20, n_note))
    print(row("基础分",        10,                 10))
    print(f"\n  {'重算总分':<14} [{'█'*round(BAR*total/100)}{'░'*(BAR-round(BAR*total/100))}] {total:>5}/100")

    # ── 诊断建议 ────────────────────────────────────────────────────────────
    tips = []
    if content_score < 15:
        tips.append(f"内容过短（{total_chars} 字），补充详细说明/示例/步骤")
    if max_depth < 2:
        tips.append(f"标题层次不足（最深 {max_depth} 层），建议用 H2/H3 细分章节")
    if uniformity < 7:
        tips.append(f"chunk 大小不均（CV={cv:.2f}），考虑调整 CHUNK_SIZE 或优化段落结构")
    if avg_tokens < 30:
        tips.append(f"chunk 过碎（avg {avg_tokens:.0f} tokens），段落可合并扩展")
    if avg_tokens > 900:
        tips.append(f"chunk 过长（avg {avg_tokens:.0f} tokens），考虑减小 CHUNK_SIZE")
    if short_ratio >= 0.3:
        tips.append(f"短块过多（{short_ratio:.0%} 的 chunk < 20 tokens），存在大量碎片内容")
    if top_match and top_match[0] > 0.85:
        tips.append(f"与《{top_match[1]}》高度相似（{top_match[0]:.3f}），确认是否重复文档")

    if tips:
        print("\n  改进建议：")
        for t in tips:
            print(f"  · {t}")
    else:
        print("\n  ✓ 各维度正常")
    print()


async def main() -> None:
    conn = await asyncpg.connect(DSN)
    await register_vector(conn)
    try:
        if len(sys.argv) > 1:
            await diagnose(conn, sys.argv[1])
        else:
            doc_rows = await conn.fetch(
                "SELECT doc_id FROM documents ORDER BY updated_at DESC LIMIT 50"
            )
            if not doc_rows:
                print("数据库中暂无文档。")
                return
            for r in doc_rows:
                await diagnose(conn, r["doc_id"])
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
