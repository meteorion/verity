"""Evaluation API — Ragas-standard evaluation pipeline.

Dataset items follow the Ragas convention:
  question     — the test query
  ground_truth — reference answer (optional; enables context_precision/recall, answer_correctness)

At eval time the pipeline produces:
  contexts     — retrieved chunk texts
  answer       — LLM-generated response
  ragas_metrics — full Ragas metric set
"""
import csv
import io
import json
import logging
import os
import time
from typing import List

import asyncpg
from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from pydantic import BaseModel

from db import get_pool

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/eval")


async def _get_conn() -> asyncpg.pool.PoolConnectionProxy:
    pool = await get_pool()
    return await pool.acquire()


async def _release_conn(conn) -> None:
    pool = await get_pool()
    await pool.release(conn)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class DatasetCreate(BaseModel):
    name: str
    description: str = ""


class DatasetUpdate(BaseModel):
    name: str
    description: str = ""


class ItemCreate(BaseModel):
    question: str
    ground_truth: str = ""


class ItemUpdate(BaseModel):
    question: str
    ground_truth: str = ""


class EvalOptions(BaseModel):
    top_k: int = 5
    temperature: float = 0.0
    metrics: List[str] = []   # empty = all metrics enabled
    item_ids: List[str] = []


# ---------------------------------------------------------------------------
# Dataset CRUD
# ---------------------------------------------------------------------------

@router.get("/datasets")
async def list_datasets():
    conn = await _get_conn()
    try:
        rows = await conn.fetch(
            "SELECT d.dataset_id, d.name, d.description, d.source_type,"
            "       d.created_at, d.updated_at,"
            "       COUNT(i.item_id) AS item_count"
            " FROM eval_datasets d"
            " LEFT JOIN eval_dataset_items i ON i.dataset_id = d.dataset_id"
            " GROUP BY d.dataset_id"
            " ORDER BY d.created_at DESC"
        )
        return {"datasets": [dict(r) for r in rows]}
    except Exception:
        logger.exception("list_datasets failed")
        raise HTTPException(status_code=500, detail="Failed to list datasets")
    finally:
        await _release_conn(conn)


@router.post("/datasets", status_code=201)
async def create_dataset(body: DatasetCreate):
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="name is required")
    dataset_id = f"ds_{int(time.time() * 1000)}"
    conn = await _get_conn()
    try:
        await conn.execute(
            "INSERT INTO eval_datasets(dataset_id, name, description, source_type)"
            " VALUES($1, $2, $3, 'manual')",
            dataset_id, body.name.strip(), body.description,
        )
        return {"dataset_id": dataset_id, "name": body.name.strip()}
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=409, detail="Dataset already exists")
    finally:
        await _release_conn(conn)


@router.get("/datasets/{dataset_id}")
async def get_dataset(dataset_id: str):
    conn = await _get_conn()
    try:
        row = await conn.fetchrow(
            "SELECT d.*, COUNT(i.item_id) AS item_count"
            " FROM eval_datasets d"
            " LEFT JOIN eval_dataset_items i ON i.dataset_id = d.dataset_id"
            " WHERE d.dataset_id = $1"
            " GROUP BY d.dataset_id",
            dataset_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Dataset not found")
        return dict(row)
    finally:
        await _release_conn(conn)


@router.put("/datasets/{dataset_id}")
async def update_dataset(dataset_id: str, body: DatasetUpdate):
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="name is required")
    conn = await _get_conn()
    try:
        row = await conn.fetchrow(
            "SELECT dataset_id FROM eval_datasets WHERE dataset_id=$1", dataset_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="Dataset not found")
        await conn.execute(
            "UPDATE eval_datasets SET name=$2, description=$3, updated_at=now()"
            " WHERE dataset_id=$1",
            dataset_id, body.name.strip(), body.description,
        )
        return {"dataset_id": dataset_id, "name": body.name.strip()}
    finally:
        await _release_conn(conn)


@router.delete("/datasets/{dataset_id}", status_code=204)
async def delete_dataset(dataset_id: str):
    conn = await _get_conn()
    try:
        async with conn.transaction():
            await conn.execute("DELETE FROM eval_records WHERE dataset_id=$1", dataset_id)
            await conn.execute("DELETE FROM eval_dataset_items WHERE dataset_id=$1", dataset_id)
            await conn.execute("DELETE FROM eval_datasets WHERE dataset_id=$1", dataset_id)
    finally:
        await _release_conn(conn)


# ---------------------------------------------------------------------------
# File upload → auto-create dataset
# ---------------------------------------------------------------------------

def _parse_dataset_file(text: str, filename: str) -> list[dict]:
    """Parse a JSONL or CSV file into dataset item dicts. 'question' column/key is required."""
    ext = (filename or "").rsplit(".", 1)[-1].lower()
    if ext == "csv":
        reader = csv.DictReader(io.StringIO(text))
        items: list[dict] = []
        for row_num, row in enumerate(reader, 2):
            question = row.get("question", "").strip()
            if not question:
                raise HTTPException(status_code=422, detail=f"Missing 'question' at row {row_num}")
            items.append({
                "question": question,
                "ground_truth": row.get("ground_truth", "").strip(),
            })
        return items
    # Default: JSONL
    items = []
    for line_num, line in enumerate(text.splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            raise HTTPException(status_code=422, detail=f"Invalid JSON at line {line_num}")
        if not obj.get("question"):
            raise HTTPException(status_code=422, detail=f"Missing 'question' at line {line_num}")
        items.append({
            "question": obj["question"],
            "ground_truth": obj.get("ground_truth") or obj.get("ground_truth_answer", ""),
        })
    return items


@router.post("/datasets/upload", status_code=201)
async def upload_dataset_file(
    file: UploadFile = File(...),
    name: str = "",
    description: str = "",
):
    """Upload a JSONL or CSV file to create a dataset.

    JSONL: {"question": "退款流程？", "ground_truth": "3-5个工作日。"}
    CSV:   columns question,ground_truth (question required)
    """
    if not file.filename:
        raise HTTPException(status_code=422, detail="File is required")

    raw = await file.read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=422, detail="File must be UTF-8 encoded")

    items = _parse_dataset_file(text, file.filename)

    if not items:
        raise HTTPException(status_code=422, detail="No valid items found in file")

    dataset_name = name.strip() or file.filename.rsplit(".", 1)[0]
    dataset_id = f"ds_{int(time.time() * 1000)}"

    conn = await _get_conn()
    try:
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO eval_datasets(dataset_id, name, description, source_type)"
                " VALUES($1, $2, $3, 'file')",
                dataset_id, dataset_name, description,
            )
            for i, item in enumerate(items):
                item_id = f"{dataset_id}_i{i + 1:04d}"
                await conn.execute(
                    "INSERT INTO eval_dataset_items(item_id, dataset_id, question, ground_truth)"
                    " VALUES($1, $2, $3, $4)",
                    item_id, dataset_id, item["question"], item["ground_truth"],
                )
        return {"dataset_id": dataset_id, "name": dataset_name, "item_count": len(items)}
    finally:
        await _release_conn(conn)


# ---------------------------------------------------------------------------
# Knowledge-base sample generation
# ---------------------------------------------------------------------------

@router.post("/datasets/generate-from-kb", status_code=201)
async def generate_dataset_from_kb(
    name: str = "",
    description: str = "",
    sample_count: int = 50,
    doc_ids: str = "",
):
    """Generate a dataset by sampling chunks from the knowledge base.

    Each chunk's content becomes the 'question'; ground_truth is left empty
    (Ragas will still compute context_relevancy, faithfulness, answer_relevancy).
    """
    conn = await _get_conn()
    try:
        where_clause = "WHERE (effective_to IS NULL OR effective_to > now())"
        args: list = []
        if doc_ids:
            id_list = [d.strip() for d in doc_ids.split(",") if d.strip()]
            if id_list:
                placeholders = ",".join(f"${i + 1}" for i in range(len(id_list)))
                where_clause += f" AND doc_id IN ({placeholders})"
                args.extend(id_list)

        total = await conn.fetchval(
            f"SELECT COUNT(*) FROM chunks {where_clause}", *args
        ) or 0
        if total == 0:
            raise HTTPException(status_code=400, detail="No chunks found in knowledge base")

        actual_count = min(sample_count, total)
        rows = await conn.fetch(
            f"SELECT chunk_id, content, doc_id FROM chunks {where_clause}"
            f" ORDER BY RANDOM() LIMIT ${len(args) + 1}",
            *args, actual_count,
        )

        dataset_name = name.strip() or f"知识库采样 {time.strftime('%Y%m%d-%H%M')}"
        dataset_id = f"ds_{int(time.time() * 1000)}"

        async with conn.transaction():
            await conn.execute(
                "INSERT INTO eval_datasets(dataset_id, name, description, source_type)"
                " VALUES($1, $2, $3, 'kb_sample')",
                dataset_id, dataset_name, description,
            )
            for i, row in enumerate(rows):
                item_id = f"{dataset_id}_i{i + 1:04d}"
                await conn.execute(
                    "INSERT INTO eval_dataset_items(item_id, dataset_id, question, ground_truth)"
                    " VALUES($1, $2, $3, '')",
                    item_id, dataset_id, row["content"],
                )

        return {"dataset_id": dataset_id, "name": dataset_name, "item_count": len(rows)}
    finally:
        await _release_conn(conn)


# ---------------------------------------------------------------------------
# Dataset items CRUD
# ---------------------------------------------------------------------------

@router.get("/datasets/{dataset_id}/items")
async def list_items(dataset_id: str, limit: int = 200, offset: int = 0):
    conn = await _get_conn()
    try:
        ds = await conn.fetchrow(
            "SELECT dataset_id FROM eval_datasets WHERE dataset_id=$1", dataset_id
        )
        if not ds:
            raise HTTPException(status_code=404, detail="Dataset not found")
        rows = await conn.fetch(
            "SELECT item_id, dataset_id, question, ground_truth, created_at"
            " FROM eval_dataset_items"
            " WHERE dataset_id=$1"
            " ORDER BY item_id"
            " LIMIT $2 OFFSET $3",
            dataset_id, limit, offset,
        )
        total = await conn.fetchval(
            "SELECT COUNT(*) FROM eval_dataset_items WHERE dataset_id=$1", dataset_id
        )
        return {"items": [dict(r) for r in rows], "total": total}
    finally:
        await _release_conn(conn)


@router.post("/datasets/{dataset_id}/items", status_code=201)
async def add_item(dataset_id: str, body: ItemCreate):
    if not body.question.strip():
        raise HTTPException(status_code=422, detail="question is required")
    conn = await _get_conn()
    try:
        ds = await conn.fetchrow(
            "SELECT dataset_id FROM eval_datasets WHERE dataset_id=$1", dataset_id
        )
        if not ds:
            raise HTTPException(status_code=404, detail="Dataset not found")
        item_id = f"{dataset_id}_i{int(time.time() * 1000) % 100000:05d}"
        await conn.execute(
            "INSERT INTO eval_dataset_items(item_id, dataset_id, question, ground_truth)"
            " VALUES($1, $2, $3, $4)",
            item_id, dataset_id, body.question.strip(), body.ground_truth,
        )
        return {"item_id": item_id, "dataset_id": dataset_id}
    finally:
        await _release_conn(conn)


@router.put("/datasets/{dataset_id}/items/{item_id}")
async def update_item(dataset_id: str, item_id: str, body: ItemUpdate):
    if not body.question.strip():
        raise HTTPException(status_code=422, detail="question is required")
    conn = await _get_conn()
    try:
        row = await conn.fetchrow(
            "SELECT item_id FROM eval_dataset_items WHERE item_id=$1 AND dataset_id=$2",
            item_id, dataset_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Item not found")
        await conn.execute(
            "UPDATE eval_dataset_items SET question=$3, ground_truth=$4"
            " WHERE item_id=$1 AND dataset_id=$2",
            item_id, dataset_id, body.question.strip(), body.ground_truth,
        )
        return {"item_id": item_id}
    finally:
        await _release_conn(conn)


@router.delete("/datasets/{dataset_id}/items/{item_id}", status_code=204)
async def delete_item(dataset_id: str, item_id: str):
    conn = await _get_conn()
    try:
        await conn.execute(
            "DELETE FROM eval_dataset_items WHERE item_id=$1 AND dataset_id=$2",
            item_id, dataset_id,
        )
    finally:
        await _release_conn(conn)


# ---------------------------------------------------------------------------
# Core eval pipeline
# ---------------------------------------------------------------------------

async def _do_eval(
    conn: asyncpg.Connection,
    dataset_id: str,
    item_id: str | None,
    question: str,
    ground_truth: str,
    top_k: int,
    run_type: str,
    batch_record_id: str | None = None,
    temperature: float = 0.0,
    enabled_metrics: set | None = None,
) -> dict:
    """Retrieve → Generate → Ragas evaluate, persist one eval_record."""
    from eval.ragas_eval import get_evaluator

    t0 = time.perf_counter()
    try:
        from retrieval.hybrid import hybrid_retrieve
        chunks = await hybrid_retrieve(
            query=question, roles=["admin"], region="global", top_k=top_k,
        )
    except Exception:
        logger.exception("Retrieval failed for question: %s", question[:80])
        chunks = []
    retrieval_ms = int((time.perf_counter() - t0) * 1000)

    retrieved_ids = [c["chunk_id"] for c in chunks]
    contexts = [c.get("content", "")[:800] for c in chunks]

    evaluator = get_evaluator()
    # generate_answer is called inside evaluate_single when answer is empty,
    # but we want to capture the answer for storage — call explicitly.
    answer = await evaluator.generate_answer(question, contexts, temperature=temperature) if contexts else ""
    ragas_scores = await evaluator.evaluate_single(
        query=question,
        contexts=contexts,
        answer=answer,
        ground_truth=ground_truth,
        enabled_metrics=enabled_metrics,
    )

    # Total end-to-end latency: retrieval + generation + ragas metrics
    latency_ms = int((time.perf_counter() - t0) * 1000)

    suffix = (item_id or "manual")[-6:]
    record_id = f"rec_{int(time.time() * 1000)}_{suffix}"

    await conn.execute(
        "INSERT INTO eval_records("
        "  record_id, dataset_id, item_id, batch_record_id,"
        "  run_type, query, question, answer, contexts, ground_truth,"
        "  retrieved_chunk_ids, top_k, retrieval_ms, latency_ms, ragas_metrics"
        ") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
        record_id, dataset_id, item_id, batch_record_id,
        run_type, question, question, answer, contexts, ground_truth,
        retrieved_ids, top_k, retrieval_ms, latency_ms, json.dumps(ragas_scores),
    )

    return {
        "record_id": record_id,
        "item_id": item_id,
        "question": question,
        "answer": answer,
        "contexts": contexts,
        "ground_truth": ground_truth,
        "retrieved_chunk_ids": retrieved_ids,
        "retrieved_count": len(retrieved_ids),
        "retrieval_ms": retrieval_ms,
        "latency_ms": latency_ms,
        "ragas_metrics": ragas_scores,
    }


# ---------------------------------------------------------------------------
# Eval endpoints — single item
# ---------------------------------------------------------------------------

@router.post("/datasets/{dataset_id}/items/{item_id}/eval")
async def run_single_eval(
    dataset_id: str,
    item_id: str,
    options: EvalOptions = EvalOptions(),
):
    """Run the full evaluation pipeline on a single dataset item."""
    conn = await _get_conn()
    try:
        item = await conn.fetchrow(
            "SELECT * FROM eval_dataset_items WHERE item_id=$1 AND dataset_id=$2",
            item_id, dataset_id,
        )
        if not item:
            raise HTTPException(status_code=404, detail="Item not found")
        enabled_metrics = set(options.metrics) if options.metrics else None
        return await _do_eval(
            conn, dataset_id, item_id,
            item["question"], item.get("ground_truth", "") or "",
            options.top_k, "single",
            temperature=options.temperature,
            enabled_metrics=enabled_metrics,
        )
    finally:
        await _release_conn(conn)


# ---------------------------------------------------------------------------
# Eval endpoints — batch
# ---------------------------------------------------------------------------

@router.post("/datasets/{dataset_id}/eval", status_code=202)
async def run_batch_eval(
    dataset_id: str,
    background_tasks: BackgroundTasks,
    options: EvalOptions = EvalOptions(),
):
    """Start async batch evaluation. Returns immediately with batch_record_id."""
    conn = await _get_conn()
    try:
        ds = await conn.fetchrow(
            "SELECT dataset_id FROM eval_datasets WHERE dataset_id=$1", dataset_id
        )
        if not ds:
            raise HTTPException(status_code=404, detail="Dataset not found")

        # Reject if another batch is already running for this dataset
        running_batch = await conn.fetchval(
            "SELECT batch_record_id FROM eval_batch_runs"
            " WHERE dataset_id=$1 AND status='running' LIMIT 1",
            dataset_id,
        )
        if running_batch:
            raise HTTPException(
                status_code=409,
                detail="当前数据集存在进行中的批量评估，请等待完成后再发起",
            )

        if options.item_ids:
            items = await conn.fetch(
                "SELECT item_id, question, ground_truth"
                " FROM eval_dataset_items WHERE dataset_id=$1 AND item_id = ANY($2)",
                dataset_id, options.item_ids,
            )
        else:
            items = await conn.fetch(
                "SELECT item_id, question, ground_truth"
                " FROM eval_dataset_items WHERE dataset_id=$1",
                dataset_id,
            )
        if not items:
            raise HTTPException(status_code=400, detail="Dataset has no items")

        batch_record_id = f"batch_{int(time.time() * 1000)}"
        item_list = [dict(r) for r in items]
        enabled_metrics = set(options.metrics) if options.metrics else None

        await conn.execute(
            "INSERT INTO eval_batch_runs(batch_record_id, dataset_id, status, total_items)"
            " VALUES($1, $2, 'running', $3)",
            batch_record_id, dataset_id, len(item_list),
        )

        background_tasks.add_task(
            _run_batch_background, dataset_id, batch_record_id, item_list,
            options.top_k, options.temperature, enabled_metrics,
        )
        return {
            "batch_record_id": batch_record_id,
            "status": "running",
            "total_items": len(item_list),
        }
    finally:
        await _release_conn(conn)


async def _run_batch_background(
    dataset_id: str,
    batch_record_id: str,
    items: list[dict],
    top_k: int,
    temperature: float = 0.0,
    enabled_metrics: set | None = None,
) -> None:
    """Background worker: evaluate each item, update progress, store aggregate."""
    metric_keys = [
        "context_relevancy", "faithfulness", "answer_relevancy",
        "context_recall", "answer_correctness", "context_precision",
    ]
    results = []
    completed = 0
    conn = await _get_conn()
    try:
        for item in items:
            try:
                result = await _do_eval(
                    conn, dataset_id, item["item_id"],
                    item["question"], item.get("ground_truth", "") or "",
                    top_k, "batch", batch_record_id=batch_record_id,
                    temperature=temperature,
                    enabled_metrics=enabled_metrics,
                )
                results.append(result)
            except Exception:
                logger.exception("Batch eval failed for item %s", item.get("item_id"))
            completed += 1
            await conn.execute(
                "UPDATE eval_batch_runs SET completed_items=$2 WHERE batch_record_id=$1",
                batch_record_id, completed,
            )

        # Aggregate
        aggregate: dict[str, float] = {}
        for key in metric_keys:
            vals = [
                r["ragas_metrics"].get(key)
                for r in results
                if isinstance(r.get("ragas_metrics"), dict) and r["ragas_metrics"].get(key) is not None
            ]
            if vals:
                aggregate[key] = round(sum(vals) / len(vals), 4)

        total_latency = sum(r.get("latency_ms", 0) for r in results)
        avg_latency = round(total_latency / len(results), 1) if results else 0.0

        await conn.execute(
            "UPDATE eval_batch_runs"
            " SET status='completed', completed_items=$2,"
            "     aggregate_metrics=$3, completed_at=now()"
            " WHERE batch_record_id=$1",
            batch_record_id, completed, json.dumps({
                "aggregate_ragas_metrics": aggregate,
                "avg_latency_ms": avg_latency,
                "total_items": len(items),
                "success_items": len(results),
            }),
        )
    except Exception:
        logger.exception("Batch run %s failed", batch_record_id)
        await conn.execute(
            "UPDATE eval_batch_runs SET status='failed', error_msg=$2 WHERE batch_record_id=$1",
            batch_record_id, "内部错误，请查看日志",
        )
    finally:
        await _release_conn(conn)


@router.get("/batches/{batch_record_id}")
async def get_batch_run(batch_record_id: str):
    """Poll batch run status and result."""
    conn = await _get_conn()
    try:
        row = await conn.fetchrow(
            "SELECT * FROM eval_batch_runs WHERE batch_record_id=$1", batch_record_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="Batch run not found")
        data = dict(row)
        metrics_raw = data.get("aggregate_metrics") or {}
        if isinstance(metrics_raw, str):
            try:
                metrics_raw = json.loads(metrics_raw)
            except Exception:
                metrics_raw = {}
        return {
            "batch_record_id": batch_record_id,
            "dataset_id": data["dataset_id"],
            "status": data["status"],
            "total_items": data["total_items"],
            "completed_items": data["completed_items"],
            "error_msg": data.get("error_msg", ""),
            "created_at": str(data["created_at"]),
            "completed_at": str(data["completed_at"]) if data.get("completed_at") else None,
            **metrics_raw,
        }
    finally:
        await _release_conn(conn)


# ---------------------------------------------------------------------------
# Batch run deletion
# ---------------------------------------------------------------------------

@router.delete("/batches", status_code=204)
async def clear_batch_runs(dataset_id: str = ""):
    """Delete completed/failed batch run records (and their eval records)."""
    conn = await _get_conn()
    try:
        async with conn.transaction():
            if dataset_id:
                batch_ids = await conn.fetch(
                    "SELECT batch_record_id FROM eval_batch_runs"
                    " WHERE dataset_id=$1 AND status != 'running'",
                    dataset_id,
                )
                ids = [r["batch_record_id"] for r in batch_ids]
                if ids:
                    await conn.execute(
                        "UPDATE eval_records SET batch_record_id=NULL"
                        " WHERE batch_record_id = ANY($1)", ids,
                    )
                    await conn.execute(
                        "DELETE FROM eval_batch_runs WHERE batch_record_id = ANY($1)", ids,
                    )
            else:
                await conn.execute(
                    "UPDATE eval_records SET batch_record_id=NULL"
                    " WHERE batch_record_id IN (SELECT batch_record_id FROM eval_batch_runs WHERE status != 'running')"
                )
                await conn.execute(
                    "DELETE FROM eval_batch_runs WHERE status != 'running'"
                )
    finally:
        await _release_conn(conn)


# ---------------------------------------------------------------------------
# Eval records
# ---------------------------------------------------------------------------

@router.delete("/records", status_code=204)
async def clear_records(dataset_id: str = ""):
    """Delete all eval records (optionally scoped to a dataset)."""
    conn = await _get_conn()
    try:
        if dataset_id:
            await conn.execute(
                "DELETE FROM eval_records WHERE dataset_id=$1", dataset_id,
            )
        else:
            await conn.execute("DELETE FROM eval_records")
    finally:
        await _release_conn(conn)


@router.get("/records")
async def list_records(
    dataset_id: str = "",
    run_type: str = "",
    limit: int = 50,
    offset: int = 0,
):
    conn = await _get_conn()
    try:
        conditions: list[str] = []
        args: list = []
        idx = 1

        if dataset_id:
            conditions.append(f"dataset_id=${idx}")
            args.append(dataset_id)
            idx += 1
        if run_type:
            conditions.append(f"run_type=${idx}")
            args.append(run_type)
            idx += 1

        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

        rows = await conn.fetch(
            f"SELECT record_id, dataset_id, item_id, batch_record_id, run_type,"
            f" question, top_k, latency_ms, ragas_metrics, created_at"
            f" FROM eval_records {where}"
            f" ORDER BY created_at DESC"
            f" LIMIT ${idx} OFFSET ${idx + 1}",
            *args, limit, offset,
        )
        total = await conn.fetchval(
            f"SELECT COUNT(*) FROM eval_records {where}", *args
        )
        return {"records": [dict(r) for r in rows], "total": total}
    finally:
        await _release_conn(conn)


@router.get("/records/stats")
async def record_stats(dataset_id: str = ""):
    """Aggregate Ragas metrics across eval records."""
    conn = await _get_conn()
    try:
        args: list = []
        where = ""
        if dataset_id:
            where = "WHERE dataset_id=$1"
            args.append(dataset_id)

        overall = await conn.fetchrow(
            f"SELECT COUNT(*) AS total_evals,"
            f" AVG(latency_ms)::FLOAT AS avg_latency_ms,"
            f" PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms)::FLOAT AS p50_latency_ms,"
            f" PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::FLOAT AS p95_latency_ms"
            f" FROM eval_records {where}",
            *args,
        )

        # Aggregate Ragas metrics via JSONB
        metric_keys = [
            "context_precision", "context_recall", "context_relevancy",
            "faithfulness", "answer_relevancy", "answer_correctness",
            "answer_semantic_similarity",
        ]
        ragas_agg: dict[str, float | None] = {}
        for key in metric_keys:
            val = await conn.fetchval(
                f"SELECT AVG((ragas_metrics->>'{key}')::FLOAT)"
                f" FROM eval_records {where}"
                f" WHERE ragas_metrics->>'{key}' IS NOT NULL",
                *args,
            )
            ragas_agg[key] = round(float(val), 4) if val is not None else None

        # Per-dataset breakdown
        ds_where = f"WHERE r.dataset_id=$1" if dataset_id else ""
        ds_rows = await conn.fetch(
            f"SELECT r.dataset_id, d.name AS dataset_name,"
            f" COUNT(*) AS total_evals,"
            f" AVG(r.latency_ms)::FLOAT AS avg_latency_ms"
            f" FROM eval_records r"
            f" JOIN eval_datasets d ON d.dataset_id = r.dataset_id"
            f" {ds_where}"
            f" GROUP BY r.dataset_id, d.name"
            f" ORDER BY d.name",
            *args,
        )

        # Recent batch runs
        batch_rows = await conn.fetch(
            f"SELECT batch_record_id, dataset_id,"
            f" COUNT(*) AS total_items,"
            f" AVG(latency_ms)::FLOAT AS avg_latency_ms,"
            f" MIN(created_at) AS created_at"
            f" FROM eval_records"
            f" {('WHERE dataset_id=$1 AND' if dataset_id else 'WHERE')} batch_record_id IS NOT NULL"
            f" GROUP BY batch_record_id, dataset_id"
            f" ORDER BY MIN(created_at) DESC"
            f" LIMIT 20",
            *args,
        )

        return {
            "overall": {
                "total_evals": overall["total_evals"] or 0,
                "avg_latency_ms": round(overall["avg_latency_ms"] or 0, 1),
                "p50_latency_ms": round(overall["p50_latency_ms"] or 0, 1),
                "p95_latency_ms": round(overall["p95_latency_ms"] or 0, 1),
                "ragas_metrics": ragas_agg,
            },
            "per_dataset": [
                {
                    "dataset_id": r["dataset_id"],
                    "dataset_name": r["dataset_name"],
                    "total_evals": r["total_evals"],
                    "avg_latency_ms": round(r["avg_latency_ms"] or 0, 1),
                }
                for r in ds_rows
            ],
            "batch_records": [
                {
                    "batch_record_id": r["batch_record_id"],
                    "dataset_id": r["dataset_id"],
                    "total_items": r["total_items"],
                    "avg_latency_ms": round(r["avg_latency_ms"] or 0, 1),
                    "created_at": str(r["created_at"]),
                }
                for r in batch_rows
            ],
        }
    finally:
        await _release_conn(conn)


@router.get("/records/{record_id}")
async def get_record(record_id: str):
    conn = await _get_conn()
    try:
        row = await conn.fetchrow(
            "SELECT * FROM eval_records WHERE record_id=$1", record_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="Record not found")
        return dict(row)
    finally:
        await _release_conn(conn)
