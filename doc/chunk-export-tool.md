# Chunk 导出工具设计方案

## 目标

提供一个独立工具接口：上传文档 → LLM 解析成标准 RAG 文档结构 → 拆分为 chunks → 按选定格式（JSON/CSV）返回，**不写入数据库**。供业务方在正式索引前预览和校对 chunk 质量。

---

## API 设计

```
POST /v1/tools/chunk-export
Content-Type: multipart/form-data
```

### 请求参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `file` | File | 必填 | 支持 PDF / DOCX / MD / TXT |
| `format` | string | `json` | `json` 或 `csv` |
| `chunk_size` | int | settings | 覆盖全局 chunk_size |
| `chunk_overlap` | int | settings | 覆盖全局 chunk_overlap |
| `use_llm_structure` | bool | `true` | 是否调用 LLM 提取文档结构 |
| `doc_id` | string | 文件名 | 文档唯一标识，不填则由文件名生成 |
| `doc_type` | string | `null` | FAQ / 操作手册 / 政策说明 / 合同模板 |
| `category` | string | `null` | 业务分类，如 退款 / 发货 / 会员 |
| `source_url` | string | — | 见下方字段默认值策略 |
| `product_line` | string | `global` | 逗号分隔，如 `product_a,product_b` |
| `region` | string | `global` | 逗号分隔，如 `cn,hk` |
| `acl` | string | `role:public` | 逗号分隔，如 `role:agent,role:public` |
| `version` | string | `v1.0` | 文档版本号 |
| `effective_from` | string | `null` | ISO8601 生效开始时间，不填不设置 |
| `effective_to` | string | `null` | ISO8601 生效结束时间，不填不设置 |
| `tags` | string | `null` | 逗号分隔自由标签 |

### 字段默认值策略

```
source_url:
  1. 用户在导入时填写  → 直接使用
  2. 未填写            → LLM 从文档内容提取（识别封面页、页眉页脚中的 URL）
  3. LLM 无法提取      → 不设置（null）

product_line:  用户填写 → 默认 ["global"]
region:        用户填写 → 默认 ["global"]
acl:           用户填写 → 默认 ["role:public"]
version:       用户填写 → 默认 "v1.0"
effective_from: 用户填写 → 不设置（null）
effective_to:   用户填写 → 不设置（null）
```

### 响应

- `Content-Disposition: attachment; filename="chunks.json"` 或 `chunks.csv`
- 同步返回（文档较大时前端显示 loading）

---

## 处理流程

```
上传文件
   │
   ▼
1. 格式解析（复用 pipeline/parser）
   PDF → pymupdf → Markdown
   DOCX → python-docx → Markdown
   MD/TXT → 直接使用
   │
   ▼
2. LLM 结构化（新增，use_llm_structure=true 时启用）
   输入：原始文本
   输出：结构化 Markdown（标准标题层级 + 元数据注释）
   │
   ▼
3. 清洗（复用 pipeline/cleaner）
   │
   ▼
4. 分块（复用 pipeline/chunker._parse_sections + _split_section）
   生成 Chunk 对象列表（不含 embedding）
   │
   ▼
5. 格式化输出
   JSON：Chunk 字段列表
   CSV：chunk_index, title, breadcrumb, content, tokens_est
```

---

## LLM 结构化提示词（步骤 2）

```
你是文档结构化专家。将以下文档整理为规范的 Markdown 格式：

要求：
1. 提取并保留原始标题层级（# ## ###），补全缺失的节标题
2. 每个独立主题作为单独的二级或三级节
3. 保留所有原始内容，禁止删减或改写事实
4. 在文档头部添加 YAML front-matter：
   ---
   title: <文档标题>
   doc_type: <FAQ|操作手册|政策说明|合同模板|其他>
   summary: <50字以内摘要>
   source_url: <从封面页/页眉页脚/文档内容中识别到的原始 URL，识别不到则留空>
   ---

原始文档：
{raw_text}
```

适用场景：扫描件 OCR 结果、格式混乱的 DOCX、无标题的长文本。

---

## 输出格式

字段对应 `pipeline/models.py` 的 `Chunk` 数据类，去掉向量字段（`embedding` / `sparse_vector`）后全量输出。

### 字段说明

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| `chunk_id` | string | chunker 生成 | `{doc_id}-{chunk_index}` |
| `doc_id` | string | 请求参数 / 文件名 | 文档唯一标识 |
| `chunk_index` | int | chunker | 在文档中的顺序（0-based） |
| `title` | string | chunker / LLM | 所属节标题 |
| `breadcrumb` | string | chunker | 完整路径，如 `售后 > 退款 > 申请条件` |
| `content` | string | chunker | 正文内容 |
| `tokens_est` | int | `len(content)//3` | 估算 token 数 |
| `is_parent` | bool | chunker | 父节点（长节的摘要 chunk） |
| `parent_chunk_id` | string\|null | chunker | 子 chunk 指向的父 chunk_id |
| `source_url` | string\|null | 请求参数 | 原始文档链接 |
| `doc_type` | string\|null | LLM front-matter / 请求参数 | FAQ / 操作手册 / 政策说明 / 合同模板 |
| `category` | string\|null | 请求参数 | 业务分类，如 退款 / 发货 / 会员 |
| `product_line` | string[] | 请求参数 | 适用产品线，默认 `["global"]` |
| `region` | string[] | 请求参数 | 适用区域，默认 `["global"]` |
| `acl` | string[] | 请求参数 | 访问权限，默认 `["role:public"]` |
| `version` | string\|null | 请求参数 | 文档版本号 |
| `effective_from` | string\|null | 请求参数 | ISO8601，生效开始时间 |
| `effective_to` | string\|null | 请求参数 | ISO8601，生效结束时间 |
| `tags` | string[] | 请求参数 | 自由标签，如 `["高优","外部"]` |
| `updated_at` | string | 导出时刻 | ISO8601 |

### JSON 示例

```json
[
  {
    "chunk_id": "doc-20260803-001-0",
    "doc_id": "doc-20260803-001",
    "chunk_index": 0,
    "title": "退款政策",
    "breadcrumb": "售后服务 > 退款政策",
    "content": "自购买之日起 7 天内可无理由退款……",
    "tokens_est": 180,
    "is_parent": false,
    "parent_chunk_id": null,
    "source_url": "https://docs.company.com/after-sales",
    "doc_type": "政策说明",
    "category": "退款",
    "product_line": ["global"],
    "region": ["global"],
    "acl": ["role:public"],
    "version": "2026-Q3",
    "effective_from": "2026-07-01T00:00:00Z",
    "effective_to": null,
    "tags": ["售后", "退款"],
    "updated_at": "2026-08-03T10:00:00Z"
  }
]
```

### CSV

CSV 将数组字段（`product_line` / `region` / `acl` / `tags`）序列化为分号分隔字符串。

```
chunk_id,doc_id,chunk_index,title,breadcrumb,content,tokens_est,is_parent,parent_chunk_id,source_url,doc_type,category,product_line,region,acl,version,effective_from,effective_to,tags,updated_at
doc-20260803-001-0,doc-20260803-001,0,退款政策,"售后服务 > 退款政策","自购买之日起…",180,false,,https://docs.company.com/after-sales,政策说明,退款,global,global,role:public,2026-Q3,2026-07-01T00:00:00Z,,售后;退款,2026-08-03T10:00:00Z
```

---

## 实现路径

### 新增文件

```
app/api/tools.py          # 路由：POST /v1/tools/chunk-export
app/pipeline/structurer.py # LLM 结构化逻辑（步骤 2）
```

### 复用现有模块

| 模块 | 用途 |
|------|------|
| `pipeline/parser/` | 文件格式解析 |
| `pipeline/cleaner.py` | 文本清洗 |
| `pipeline/chunker.py` | 分块（只调用，不写 DB） |
| `pipeline/models.py` | `Chunk` 数据类 |
| `inference/llm.py` | LLM 调用 |

### `app/api/tools.py` 关键接口

```python
@router.post("/v1/tools/chunk-export")
async def chunk_export(
    file: UploadFile,
    format: Literal["json", "csv"] = "json",
    chunk_size: int | None = None,
    chunk_overlap: int | None = None,
    use_llm_structure: bool = True,
    doc_type: str | None = None,
):
    raw_text = await _parse_upload(file)
    if use_llm_structure:
        raw_text = await structure_with_llm(raw_text, doc_type)
    chunks = chunk_text(raw_text, chunk_size, chunk_overlap)
    return _format_response(chunks, format)
```

---

## 注意事项

- **不写 DB / 不生成 embedding**：纯预览工具，零副作用
- **大文件保护**：文件大小限制 10 MB，超出返回 413
- **LLM 超时**：`use_llm_structure=true` 时 LLM 调用可能增加 3-10 秒，前端需展示进度提示
- **chunker 复用**：`chunker.py` 现有逻辑依赖 DB（写入 parent/child），需抽取纯内存版的 `chunk_document_dry_run(text) -> list[Chunk]`
