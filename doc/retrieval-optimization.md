# 检索质量优化方案

> 状态：部分已实现（见各节标注）  
> 关联模块：`app/pipeline/chunker.py` · `app/retrieval/hybrid.py` · `app/retrieval/small_to_big.py` · `app/retrieval/cache.py` · `app/inference/embedding.py` · `app/inference/rerank.py` · `app/inference/llm.py`

---

## 1. 目标与指标

检索质量通过以下两个指标量化，均由 Ragas 评估框架计算：

| 指标 | 定义 | 对应 Ragas 指标 |
|---|---|---|
| **Recall@K** | 标准答案所在 chunk 出现在 Top-K 结果中的比例 | `context_recall` |
| **Precision@K** | Top-K 中与问题真正相关的 chunk 占比 | `context_precision` |

命中率低的根本原因可分为四层：

| 层 | 问题 |
|---|---|
| 切块层 | chunk 粒度不合适，关键信息被切断或淹没在过长文本中 |
| 查询层 | 用户表述口语化、含指代词、多跳，与知识库向量分布差距大 |
| 召回层 | 向量表示能力不足，或混合检索权重不合理 |
| 精排层 | reranker 阈值/模型对领域文本的判别能力弱 |

---

## 2. 切块层优化

### 2.1 父子分块（Parent-Child Chunking）✅ 已实现

**实现状态**：`chunker.py` 已完整实现。超长节写一条 `is_parent=TRUE` 的父 chunk（`chunk_index=-1`，不做 embedding），子块通过 `parent_chunk_id` 关联；`small_to_big.py` 负责检索命中后回查父块内容。

```
父块：H2 节完整内容（is_parent=TRUE，存 chunks 表，不入向量索引）
  └─ 子块 A（is_parent=FALSE，入向量索引）
  └─ 子块 B（is_parent=FALSE，入向量索引）
  └─ 子块 C（is_parent=FALSE，入向量索引）
```

**预期收益**：LLM 获得更完整的段落背景，幻觉率下降；不影响召回精度

---

### 2.2 上下文感知切块（Contextual Chunking）

**灵感来源**：Anthropic Contextual Retrieval 论文

**方案**：为每个 chunk 用 LLM 生成一段"定位描述"，前置拼入 chunk 内容再做 embedding。

```
原始 chunk：
  "本产品不支持批量退款，需逐笔操作。"

上下文描述（LLM 生成）：
  "本段来自售后退款操作指南第3节，描述批量退款的限制。"

入库内容：
  "本段来自售后退款操作指南第3节，描述批量退款的限制。\n本产品不支持批量退款，需逐笔操作。"
```

**成本**：每个 chunk 一次 LLM 调用，仅在导入/更新文档时，不影响检索热路径  
**预期收益**：Recall@K 提升明显，尤其对短 chunk、跨文档引用类问题

---

### 2.3 语义切块（Semantic Chunking）

**现状**：按 token 数硬切，跨段落的语义连续性由 overlap 保证，效果有限。

**方案**：在段落级切分前，用 embedding 相似度判断相邻句子是否属于同一语义单元，在相似度断层处切割。

```
句子流 → 滑动窗口计算相邻句余弦相似度 → 相似度 < 阈值处切分
```

**阈值参考**：0.7（需在评估数据集上标定）  
**适用场景**：FAQ、政策类文档（段落间主题跳跃明显）  
**不适用**：技术手册（连续推理型文本，切断会丢失依赖关系）

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

文档类型在导入时由用户标注或 LLM 自动识别（`use_llm_structure=true` 时已支持识别 doc_type）。

---

## 3. 查询层优化

### 3.1 查询规范化（Normalization）

轻量级预处理，不需要 LLM 调用：

1. **错别字纠正**：维护领域常见错别字词典，或接入文字纠错 API
2. **同义词扩展**：维护领域同义词表（`config/synonyms.json`），对关键词做同义词替换
   ```json
   { "退货": ["退款", "7天无理由", "换货"], "发票": ["收据", "开票"] }
   ```
3. **停用词过滤**：移除"我想知道"、"请问"、"能不能告诉我"等无信息量前缀
4. **数字规范化**："七天" → "7天"，"一百元" → "100元"

---

### 3.2 上下文感知改写（Coreference Resolution）

**问题**：多轮对话中，用户查询含指代词（"它"、"这个"、"上面说的"）或省略主语，单轮检索无法处理。

**方案**：在检索前用 LLM 将查询与近 N 轮对话历史合并，生成自包含的独立问题。

```
对话历史：
  U: 你们有退款政策吗？
  A: 有，支持7天无理由退款...
  U: 那换货呢？              ← 原始查询

改写后：
  "你们支持换货吗？换货的政策是什么？"
```

**触发条件**（满足全部时触发）：
- 查询长度 < 10 字
- 对话历史 ≥ 1 轮
- 查询含指代词（"它"、"这"、"那"、"上面"、"刚才"等）或疑问词开头

**Prompt 模板**：
```
你是一个查询改写助手。根据对话历史，将用户最新的问题改写为可独立理解的完整问题。
只输出改写后的问题，不要解释。如果问题已经完整，原样输出。

对话历史：
{history}

用户最新问题：{query}
```

---

### 3.3 多查询展开（Multi-Query）

**问题**：单一查询存在召回盲区，用户表述可能不是检索知识库的最优角度。

**方案**：用 LLM 将原始查询改写为 N 个不同角度的子查询，分别检索后合并去重。

```
原始查询："换货流程"

展开为：
  1. "如何申请换货？"
  2. "换货需要什么条件？"
  3. "换货需要多少天？"
  4. "换货和退货有什么区别？"

各子查询独立检索 → RRF 合并结果
```

**实现要点**：
- N 默认 3（边际收益递减，延迟线性增加）
- 子查询检索**并行**执行（`asyncio.gather`）
- 合并时用 RRF 融合，以 `chunk_id` 为键去重
- 仅对复杂问题启用（查询含连词"和"/"与"/"或"，或长度 > 20 字）

**延迟代价**：+1 次 LLM 调用 + N 次并行检索，总增加约 300-500ms

---

### 3.4 Step-Back Prompting（后退提问）

**问题**：用户问具体细节，知识库存储的是通用原则，向量距离远。

**方案**：将具体问题"后退"为更通用的父问题，用父问题检索通用知识，再与具体问题检索结果合并。

```
具体问题："我买的 X500 型号在新疆可以退货吗？"

后退问题："退货的地区限制政策是什么？"

检索策略：
  后退问题检索 → 通用政策 chunk
  + 原始问题检索 → 产品/地区特殊规则 chunk
  合并送给 LLM
```

**触发条件**：查询中含有具体专有名词（产品型号、地名、人名）

---

### 3.5 语义缓存（Semantic Cache）✅ hash 缓存已接入，向量模糊命中待完善

**实现状态**：`app/retrieval/cache.py` hash 精确匹配已接入 `hybrid_retrieve()`（`cache_get` 开头查询，`cache_set` 返回前写入）；`SEMANTIC_CACHE_THRESHOLD` 配置存在，但基于向量相似度的模糊命中逻辑尚未实现（P2 TODO）。

**完整方案（P2）**：
```
用户查询 Q
  → embedding → 向量 v
  → Redis 查找余弦相似度 ≥ 0.93 的历史查询
  → 命中：直接返回缓存回答（跳过检索和 LLM）
  → 未命中：正常 RAG，完成后将 (v, answer) 写入 Redis（TTL=24h）
```

**缓存失效策略**：
- TTL 24h（防止过期知识被命中）
- 文档导入/删除时清空对应 product_line 的缓存条目
- 管理后台提供"清空全部缓存"按钮

---

### 3.6 多问法扩充索引（Question Augmentation）✅ 表结构+检索已实现，生成逻辑待实现

**实现状态**：`app/db.py` 已建 `question_embeddings` 表（含 HNSW 索引），`hybrid.py` 已有 `_question_search()`。批量生成问法并写入的管理接口尚未实现（P3 TODO）。

**方案**：文档导入时，为每个 chunk 用 LLM 生成 K 个可能的用户问法，将问法的 embedding 与 chunk 关联存储：

```
chunk 内容："退款将在3-5个工作日内原路返还至您的支付账户。"

生成问法：
  1. "退款多久到账？"
  2. "申请退款后几天能收到钱？"
  3. "退款会退到哪里？"
  4. "退款到账时间"

将以上4个问法的 embedding 存入 question_embeddings 表，关联同一个 chunk_id
检索时同时查 chunks 和 question_embeddings，取并集（_question_search 已实现）
```

**存储结构**（已落地）：
```sql
CREATE TABLE question_embeddings (
    id          BIGSERIAL PRIMARY KEY,
    chunk_id    TEXT NOT NULL REFERENCES chunks(chunk_id) ON DELETE CASCADE,
    question    TEXT NOT NULL,
    embedding   vector(384),          -- 维度由 EMBEDDING_DIM 控制
    created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON question_embeddings USING hnsw (embedding vector_cosine_ops);
```

**成本**：每个 chunk K=4 个问法，导入时一次性付出，不影响检索延迟

---

### 3.7 FAQ 精确匹配层

**方案**：维护 `faq_questions` 表，每条 FAQ 存储问题的 embedding，检索前先做 FAQ 匹配：

```
查询 → 与 FAQ embedding 库匹配
  → 相似度 ≥ 0.96：直接返回 FAQ 答案（不走 RAG）
  → 0.80 ~ 0.96：FAQ 答案作为候选上下文注入 RAG 结果
  → 相似度 < 0.80：正常 RAG
```

**数据管理**：管理后台新增 FAQ 维护页面，支持批量导入问答对

---

### 3.8 意图感知检索路由

**方案**：intent 节点分类结果注入检索参数，不同意图采用不同策略：

| 意图 | 检索策略 |
|---|---|
| `faq` | 优先 FAQ 精确匹配 → 语义缓存 → RAG |
| `product_inquiry` | 启用 product_line 元数据过滤 + 多查询展开 |
| `after_sales_refund` | 启用 Step-Back + 时效过滤（最新政策优先） |
| `complaint` | 跳过 RAG，直接转人工 |
| `chitchat` | 跳过 RAG，直接 LLM 生成 |

---

## 4. 召回层优化

### 4.1 混合检索权重调优 ✅ 已实现

**实现状态**：`hybrid.py` 已支持 `rrf_alpha` 参数（通过 `settings.json` 配置，默认 0.5）。

```python
score(chunk) = α / (k + dense_rank) + (1-α) / (k + sparse_rank)
```

- `α` 默认 0.5，通过评估数据集网格搜索标定最优值（0.6 偏向语义，0.3 偏向词匹配）
- 查询含数字/大写缩写/引号字符串时自动降低 `α` 的逻辑尚未实现（P2 TODO）

---

### 4.2 元数据过滤前置

**现状**：`product_line`、`version` 过滤在 SQL WHERE 中执行，但 session 携带的 `product_line` 未始终传递到检索层。

**方案**：
- 从 session state 强制提取 `product_line`、`region` 注入检索参数
- 对未标注版本的 chunk（`version IS NULL`）改为"不排除"而非"排除"
- 强制启用 `effective_from`/`effective_to` 时间范围过滤，过期文档不参与召回

---

### 4.3 Dense 检索分数阈值过滤 ✅ 已实现

**实现状态**：`hybrid.py` `_dense_search()` 已支持 `dense_score_threshold` 参数，通过 `settings.json` 配置（默认 0.0，即关闭）。

```sql
SELECT chunk_id, 1 - (embedding <=> $1) AS score, ...
FROM chunks
WHERE ...
  AND 1 - (embedding <=> $1) >= $min_score   -- 默认 0.0（不过滤）
ORDER BY embedding <=> $1
LIMIT $top_vector
```

- 建议起始值 **0.3**（余弦相似度低于此值说明语义几乎无关）
- 仅作 sanity filter，不替代 reranker；粗剪明显不相关，精排交给后续

> **为何不对 RRF 分数加阈值**：RRF 分数由秩推导（`1/(k+rank)`），跨查询不可比，无法设有意义的全局阈值。

---

### 4.4 向量索引参数优化 ✅ 已实现

**实现状态**：`hybrid.py` `_dense_search()` 在事务开始时执行 `SET LOCAL hnsw.ef_search = N`（通过 `settings.json` 的 `hnsw_ef_search` 配置，默认 100）。

**参考数据**：ef_search 从 40 → 100，Recall@50 通常提升 3-8%，查询延迟增加约 20%。

---

### 4.5 HyDE（假设文档嵌入）

**原理**：用户查询往往是短句（"退款流程"），与知识库中长段落的向量分布差异大。HyDE 先让 LLM 生成"假设性答案"，用答案的 embedding 做检索，缩小分布差距。

```
查询："退款流程是什么？"
  ↓ LLM 生成假设答案
假设文档："用户申请退款后，需在系统提交退款申请，客服3个工作日内审核..."
  ↓ 对假设文档做 embedding
  ↓ 用该向量检索 chunks
```

**适用条件**：仅当向量召回整体偏低（Recall@50 < 0.7）时启用，否则额外延迟不值得  
**延迟代价**：+1 次 LLM 调用（~300ms），需在检索前异步并行执行  
**实现位置**：`retrieval/hybrid.py` 新增 `use_hyde` 开关，由 settings 控制

---

## 5. 精排层优化

### 5.1 Reranker 领域适配

**现状**：`RERANK_PROVIDER=none`（P1 阶段跳过精排）。

**方案（P2）**：
- 启用 BGE-Reranker-v2-m3（中文支持好）
- 使用少量人工标注的"查询-chunk 相关性"对进行 LoRA 微调
- 标注数据：eval 数据集中的 ground_truth chunks 作正样本，随机 chunk 作负样本

**阈值标定**：在评估集上绘制 Precision-Recall 曲线，选 F1 最高点作为 `RERANK_THRESHOLD`

---

### 5.2 Two-Stage 精排（LLM-as-Reranker）

**方案**：Reranker 打分后仍有多个相近分值的 chunk 时，用 LLM 做最终排序（zero-shot listwise reranking）。

```
Prompt：
"以下是检索到的文档片段，请按与问题「{query}」的相关性从高到低排列编号：
[1] {chunk_1}
[2] {chunk_2}
...
只输出编号顺序，如：3,1,2"
```

**触发条件**：仅在 Reranker 分值方差 < 0.05（排名不确定）时触发，避免额外延迟常态化

---

## 6. 整体检索流程

```
用户输入 query
    │
    ├─ [预处理] 规范化 / 错别字纠正 / 停用词过滤（3.1）
    │
    ├─ [语义缓存] hash 命中 → 直接返回；向量模糊命中（P2）（3.5）
    │
    ├─ [FAQ 精确匹配] 命中(≥0.96) → 直接返回
    │                命中(0.80~0.96) → 结果注入后续检索（3.7）
    │
    ├─ [查询改写]
    │     ├─ 上下文感知改写（多轮指代解析）（3.2）
    │     ├─ 多查询展开（复杂问题）（3.3）
    │     └─ Step-Back（含专有名词）（3.4）
    │
    ├─ [意图路由] 选择检索策略（3.8）
    │
    ├─ [混合检索] dense（+score阈值过滤）+ sparse（+ef_search调优）
    │             + question_embeddings，加权 RRF 合并（4.1/4.3/4.4/3.6）
    │
    ├─ [Small-to-Big] 子 chunk 命中 → 回查父 chunk 完整内容（2.1）
    │
    ├─ [精排] BGE-Reranker（P2）+ LLM listwise（P3）（5.x）
    │
    └─ [生成] LLM 生成回答
```

---

## 7. 综合优先级

| 优先级 | 方案 | 状态 | 预期收益 |
|---|---|---|---|
| P1 | 2.1 父子分块 | ✅ 已实现 | 高 |
| P1 | 3.5 语义缓存（hash 精确匹配，已接入检索路径） | ✅ 已实现 | 高（降本+提速） |
| P1 | 3.6 多问法扩充索引（表结构+检索） | ✅ 已实现 | 高（待填充数据） |
| P1 | 4.1 加权 RRF | ✅ 已实现 | 中 |
| P1 | 4.3 dense_score_threshold | ✅ 已实现 | 低（噪声兜底） |
| P1 | 4.4 ef_search 调优 | ✅ 已实现 | 中 |
| P2 | 3.1 查询规范化 | 待实现 | 低（基础保障） |
| P2 | 3.2 上下文感知改写 | 待实现 | 高（多轮场景必需） |
| P2 | 3.5 语义缓存向量模糊命中 | 待实现 | 中（P1 hash 补充） |
| P2 | 3.7 FAQ 精确匹配层 | 待实现 | 中 |
| P2 | 3.3 多查询展开 | 待实现 | 中 |
| P2 | 3.8 意图感知检索路由 | 待实现 | 中 |
| P2 | 4.1 α 自适应（术语查询降 α） | 待实现 | 中 |
| P2 | 2.2 上下文感知切块 | 待实现 | 高（但需 LLM 成本） |
| P2 | 4.5 HyDE | 待实现 | 中（视召回瓶颈） |
| P3 | 3.6 多问法批量生成管理接口 | 待实现 | 高（数据填充） |
| P3 | 2.3 语义切块 | 待实现 | 中 |
| P3 | 2.4 切块参数自适应 | 待实现 | 中 |
| P3 | 3.4 Step-Back Prompting | 待实现 | 中（场景有限） |
| P3 | 5.x 精排优化 | 待实现 | 高（需 GPU） |

---

## 8. 评估方案

每项优化上线前后在同一评估数据集上对比以下指标：

| 指标 | 工具 | 说明 |
|---|---|---|
| `context_recall` | Ragas | 是否召回了正确 chunk |
| `context_precision` | Ragas | Top-K 中无关 chunk 的比例 |
| `answer_correctness` | Ragas | 最终回答质量 |
| P95 延迟 | 压测日志 | 改写/缓存等优化引入的延迟代价 |
| 缓存命中率 | Redis INFO | 语义缓存实际收益 |
| LLM 调用次数 | 埋点统计 | 成本变化 |

**建议迭代顺序**（按已有实现验证 → 依次推进）：

```
基线测量（当前系统指标：Recall@6 / Recall@50 / context_precision）
  → 验证已实现的 4 项 P1 优化是否生效
  → 3.2 上下文感知改写（多轮场景命中率瓶颈）
  → 4.1 α 自适应（在评估集上标定最优 rrf_alpha）
  → 2.2 上下文感知切块（成本较高，优先看 LLM 成本预算）
  → 4.5 HyDE（仅当 Recall@50 < 0.7 时才值得启用）
  → 5.x 精排（P2，需 GPU 或 LLM 预算）
```
