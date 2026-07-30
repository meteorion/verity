# Verity

企业级 RAG 智能客服系统 —— 以检索增强生成（RAG）为核心，将企业私有知识库与大语言模型结合，提供可溯源、低幻觉、知识可热更新的智能问答服务。

---

## 功能简介

### 核心能力

| 功能 | 说明 |
| --- | --- |
| **混合检索** | BGE-M3 密集向量 + 稀疏向量双路并发，RRF 融合后 Cross-Encoder 精排，兼顾语义理解与关键词精确命中 |
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
| 编排框架 | [LangGraph](https://github.com/langchain-ai/langgraph) + [LlamaIndex](https://github.com/run-llama/llama_index)（知识管道） |
| 大模型 | Claude Sonnet API（LiteLLM 统一网关代理，支持 fallback） |
| Embedding | [BGE-M3](https://huggingface.co/BAAI/bge-m3)（密集 + 稀疏双输出） |
| Rerank | [BGE-Reranker-v2-m3](https://huggingface.co/BAAI/bge-reranker-v2-m3) |
| 向量库 | [PGVector](https://github.com/pgvector/pgvector)（PostgreSQL 扩展） |
| 缓存 | [Redis Stack](https://redis.io/docs/stack/)（会话状态 + 语义缓存） |
| 文档解析 | [Marker](https://github.com/VikParuchuri/marker)（文字 PDF）/ [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)（扫描件） |
| NLI 校验 | [chinese-roberta-wwm-ext](https://huggingface.co/hfl/chinese-roberta-wwm-ext)（异步，CPU） |
| 意图分类 | FastText fine-tune（CPU，< 5ms） |
| LLM 网关 | [LiteLLM](https://github.com/BerriAI/litellm) |
| 可观测 | [Langfuse](https://langfuse.com)（Trace）+ OpenTelemetry + Prometheus + Grafana |
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
│   │   ├── hybrid.py           # RRF 混合检索（dense + sparse）
│   │   ├── cache.py            # 语义缓存（Redis Stack）
│   │   └── small_to_big.py     # 父级 chunk 回查（本地 FS）
│   ├── pipeline/
│   │   ├── parser/             # pdf.py / word.py / markdown.py
│   │   ├── chunker.py          # 层级切分 + 面包屑注入
│   │   ├── embedder.py         # 批量向量化（调用 inference）
│   │   └── indexer.py          # PGVector 写库
│   └── inference/
│       ├── embedding.py        # BGE-M3（进程内加载）
│       ├── rerank.py           # BGE-Reranker（进程内加载）
│       └── nli.py              # chinese-roberta NLI（异步，CPU）
│
├── config/
│   ├── nginx.conf
│   └── litellm.yaml            # LLM 网关路由（含 fallback）
│
├── models/                     # 本地模型文件（不提交 Git）
│   ├── bge-m3/
│   ├── bge-reranker-v2-m3/
│   └── chinese-roberta-nli/
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

> **当前状态**：项目处于设计阶段，服务代码尚未实现。以下为目标启动流程。

### 前置条件

- Docker & Docker Compose v2
- Python 3.12+（本地开发）
- （推荐）NVIDIA GPU，驱动 ≥ 535，安装 [nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)

### 环境配置

```bash
cp .env.example .env
# 编辑 .env，填入以下必要配置：
#   ANTHROPIC_API_KEY      Claude API 密钥
#   POSTGRES_PASSWORD      数据库密码
#   RERANK_THRESHOLD       Rerank 阈值（P0 阶段实测标定后填入）
```

### 下载模型

```bash
# BGE-M3
huggingface-cli download BAAI/bge-m3 --local-dir ./models/bge-m3

# BGE-Reranker-v2-m3
huggingface-cli download BAAI/bge-reranker-v2-m3 --local-dir ./models/bge-reranker-v2-m3

# NLI 校验模型
huggingface-cli download hfl/chinese-roberta-wwm-ext --local-dir ./models/chinese-roberta-nli
```

### 启动服务

```bash
# 启动全部服务（按依赖顺序自动处理）
docker compose up -d

# 查看各服务状态
docker compose ps

# 查看编排服务日志
docker compose logs -f orchestration
```

### 访问入口

| 地址 | 说明 |
| --- | --- |
| `https://localhost` | 用户 Web 客服界面 |
| `http://localhost:8080` | 知识运营后台（文档管理） |
| `http://localhost:3000` | Langfuse（Trace 可视化，建议限内网） |
| `http://localhost:4000` | LiteLLM 网关（API 文档） |

---

## 开发说明

### 运行单个服务（本地开发）

```bash
cd services/retrieval
pip install -e ".[dev]"
uvicorn main:app --reload --port 8002
```

### 知识入库

```bash
# 将文档放入 data/rag/raw/ 后，通过知识运营后台上传
# 或直接调用管道服务 API：
curl -X POST http://localhost:8004/ingest \
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
