FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# P1 最小依赖：与 pyproject.toml 的 dependencies 保持一致，只装当前代码实际 import 的包。
# langgraph 固定 1.*（不是更早的 0.2.*）：generate_node 用到的 get_stream_writer()/custom
# stream mode 已经在 1.2.10 上实测过，没验证过旧版是否兼容。
# torch 用 CPU wheel：本地 Embedding（sentence-transformers）P1 就要用，CPU 足够，不需要 GPU。
RUN pip install --no-cache-dir \
    fastapi==0.115.* \
    uvicorn[standard]==0.32.* \
    langgraph==1.* \
    asyncpg==0.30.* \
    pgvector==0.3.* \
    httpx==0.28.* \
    pydantic==2.* \
    pydantic-settings==2.* \
    "typing-extensions>=4.12" \
    sentence-transformers==3.* \
    torch==2.5.* --index-url https://download.pytorch.org/whl/cpu \
    openai==1.*

# ---- 以下按 TODO 从占位变成真实实现时再取消注释，不要一次性预装重依赖 ----
# 文档解析 / 层级化切分真正接入时（app/pipeline/parser/*.py、chunker.py 仍是 TODO，
# 见 doc/plan.md §3.6/§3.7，Marker 还需要系统依赖）：
#     RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils libglib2.0-0 libsm6 libxext6 && rm -rf /var/lib/apt/lists/*
#     RUN pip install --no-cache-dir marker-pdf==1.* llama-index-core==0.12.*
# 换成 LiteLLM 网关或需要直连 Claude/GPT 时（见 doc/plan.md §3.11）：
#     RUN pip install --no-cache-dir langchain-anthropic==0.3.*

# ---- P2 能力开关对应的重依赖：默认不装，构建时传 --build-arg INSTALL_P2_DEPS=true 才装 ----
# 对应 ENABLE_RERANK / ENABLE_NLI（见 doc/plan.md §3.3/§3.8）以及 Redis / Langfuse（见 §3.10/§3.12/§3.13）
# torch 已经在核心依赖里装过（本地 Embedding 需要），这里不用重复装。
ARG INSTALL_P2_DEPS=false
RUN if [ "$INSTALL_P2_DEPS" = "true" ]; then \
      pip install --no-cache-dir \
        FlagEmbedding==1.3.* \
        transformers==4.47.* \
        redis[hiredis]==5.* \
        langfuse==2.* ; \
    fi

COPY . .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
