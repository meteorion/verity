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
    "psycopg[binary]>=3.1" \
    "langgraph-checkpoint-postgres>=2.0" \
    "pydantic>=2.9" \
    "python-multipart>=0.0.20" \
    "python-jose[cryptography]>=3.3" \
    "pymupdf>=1.24" \
    "python-docx>=1.1" \
    "markdown-it-py>=3.0" \
    "tiktoken>=0.7" \
    "ragas>=0.3" \
    "datasets>=3.0" \
    "langchain-openai>=0.3" \
    "langchain-community>=0.3"

# ragas 0.4.x unconditionally imports langchain_community.chat_models.vertexai,
# which was removed in langchain-community 0.3+. Register a sys.modules stub via
# sitecustomize.py so any subsequent pip upgrade of langchain-community cannot
# overwrite it (pip never touches sitecustomize.py).
RUN python - <<'EOF'
import os, site
stub = (
    "import sys\n"
    "if 'langchain_community.chat_models.vertexai' not in sys.modules:\n"
    "    from types import ModuleType as _MT\n"
    "    _m = _MT('langchain_community.chat_models.vertexai')\n"
    "    _m.ChatVertexAI = type('ChatVertexAI', (), {})\n"
    "    sys.modules['langchain_community.chat_models.vertexai'] = _m\n"
)
sc = os.path.join(site.getsitepackages()[0], 'sitecustomize.py')
with open(sc, 'a') as f:
    f.write(stub)
EOF

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
