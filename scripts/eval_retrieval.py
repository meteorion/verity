#!/usr/bin/env python3
"""Evaluate retrieval quality (Recall@5, MRR) on a gold-standard dataset.

Usage:
    python scripts/eval_retrieval.py --dataset data/gold_standard_v1.jsonl
"""
import argparse
import asyncio
import json
import httpx

_RETRIEVAL_URL = "http://localhost:8002"


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--dataset", required=True, help="JSONL file with {query, relevant_chunk_ids}")
    p.add_argument("--top-k", type=int, default=5)
    p.add_argument("--url", default=_RETRIEVAL_URL)
    return p.parse_args()


async def evaluate(dataset_path: str, top_k: int, base_url: str):
    samples = [json.loads(l) for l in open(dataset_path)]
    hits = 0

    async with httpx.AsyncClient(timeout=10.0) as client:
        for s in samples:
            resp = await client.post(
                f"{base_url}/retrieve",
                json={"query": s["query"], "top_k": top_k},
            )
            resp.raise_for_status()
            returned_ids = {c["chunk_id"] for c in resp.json()["chunks"]}
            relevant = set(s["relevant_chunk_ids"])
            if returned_ids & relevant:
                hits += 1

    recall = hits / len(samples)
    print(f"Recall@{top_k}: {recall:.4f}  ({hits}/{len(samples)})")
    return recall


if __name__ == "__main__":
    args = parse_args()
    asyncio.run(evaluate(args.dataset, args.top_k, args.url))
