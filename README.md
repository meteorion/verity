# Verity

企业级 RAG 智能客服系统 —— 以检索增强生成（RAG）为核心，将企业私有知识库与大语言模型结合，提供可溯源、低幻觉、知识可热更新的智能问答服务。

---

## 功能简介

### 核心能力

| 功能 | 说明 |
| --- | --- |
| **检索** | P1 单路密集向量检索（本地 Embedding 模型，未经 P0 正式 benchmark）；P2 引入稀疏向量/BM25 双路并发 + RRF 融合 + Cross-Encoder 精排，兼顾语义理解与关键词精确命中 |
| **引用可溯源** | 每条答案强制标注知识来源编号，附文档标题与链接，支持用户点击核查 |
| **幻觉抑制** | 无相关知识不生成；生成后异步 NLI 校验引用真实性；金额/时效正则比对 |
| **知识热更新** | 文档变更事件驱动，文本型文档端到端生效 ≤ 15 分钟，无需重启服务 |
| **多轮对话** | 指代消解 + 滚动摘要，保留最近 5 轮原文上下文 |
| **工具调用** | 订单查询、开票记录、工单创建等实时业务能力通过 Function Calling 接入，结果不写向量库 |
| **转人工** | 情绪识别、连续兜底、高风险关键词等多维度触发，携带会话摘要无缝移交 |
| **FAQ 短路** | 高频标准问题倒排精确匹配，延迟 ≤ 20ms，直出答案不走 LLM |
| **语义缓存** | 相似度 > 0.93 的重复问题直接复用历史答案，显著降低 Token 成本 |
| **ACL 权限** | Chunk 级别权限过滤，在向量库 where 条件执行，防止越权内容进入上下文 |

### 性能指标目标

| 指标 | 目标值 |
| --- | --- |
| 首字延迟 P95 | ≤ 1.5s（有 GPU）/ ≤ 2.5s（纯 CPU） |
| 完整回答 P95 | ≤ 6s |
| 知识更新时效 | ≤ 15min（文本）/ ≤ 30min（扫描 PDF） |
| 自助解决率 | ≥ 55%（P2）→ ≥ 70%（全渠道，后续版本） |
| 答案准确率 | 人工抽检 ≥ 92% |

---

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 编排框架 | [LangGraph](https://github.com/langchain-ai/langgraph) 1.x + [LlamaIndex](https://github.com/run-llama/llama_index)（知识管道，落地中） |
| 大模型 | P1 直连通义千问 `qwen-plus`（DashScope OpenAI 兼容模式，见 `app/inference/llm.py`）；网关方案（LiteLLM vs 直连 SDK）仍待确认，见 [doc/plan.md](doc/plan.md) §3.11 |
| Embedding | P1 本地默认 [paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2)（sentence-transformers，CPU，未经 P0 正式 benchmark，候选见 [doc/plan.md](doc/plan.md) §3.2），只出密集向量 |
| Rerank | P1 暂不引入（向量相似度排序直出，见 [doc/plan.md](doc/plan.md) §3.3），P2 视召回效果评估 BGE-Reranker-v2-m3 |
| 向量库 | [PGVector](https://github.com/pgvector/pgvector)（PostgreSQL 扩展） |
| 会话/缓存 | P1 应用内存（单实例），P2 切 [Redis Stack](https://redis.io/docs/stack/)（多实例会话 + 语义缓存） |
| 文档解析 | [Marker](https://github.com/VikParuchuri/marker)（文字 PDF）/ [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)（扫描件），落地中，见下方"知识入库" |
| NLI 校验 | P1 暂不引入（P2 幻觉抑制专项，见 §3.8），届时用 [chinese-roberta-wwm-ext](https://huggingface.co/hfl/chinese-roberta-wwm-ext)（异步，CPU） |
| 意图分类 | FastText fine-tune（CPU，< 5ms），落地中，P1 先固定返回 `rag` |
| 内容安全 | P1 本地敏感词词典（`SAFETY_BLOCKLIST` 逗号分隔，零成本），P2 视红队结果叠加商用 API |
| LLM 网关 | 待确认（暂不确定使用 [LiteLLM](https://github.com/BerriAI/litellm)，见 [doc/plan.md](doc/plan.md) §3.11） |
| 可观测 | P1 结构化日志，P2 引入 [Langfuse](https://langfuse.com) + OpenTelemetry + Prometheus + Grafana |
| 部署 | Docker Compose（单机） |
| 运行时 | Python ≥ 3.12 |

---

## 项目结构

```
verity/
├── docker-compose.yml          # 单机部署（6 个容器）
├── .env.example                # 环境变量模板
├── pyproject.toml
│
├── app/                        # 单服务源码（V1 Monolith）
│   ├── main.py                 # FastAPI 入口，挂载所有路由
│   ├── Dockerfile
│   ├── api/
│   │   ├── chat.py             # POST /v1/chat（SSE 流式对话）
│   │   ├── pipeline.py         # POST /api/pipeline/ingest（文档入库）
│   │   └── ops.py              # 运营后台 API（文档管理）
│   ├── graph/
│   │   ├── state.py            # OrchestratorState TypedDict
│   │   ├── graph.py            # LangGraph 状态图定义
│   │   └── nodes/              # safety / faq / intent / rag / tool / generate / transfer
│   ├── retrieval/
│   │   ├── hybrid.py           # P1 单路 dense 检索；RRF 混合检索（+ sparse）P2 引入
│   │   ├── cache.py            # 语义缓存（Redis Stack）
│   │   └── small_to_big.py     # 父级 chunk 回查（本地 FS）
│   ├── pipeline/
│   │   ├── parser/             # pdf.py / word.py / markdown.py
│   │   ├── chunker.py          # 层级切分 + 面包屑注入
│   │   ├── embedder.py         # 批量向量化（调用 inference）
│   │   └── indexer.py          # PGVector 写库
│   ├── db.py                    # PGVector 幂等 DDL（chunks 表 + HNSW 索引）
│   ├── scripts/
│   │   └── seed_dummy_chunks.py # 手动灌 dummy chunk，管道没写完前先验证问答链路
│   └── inference/
│       ├── embedding.py        # 本地 sentence-transformers（进程内加载，可插拔 backend）
│       ├── llm.py              # 直连 Qwen 生成调用（可插拔，见 doc/plan.md §3.11）
│       ├── rerank.py           # BGE-Reranker（P2，ENABLE_RERANK 开关）
│       └── nli.py              # chinese-roberta NLI（P2，ENABLE_NLI 开关）
│
├── config/
│   ├── nginx.conf
│   └── litellm.yaml            # LLM 网关路由参考配置（是否采用待确认，见 doc/plan.md §3.11）
│
├── models/                     # P2 模型文件（不提交 Git）；P1 的 Embedding 模型走 HF 缓存，不放这里
│   ├── bge-reranker-v2-m3/     # 仅 ENABLE_RERANK=true 时需要
│   └── chinese-roberta-nli/    # 仅 ENABLE_NLI=true 时需要
│
├── data/rag/                   # 运行时知识文件（不提交 Git）
│   ├── raw/                    # 原始上传文档
│   ├── chunks/                 # 父级 chunk 文件（Small-to-Big）
│   ├── parsed/                 # 解析中间产物
│   └── ocr_queue/              # 低置信图片，等待人工审核
│
├── volumes/                    # Docker 持久卷（不提交 Git）
│   ├── postgres/
│   └── redis/
│
├── frontend/                   # Vue 3 + Vite 运营后台
│   ├── src/
│   │   ├── views/              # Documents.vue / Metrics.vue / ChatTest.vue
│   │   ├── api/                # axios 封装
│   │   ├── App.vue
│   │   └── router.js
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
│
├── scripts/
│   ├── eval_retrieval.py       # Recall@K 评测
│   └── eval_generation.py      # LLM-as-Judge 评测
│
└── doc/
    ├── design.md               # 系统设计方案
    ├── arch.md                 # 架构设计文档
    └── plan.md                 # 执行方案规划
```

---

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [doc/design.md](doc/design.md) | 业务背景、为什么选 RAG、总体架构、知识层/检索层/生成层详细设计、评估体系、安全合规、知识运营机制 |
| [doc/arch.md](doc/arch.md) | C4 上下文图、服务拆分与接口规范、LangGraph 状态机、存储 Schema、单机 Docker Compose 部署、安全架构、告警规则 |
| [doc/plan.md](doc/plan.md) | 技术栈选型细节（含 benchmark 方法）、P0~P3 阶段任务拆解、阶段门控验收指标、风险登记册 |

---

## 快速开始

> **当前状态**：P1 问答链路（安全过滤 → FAQ → 向量检索 → LLM 生成 → SSE 流式输出）已跑通，
> 知识入库管道（文档解析/切分，见 `pipeline/parser`、`chunker.py`）仍是 TODO 占位，
> 检索前先用 `scripts/seed_dummy_chunks.py` 手动灌几条数据，见下方"验证问答链路"。

### 前置条件

- Docker & Docker Compose v2
- Python 3.12+（本地开发）
- 通义千问 API Key（[DashScope 控制台](https://dashscope.console.aliyun.com/)申请），P1 生成节点必需
- 不需要 GPU：本地 Embedding 和生成调用都是 CPU / 远程 API

### 环境配置

```bash
cp .env.example .env
# 编辑 .env，填入以下必要配置：
#   QWEN_API_KEY           DashScope API Key，generate_node 直接依赖它
#   POSTGRES_PASSWORD      数据库密码
```

### 下载模型

P1 默认的本地 Embedding 模型（`EMBEDDING_MODEL_PATH`，见 `.env.example`）首次启动时由
sentence-transformers 自动从 HF Hub 下载到容器内缓存，不需要手动下载，但首次启动需要网络访问。

以下两个模型只在对应能力打开时才需要，P1 不必下载：

```bash
# BGE-Reranker-v2-m3 —— 仅当 .env 里 ENABLE_RERANK=true 时需要（P2，见 doc/plan.md §3.3）
huggingface-cli download BAAI/bge-reranker-v2-m3 --local-dir ./models/bge-reranker-v2-m3

# NLI 校验模型 —— 仅当 .env 里 ENABLE_NLI=true 时需要（P2，见 doc/plan.md §3.8）
huggingface-cli download hfl/chinese-roberta-wwm-ext --local-dir ./models/chinese-roberta-nli
```

### 启动服务

```bash
# P1 最小成本启动：只起 postgres + app，镜像也只装当前代码用得到的最小依赖
# （FlagEmbedding/transformers/torch/redis/langfuse 等重依赖默认不装，见 app/Dockerfile）
docker compose up -d

# 需要 Rerank/NLI（ENABLE_RERANK/ENABLE_NLI=true）等 P2 重依赖时，构建镜像加这个 build-arg：
# docker compose build --build-arg INSTALL_P2_DEPS=true app

# 查看各服务状态
docker compose ps

# 查看应用服务日志
docker compose logs -f app

# 需要 redis / litellm / langfuse / nginx（P2+ 能力）时，加 profile 一起拉起：
docker compose --profile p2 up -d
```

### 访问入口

| 地址 | 说明 |
| --- | --- |
| `http://localhost:8000` | 应用服务（API + `/health`），P1 直接访问，不经 nginx |
| `http://localhost:8080` | 知识运营后台（文档管理，前端 dev server 或后续接入 nginx） |
| `http://localhost:3000` | Langfuse（P2+，`--profile p2` 才会起） |
| `http://localhost:4000` | LiteLLM 网关（P2+，是否采用待确认，`--profile p2` 才会起） |

---

## 开发说明

### 本地运行（不经 Docker）

代码按 `app/` 为 import 根目录组织（`from graph...`、`from inference...`），不是一个可
`pip install -e .` 的分发包，依赖直接装：

```bash
cd app
pip install fastapi "uvicorn[standard]" langgraph asyncpg pgvector httpx \
  pydantic pydantic-settings "typing-extensions>=4.12" sentence-transformers openai
uvicorn main:app --reload --port 8000
```

### 验证问答链路

知识入库管道（解析/切分）还是 TODO 占位，检索前先手动灌几条 dummy chunk：

```bash
docker compose exec app python scripts/seed_dummy_chunks.py

curl -N -X POST http://localhost:8000/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"session_id": "s_test_0001", "message": "生鲜坏了还能退吗"}'
# SSE 输出：一串 {"type":"token",...}，最后一条 {"type":"done","citations":[...]}
```

### 知识入库（管道未完成，接口已就绪）

```bash
# pipeline/parser、chunker.py 目前是 TODO 占位（见 doc/plan.md §5.1），
# 调这个接口不会报错，但产出的 chunk 是空的，实际验证请用上面的 seed 脚本
curl -X POST http://localhost:8000/api/pipeline/ingest \
  -F "file=@/path/to/document.pdf" \
  -F "doc_id=doc_001" \
  -F "owner=ops@example.com" \
  -F "business_line=retail"
```

### 运行评测

```bash
# 在金标数据集上跑 Recall@5 回归
python scripts/eval_retrieval.py --dataset data/gold_standard_v1.jsonl

# 跑生成质量评测（LLM-as-Judge）
python scripts/eval_generation.py --dataset data/gold_standard_v1.jsonl
```

---

## 许可证

[MIT](LICENSE)
