FROM python:3.12-slim

WORKDIR /app

# System deps for Marker (poppler) and PaddleOCR (libglib2)
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils libglib2.0-0 libsm6 libxext6 curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    fastapi==0.115.* \
    uvicorn[standard]==0.32.* \
    langgraph==0.2.* \
    langchain-anthropic==0.3.* \
    langfuse==2.* \
    llama-index-core==0.12.* \
    FlagEmbedding==1.3.* \
    transformers==4.47.* \
    torch==2.5.* --index-url https://download.pytorch.org/whl/cpu \
    marker-pdf==1.* \
    asyncpg==0.30.* \
    pgvector==0.3.* \
    redis[hiredis]==5.* \
    httpx==0.28.* \
    pydantic==2.* \
    pydantic-settings==2.*

COPY . .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
