# Chunk 导出工具设计方案

## 目标

提供一个独立工具接口：上传文档 → LLM 解析成标准 RAG 文档结构 → 拆分为 chunks → 按选定格式（JSON/CSV）返回，**不写入数据库**。供业务方在正式索引前预览和校对 chunk 质量。

---

## API 设计

```
POST /api/tools/chunk-export
Content-Type: multipart/form-data
```

### 请求参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `file` | File | 必填 | 支持 PDF / DOCX / DOC / MD / TXT；最大 10 MB |
| `format` | string | `json` | `json` 或 `csv` |
| `chunk_size` | int | settings | 覆盖全局 chunk_size |
| `chunk_overlap` | int | settings | 覆盖全局 chunk_overlap |
| `use_llm_structure` | bool | `false` | 是否调用 LLM 提取文档结构（增加 3–10 秒延迟） |
| `doc_id` | string | 文件名 slugify | 文档唯一标识，见下方 slugify 规则 |
| `doc_type` | string | `null` | FAQ / 操作手册 / 政策说明 / 合同模板 |
| `category` | string | `null` | 业务分类，如 退款 / 发货 / 会员 |
| `source_url` | string | `null` | 见下方字段默认值策略 |
| `product_line` | string | `global` | 逗号分隔，如 `product_a,product_b`；映射到 `Document.product_line` |
| `acl` | string | `role:public` | 逗号分隔，如 `role:agent,role:public` |
| `version` | string | `null` | 文档版本号 |
| `effective_from` | string | `null` | ISO8601 生效开始时间 |
| `effective_to` | string | `null` | ISO8601 生效结束时间 |
| `tags` | string | `null` | 逗号分隔自由标签 |

> **注：** `region` 在 chunk-export 接口中不作为请求参数暴露，默认传入 `["global"]`。
> 正式入库接口（`/api/pipeline/ingest`）已支持 `region` 参数，需要多 region 预览可用那个接口。

### 字段默认值策略

```
source_url:
  1. 用户在导入时填写          → 直接使用
  2. use_llm_structure=true 时 → LLM 从文档封面页/页眉页脚提取
  3. LLM 无法提取              → null

doc_type:
  1. 用户填写                  → 直接使用
  2. use_llm_structure=true 时 → LLM 识别
  3. 否则                      → null

doc_id slugify 规则：
  保留字母、数字、中文字符（一-鿿）和连字符，
  其余字符替换为 -，合并连续 -，转小写。
  示例："退款 FAQ (2026).pdf" → "退款-faq-2026"
```

### 响应

- `Content-Disposition: attachment; filename="chunks.json"` 或 `chunks.csv`
- 同步返回，超时上限 55 秒（服务器内部 `asyncio.wait_for`），超时返回 `503`
- `use_llm_structure=true` 时前端应展示进度提示

---

## 处理流程

```
上传文件
   │
   ▼
1. 格式解析（复用 pipeline/parser）
   PDF  → pymupdf → Markdown
   DOCX → python-docx → Markdown
   MD / TXT → 直接使用
   所有路径均经过 clean_markdown() 清洗
   │
   ▼
2. LLM 结构化（use_llm_structure=true 时启用）
   使用结构化输出（response_format: json_schema），
   返回 StructuredResult（见下方）
   │
   ▼
3. 构造 Document 对象
   将请求参数映射到 Document dataclass（见实现路径）
   │
   ▼
4. 分块（复用 pipeline/chunker.chunk_document，dry_run=True）
   调用 _parse_sections + _split_by_paragraphs
   dry_run=True 跳过 DB upsert，仅返回 list[Chunk]
   │
   ▼
5. 格式化输出
   JSON：Chunk 字段列表 + tokens_est
   CSV：全字段，数组序列化为 JSON 字符串
```

---

## LLM 结构化（步骤 2）

使用 Pydantic 结构化输出，避免 YAML 解析的脆弱性：

```python
from typing import Literal
from pydantic import BaseModel

class StructuredResult(BaseModel):
    title: str
    doc_type: Literal["FAQ", "操作手册", "政策说明", "合同模板", "其他"]
    summary: str                  # 50 字以内
    source_url: str | None        # 从封面/页眉页脚识别，识别不到为 null
    markdown: str                 # 结构化后的正文 Markdown

async def structure_with_llm(raw_text: str) -> StructuredResult:
    llm = get_llm(max_tokens=4096, temperature=0.1)  # 必须覆盖默认 800
    return await llm.with_structured_output(StructuredResult).ainvoke(
        STRUCTURE_PROMPT.format(raw_text=raw_text)
    )
```

提示词：

```
你是文档结构化专家。将以下文档整理为规范的 Markdown 格式，并提取元数据。

要求：
1. 提取并保留原始标题层级（# ## ###），补全缺失的节标题
2. 每个独立主题作为单独的二级或三级节
3. 保留所有原始内容，禁止删减或改写事实
4. title：文档标题
5. doc_type：从 FAQ / 操作手册 / 政策说明 / 合同模板 / 其他 中选一
6. summary：50 字以内摘要
7. source_url：从封面页、页眉页脚、文档内容中识别到的原始 URL；识别不到填 null
8. markdown：整理后的完整正文

原始文档：
{raw_text}
```

适用场景：扫描件 OCR 结果、格式混乱的 DOCX、无标题的长文本。

> **注：** 大文档（> 3000 tokens）结构化时需注意 LLM 上下文窗口限制。
> 当前实现不做分窗处理，超长文档建议 `use_llm_structure=false`。

---

## 输出格式

字段对应 `pipeline/models.py` 的 `Chunk` dataclass，去掉向量字段（`embedding` / `sparse_vector`）后全量输出，额外追加 `tokens_est`。

### 字段说明

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| `chunk_id` | string | chunker 生成 | `{doc_id}#{section_idx:03d}_{chunk_idx:03d}`；父 chunk 为 `{doc_id}#{section_idx:03d}_parent` |
| `doc_id` | string | 请求参数 / slugify | 文档唯一标识 |
| `chunk_index` | int | chunker | 节内顺序（0-based）；父 chunk 为 -1 |
| `title` | string | chunker / LLM | 所属节标题 |
| `breadcrumb` | string | chunker | 完整路径，如 `售后 > 退款 > 申请条件` |
| `content` | string | chunker | 正文内容（含 breadcrumb 前缀） |
| `tokens_est` | int | `len(content) // 3` | 估算 token 数（中英混合场景下的粗略估计） |
| `is_parent` | bool | chunker | 父节点（长节的完整 body，不做 embedding） |
| `parent_chunk_id` | string\|null | chunker | 子 chunk 指向的父 chunk_id |
| `source_url` | string\|null | 请求参数 / LLM | 原始文档链接 |
| `doc_type` | string\|null | 请求参数 / LLM | FAQ / 操作手册 / 政策说明 / 合同模板 |
| `category` | string\|null | 请求参数 | 业务分类 |
| `product_line` | string[] | 请求参数 | 适用产品线，默认 `["global"]` |
| `region` | string[] | 接口默认 | chunk-export 固定为 `["global"]`；正式入库接口支持自定义 |
| `acl` | string[] | 请求参数 | 访问权限，默认 `["role:public"]` |
| `version` | string\|null | 请求参数 | 文档版本号 |
| `effective_from` | string\|null | 请求参数 | ISO8601 |
| `effective_to` | string\|null | 请求参数 | ISO8601 |
| `tags` | string[] | 请求参数 | 自由标签 |
| `updated_at` | string | 导出时刻 | ISO8601 |

### JSON 示例

```json
[
  {
    "chunk_id": "退款-faq-2026#000_000",
    "doc_id": "退款-faq-2026",
    "chunk_index": 0,
    "title": "退款政策",
    "breadcrumb": "退款 FAQ > 退款政策",
    "content": "退款 FAQ > 退款政策:\n自购买之日起 7 天内可无理由退款……",
    "tokens_est": 62,
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

数组字段（`product_line` / `region` / `acl` / `tags`）序列化为 JSON 字符串（与 `/api/ops/chunks/export` 保持一致）：

```
chunk_id,doc_id,chunk_index,...,product_line,region,acl,tags,...
退款-faq-2026#000_000,退款-faq-2026,0,...,["global"],["global"],["role:public"],["售后","退款"],...
```

---

## 实现路径

### 修改现有文件

**`pipeline/chunker.py`** — 为 `chunk_document` 增加 `dry_run` 参数，跳过 DB upsert：

```python
async def chunk_document(
    parsed: dict[str, Any],
    doc: Document,
    dry_run: bool = False,        # 新增：True 时跳过 DB 写入
) -> list[Chunk]:
    ...
    # 函数末尾原有的 DB 写入块
    if not dry_run and os.environ.get("PGVECTOR_DSN", ""):
        pool = await get_pool()
        await pool.execute("INSERT INTO documents ...", ...)

    return all_chunks
```

### 新增文件

```
app/api/tools.py           # 路由：POST /api/tools/chunk-export
app/pipeline/structurer.py # LLM 结构化逻辑（步骤 2）
```

### `app/api/tools.py` 关键实现

```python
import asyncio, re, tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse

from pipeline.models import Document
from pipeline.parser import parse_document
from pipeline.chunker import chunk_document
from pipeline.structurer import structure_with_llm

router = APIRouter(prefix="/api/tools")
_MAX_BYTES = 10 * 1024 * 1024   # 10 MB
_TIMEOUT_S  = 55


def _slugify(name: str) -> str:
    name = re.sub(r'[^\w一-鿿-]', '-', name)
    return re.sub(r'-+', '-', name).strip('-').lower()

def _csv_list(s: str) -> list[str]:
    return [x.strip() for x in s.split(',') if x.strip()] if s else []

def _parse_dt(s: str | None):
    if not s:
        return None
    from datetime import datetime, timezone
    return datetime.fromisoformat(s).astimezone(timezone.utc)


@router.post("/chunk-export")
async def chunk_export(
    file: UploadFile,
    format: Literal["json", "csv"] = "json",
    chunk_size: int | None = None,
    chunk_overlap: int | None = None,
    use_llm_structure: bool = False,
    doc_id: str | None = None,
    doc_type: str | None = None,
    category: str | None = None,
    source_url: str | None = None,
    product_line: str = "global",
    acl: str = "role:public",
    version: str | None = None,
    effective_from: str | None = None,
    effective_to: str | None = None,
    tags: str | None = None,
):
    raw = await file.read()
    if len(raw) > _MAX_BYTES:
        raise HTTPException(413, "文件超过 10 MB 限制")

    suffix = Path(file.filename or "file").suffix or ".txt"
    _doc_id = doc_id or _slugify(Path(file.filename or "doc").stem)

    async def _run():
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(raw)
            tmp_path = Path(tmp.name)
        try:
            parsed = await parse_document(tmp_path)

            if use_llm_structure:
                result = await structure_with_llm(parsed["markdown"])
                parsed["markdown"] = result.markdown
                nonlocal doc_type, source_url
                doc_type = doc_type or result.doc_type
                source_url = source_url or result.source_url

            doc = Document(
                doc_id=_doc_id,
                title=parsed["metadata"].get("title", _doc_id),
                owner_email="",          # 工具接口无账号上下文
                business_line="",
                product_line=_csv_list(product_line),
                source_url=source_url,
                doc_type=doc_type,
                default_category=category,
                acl=_csv_list(acl),
                version=version,
                effective_from=_parse_dt(effective_from),
                effective_to=_parse_dt(effective_to),
                default_tags=_csv_list(tags or ""),
                chunk_size=chunk_size,
                chunk_overlap=chunk_overlap,
            )
            return await chunk_document(parsed, doc, dry_run=True)
        finally:
            tmp_path.unlink(missing_ok=True)

    try:
        chunks = await asyncio.wait_for(_run(), timeout=_TIMEOUT_S)
    except asyncio.TimeoutError:
        raise HTTPException(503, "处理超时，请减小文件或关闭 use_llm_structure")

    return _format_response(chunks, format)
```

### `app/main.py` 挂载

```python
from api.tools import router as tools_router
app.include_router(tools_router, dependencies=[Depends(require_admin)])
```

### `app/pipeline/structurer.py` 关键实现

```python
from pydantic import BaseModel
from typing import Literal
from inference.llm import get_llm

class StructuredResult(BaseModel):
    title: str
    doc_type: Literal["FAQ", "操作手册", "政策说明", "合同模板", "其他"]
    summary: str
    source_url: str | None
    markdown: str

async def structure_with_llm(raw_text: str) -> StructuredResult:
    llm = get_llm(max_tokens=4096, temperature=0.1)
    return await llm.with_structured_output(StructuredResult).ainvoke(
        STRUCTURE_PROMPT.format(raw_text=raw_text)
    )
```

---

## 注意事项

- **不写 DB / 不生成 embedding**：`dry_run=True` 保证零副作用，`PGVECTOR_DSN` 设置不影响此接口
- **大文件保护**：文件大小硬限制 10 MB，超出返回 413
- **同步超时**：55 秒内未完成返回 503；`use_llm_structure=true` 时前端应展示进度提示
- **LLM 上下文限制**：超长文档（> ~3000 tokens 原文）结构化效果不稳定，暂不分窗处理；此类文档建议 `use_llm_structure=false`
- **`max_tokens` 必须覆盖**：`get_llm()` 默认 `max_tokens=800`，结构化输出需设为 `4096`，否则长文档 Markdown 会被截断
- **`owner_email` / `business_line`**：`Document` 的必填字段，工具接口无账号上下文，传空字符串；这两个字段不写 DB（`dry_run=True`），不影响 chunk 输出
- **`region` 固定为 `["global"]`**：chunk-export 接口不接受 region 参数，始终传 `["global"]`；正式入库（`/api/pipeline/ingest`）已支持 region
- **`chunk_id` 格式**：`{doc_id}#{section_idx:03d}_{chunk_idx:03d}`，与正式索引后的 ID 格式一致，可直接用于导入
