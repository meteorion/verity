#!/usr/bin/env python3
"""Evaluate generation quality (LLM-as-Judge) on a gold-standard dataset.

Usage:
    python scripts/eval_generation.py --dataset data/gold_standard_v1.jsonl
"""
import argparse
import asyncio
import json
import httpx

_ORCHESTRATION_URL = "http://localhost:8001"


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--dataset", required=True)
    p.add_argument("--url", default=_ORCHESTRATION_URL)
    p.add_argument("--sample", type=int, default=100, help="Number of samples to evaluate")
    return p.parse_args()


async def evaluate(dataset_path: str, base_url: str, sample: int):
    samples = [json.loads(l) for l in open(dataset_path)][:sample]
    scores = []

    async with httpx.AsyncClient(timeout=60.0) as client:
        for s in samples:
            # TODO: collect streaming answer, then call judge model
            pass

    avg = sum(scores) / len(scores) if scores else 0.0
    print(f"LLM-as-Judge avg score: {avg:.4f}  (n={len(scores)})")
    return avg


if __name__ == "__main__":
    args = parse_args()
    asyncio.run(evaluate(args.dataset, args.url, args.sample))
