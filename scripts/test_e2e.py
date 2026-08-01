"""End-to-end smoke test for the Verity fast-validation stack.

Tests:
  1. Health check  — GET /health
  2. Document ingest — POST /api/pipeline/ingest (tiny inline markdown)
  3. Chat query    — POST /v1/chat (SSE)

Usage:
  APP_URL=http://localhost:8000 python scripts/test_e2e.py
"""
import os
import sys
import tempfile
import time

import httpx

BASE_URL = os.getenv("APP_URL", "http://localhost:8000")

PASS = "✅"
FAIL = "❌"

results: list[bool] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    icon = PASS if ok else FAIL
    suffix = f"  ({detail})" if detail else ""
    print(f"{icon} {name}{suffix}")
    results.append(ok)


# ---------------------------------------------------------------------------
# Test 1: Health check
# ---------------------------------------------------------------------------
def test_health() -> None:
    try:
        r = httpx.get(f"{BASE_URL}/health", timeout=10)
        ok = r.status_code == 200 and r.json().get("status") == "ok"
        check("Health check", ok, f"status={r.status_code} body={r.text[:120]}")
    except Exception as exc:
        check("Health check", False, str(exc))


# ---------------------------------------------------------------------------
# Test 2: Document ingest
# ---------------------------------------------------------------------------
def test_ingest() -> None:
    content = (
        "# 退换货政策\n"
        "生鲜商品自签收之日起30 "
        "24 小时内可申请退款。\n"
        "请保留商品原包装。\n"
    )
    try:
        with tempfile.NamedTemporaryFile(
            suffix=".md", mode="w", encoding="utf-8", delete=False
        ) as f:
            f.write(content)
            tmp_path = f.name

        with open(tmp_path, "rb") as fh:
            r = httpx.post(
                f"{BASE_URL}/api/pipeline/ingest",
                data={
                    "doc_id": "test_001",
                    "owner": "test@example.com",
                    "business_line": "retail",
                },
                files={"file": ("policy.md", fh, "text/markdown")},
                timeout=60,
            )

        if r.status_code == 200:
            body = r.json()
            chunk_count = body.get("chunk_count", 0)
            ok = chunk_count > 0
            check("Document ingest", ok, f"chunk_count={chunk_count}")
        else:
            check("Document ingest", False, f"status={r.status_code} body={r.text[:200]}")
    except Exception as exc:
        check("Document ingest", False, str(exc))


# ---------------------------------------------------------------------------
# Test 3: Chat query (SSE)
# ---------------------------------------------------------------------------
def test_chat() -> None:
    payload = {
        "session_id": "test_session",
        "message": "生鲜商品可以退款吗",
    }
    headers = {
        "X-UID": "test",
        "X-Roles": "role:public",
        "X-Region": "global",
        "Accept": "text/event-stream",
    }
    try:
        received_data = False
        with httpx.stream(
            "POST",
            f"{BASE_URL}/v1/chat",
            json=payload,
            headers=headers,
            timeout=60,
        ) as r:
            if r.status_code != 200:
                check(
                    "Chat query (SSE)",
                    False,
                    f"status={r.status_code} body={r.read()[:200]}",
                )
                return
            for line in r.iter_lines():
                if line.startswith("data:") and line.strip() != "data:":
                    received_data = True
                    break
        check("Chat query (SSE)", received_data, "SSE data token received" if received_data else "no data tokens")
    except Exception as exc:
        check("Chat query (SSE)", False, str(exc))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print(f"Running e2e smoke tests against {BASE_URL}\n")

    test_health()
    time.sleep(0.5)
    test_ingest()
    time.sleep(1.0)
    test_chat()

    total = len(results)
    passed = sum(results)
    print(f"\n{passed}/{total} tests passed.")
    sys.exit(0 if all(results) else 1)
