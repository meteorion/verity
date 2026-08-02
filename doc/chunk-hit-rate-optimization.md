# Chunk 命中率优化方案

> 状态：设计阶段 · 未实现  
> 关联模块：`app/pipeline/chunker.py` · `app/retrieval/hybrid.py` · `app/inference/embedding.py` · `app/inference/rerank.py`

---

## 1. 问题定义

"命中率"在本文档中拆分为两个可量化指标：

| 指标 | 定义 | 当前测量方式 |
|---|---|---|
| **Recall@K** | 问题对应的标准答案所在 chunk 出现在 Top-K 结果中的比例 | Ragas `context_recall` |
| **Precision@K** | Top-K 结果中与问题真正相关的 chunk 占比 | Ragas `context_precision` |

命中率低的根本原因通常落在以下三层：
1. **切块层**：chunk 粒度不合适，关键信息被切断或淹没在过长文本中
2. **召回层**：向量表示能力不足，或混合检索权重不合理
3. **精排层**：reranker 阈值/模型对领域文本的判别能力弱

---

## 2. 切块层优化

### 2.1 父子分块（Parent-Child Chunking）

**现状**：当前 `chunker.py` 按 heading 分节后对超长节按段落二次切分，子块不保留父块引用（`parent_chunk_id` 字段存在但未完整利用）。

**方案**：
- 以 H1/H2 节为**父块**（不参与向量检索，仅用于上下文拼接）
- 以 600 token 以内的段落为**子块**（参与向量检索）
- 检索时命中子块 → 返回子块所属父块的全文给 LLM，保留上下文完整性

```
父块：H2 节完整内容（~2000 token，不入向量索引）
  └─ 子块 A（~500 token，入向量索引）
  └─ 子块 B（~500 token，入向量索引）
  └─ 子块 C（~400 token，入向量索引）
```

**实现要点**：
- `parent_chunk_id` 在 chunker 写库时填充
- 检索结果后处理：将命中的子块替换为父块内容再送给 generate 节点
- 父块不占用 HNSW 索引空间，只需普通 TEXT 存储

**预期收益**：LLM 获得更完整的段落背景，幻觉率下降；不影响召回精度

---

### 2.2 语义切块（Semantic Chunking）

**现状**：按 token 数硬切，跨段落的语义连续性由 overlap 保证，效果有限。

**方案**：在段落级切分前，用 embedding 相似度判断相邻句子是否属于同一语义单元，在相似度断层处切割。

```
句子流 → 滑动窗口计算相邻句余弦相似度 → 相似度 < 阈值处切分
```

**阈值参考**：0.7（需在评估数据集上标定）  
**适用场景**：FAQ、政策类文档（段落之间主题跳跃明显）  
**不适用**：技术手册（连续推理型文本，切断会丢失依赖关系）

---

### 2.3 上下文感知切块（Contextual Chunking）

**灵感来源**：Anthropic Contextual Retrieval 论文

**方案**：为每个 chunk 生成一段 LLM 生成的"定位描述"，将其前置拼入 chunk 内容再做 embedding。

```
原始 chunk：
  "本产品不支持批量退款，需逐笔操作。"

上下文描述（LLM 生成）：
  "本段来自售后退款操作指南第3节，描述批量退款的限制。"

入库内容：
  "本段来自售后退款操作指南第3节，描述批量退款的限制。\n本产品不支持批量退款，需逐笔操作。"
```

**成本**：每个 chunk 需一次 LLM 调用（仅在导入/更新文档时，非检索热路径）  
**预期收益**：Recall@K 提升明显，尤其对短 chunk、跨文档引用类问题

---

### 2.4 切块参数自适应

**现状**：`chunk_size=600`、`chunk_overlap=80` 全局统一。

**方案**：在文档导入时按文档类型动态选择参数：

| 文档类型 | chunk_size | chunk_overlap | 理由 |
|---|---|---|---|
| FAQ / 问答对 | 200 | 0 | 一问一答即一 chunk |
| 政策/条款 | 400 | 60 | 条款独立性强 |
| 技术手册/操作指南 | 800 | 120 | 步骤间有依赖 |
| 产品说明 | 600 | 80 | 当前默认 |

文档类型在导入时由用户标注或 LLM 自动识别。

---

## 3. 召回层优化

### 3.1 HyDE（假设文档嵌入）

**原理**：用户查询往往是短句（"退款流程"），与知识库中的长段落在向量空间分布差异大。HyDE 先让 LLM 生成一段"假设性答案"，用答案的 embedding 做检索，缩小分布差异。

```
查询："退款流程是什么？"
  ↓ LLM 生成假设答案
假设文档："用户申请退款后，需在系统提交退款申请，客服3个工作日内审核..."
  ↓ 对假设文档做 embedding
  ↓ 用该向量检索 chunks
```

**适用条件**：仅当向量召回分数整体偏低（Recall@50 < 0.7）时启用，否则引入额外延迟不值得  
**延迟代价**：+1 次 LLM 调用（~300ms），需在检索前异步并行执行  
**位置**：`retrieval/hybrid.py` 新增 `use_hyde` 开关，由 settings 控制

---

### 3.2 混合检索权重调优

**现状**：RRF（倒数秩融合）等权合并 dense + sparse 结果，权重固定。

**方案**：引入可配置的加权 RRF：

```python
score(chunk) = α / (k + dense_rank) + (1-α) / (k + sparse_rank)
```

- `α` 默认 0.6（偏向语义），通过评估数据集网格搜索确定最优值
- 对"精确术语查询"（含产品型号、数字编码等）自动提升 `α` → 降低（偏向词匹配）
- 触发规则：查询中出现数字/大写缩写/引号内字符串时，`α` 降至 0.3

---

### 3.3 元数据过滤前置

**现状**：`product_line`、`version` 过滤在 SQL WHERE 中执行，但 session 携带的 `product_line` 信息未始终传递到检索层。

**方案**：
- 从 session state 提取 `product_line`、`region` 并强制注入检索参数
- 对未标注版本的 chunk（`version IS NULL`）在过滤时改为"不排除"而非"排除"
- 新增 `effective_from`/`effective_to` 时间范围过滤，过期文档不参与召回

---

### 3.4 Dense 检索分数阈值过滤

**问题**：Dense 检索固定返回 Top-N 条结果，即使排名靠后的 chunk 与查询相关性极低，仍会进入后续流程，引入噪声。

**方案**：在 `_dense_search()` 的 SQL 中加可选的余弦相似度下界过滤：

```sql
SELECT chunk_id, 1 - (embedding <=> $1) AS score, ...
FROM chunks
WHERE ...
  AND 1 - (embedding <=> $1) >= $min_score   -- 新增，默认 0.0（不过滤）
ORDER BY embedding <=> $1
LIMIT $top_vector
```

- `min_score_threshold` 默认 **0.0**（关闭），通过 `settings.json` 配置
- 建议起始值 **0.3**（余弦相似度低于此值说明语义几乎不相关）
- 仅作 sanity filter，不替代 reranker：粗剪明显不相关，精排交给后续

**为何不对 RRF 分数加阈值**：RRF 分数由秩推导（`1/(k+rank)`），不同查询间不可比，无法设置有意义的全局阈值，跳过。

**参数归属**：
```json
// config.txt/app_settings.json
{ "dense_score_threshold": 0.3 }
```
同步加入 `SettingsWrite` / `SettingsRead`，与 `rerank_threshold` 并列。

---

### 3.5 向量索引参数优化

**现状**：HNSW 参数 `m=16, ef_construction=200`，检索时 `ef_search` 未显式设置（使用 pgvector 默认值 40）。

**方案**：
```sql
SET hnsw.ef_search = 100;  -- 检索时设置，提升召回率，代价是查询时间微增
```

在 `_dense_search()` 执行前通过 `conn.execute("SET hnsw.ef_search = 100")` 注入，或在连接池初始化时设置 `server_settings`。

**参考数据**：ef_search 从 40 → 100，Recall@50 通常提升 3-8%，查询延迟增加约 20%。

---

## 4. 精排层优化

### 4.1 Reranker 领域适配

**现状**：`RERANK_PROVIDER=none`（P1 阶段跳过精排）。

**方案（P2）**：
- 启用 BGE-Reranker-v2-m3（中文支持好）
- 使用少量人工标注的"查询-chunk 相关性"对进行 LoRA 微调
- 标注数据来源：已有 eval 数据集中的 ground_truth chunks 作为正样本，随机 chunk 作为负样本

**阈值标定**：在评估集上绘制 Precision-Recall 曲线，选 F1 最高点作为 `RERANK_THRESHOLD`

---

### 4.2 Two-Stage 精排（LLM-as-Reranker）

**方案**：对 Reranker 打分后仍剩余多个相近分值的 chunk，用 LLM 做最终排序（zero-shot listwise reranking）。

```
Prompt：
"以下是检索到的文档片段，请按与问题「{query}」的相关性从高到低排列编号：
[1] {chunk_1}
[2] {chunk_2}
...
只输出编号顺序，如：3,1,2"
```

**适用条件**：仅在 Reranker 分值方差 < 0.05（排名不确定）时触发，避免额外延迟常态化

---

## 5. 评估驱动迭代

以上优化均需通过 Ragas 评估数据集量化收益，迭代顺序建议：

```
基线测量（当前系统指标）
  → 2.1 父子分块（低成本，高收益）
  → 3.4 ef_search 调优（零改动，立竿见影）
  → 3.2 混合检索权重调优（需评估集标定）
  → 2.3 上下文感知切块（需 LLM 调用成本）
  → 3.1 HyDE（需评估召回瓶颈是否在此）
  → 4.x 精排（P2，需 GPU 或 LLM 调用）
```

每轮迭代输出：`Recall@6`、`Recall@50`、`context_precision`、`answer_correctness` 四项指标对比表。

---

## 6. 实现优先级

| 优先级 | 方案 | 实现难度 | 预期收益 |
|---|---|---|---|
| P1 | 3.4 dense_score_threshold 过滤 | 低 | 低（噪声兜底） |
| P1 | 3.5 ef_search 调优 | 低 | 中 |
| P1 | 2.1 父子分块 | 中 | 高 |
| P1 | 3.2 加权 RRF | 低 | 中 |
| P2 | 2.3 上下文感知切块 | 中 | 高 |
| P2 | 3.1 HyDE | 中 | 中（视场景） |
| P2 | 2.2 语义切块 | 高 | 中 |
| P3 | 4.x 精排优化 | 高 | 高（需 GPU） |
