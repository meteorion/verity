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
| `doc_type` | string | `null` | 文档类型标注（FAQ / 操作手册 / 政策说明） |

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
   ---

原始文档：
{raw_text}
```

适用场景：扫描件 OCR 结果、格式混乱的 DOCX、无标题的长文本。

---

## 输出格式

### JSON

```json
[
  {
    "chunk_index": 0,
    "title": "退款政策",
    "breadcrumb": "售后服务 > 退款政策",
    "content": "...",
    "tokens_est": 180,
    "is_parent": false,
    "parent_chunk_id": null
  }
]
```

### CSV

```
chunk_index,title,breadcrumb,content,tokens_est,is_parent
0,退款政策,"售后服务 > 退款政策","...",180,false
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
