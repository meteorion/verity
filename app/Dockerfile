FROM python:3.12-slim

WORKDIR /app

# System deps: poppler for PDF text extraction, curl for healthchecks,
# libgomp1 for tiktoken C extension
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    curl \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Core pip installs for fast-validation mode (no GPU, no local models)
RUN pip install --no-cache-dir \
    "fastapi[standard]>=0.115" \
    "uvicorn[standard]>=0.32" \
    "langgraph>=0.2" \
    "langchain-core>=0.3" \
    "anthropic>=0.40" \
    "httpx>=0.28" \
    "asyncpg>=0.30" \
    "pgvector>=0.3" \
    "redis[hiredis]>=5.2" \
    "pydantic>=2.9" \
    "python-multipart>=0.0.20" \
    "python-jose[cryptography]>=3.3" \
    "pymupdf>=1.24" \
    "python-docx>=1.1" \
    "markdown-it-py>=3.0" \
    "tiktoken>=0.7"

# Optional local-inference layer (FlagEmbedding + transformers + torch CPU)
# Set --build-arg LOCAL_INFERENCE=1 to enable
ARG LOCAL_INFERENCE=0
RUN if [ "$LOCAL_INFERENCE" = "1" ]; then \
        pip install --no-cache-dir \
            "FlagEmbedding>=1.3" \
            "transformers>=4.48" \
            --extra-index-url https://download.pytorch.org/whl/cpu \
            "torch>=2.5"; \
    fi

COPY . .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
