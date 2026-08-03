# 动态工单模块设计

| 项目 | 内容 |
| --- | --- |
| 文档名称 | 动态工单模块设计 |
| 版本 | V3.0 |
| 变更说明 | 整合 auto-ticket 设计：LangGraph 集成升级为 tool_node 自动提取与创建，transfer_node 保留为兜底路径 |
| 关联文档 | design.md V1.1 / arch.md V1.3 |
| 读者对象 | 后端工程师、前端工程师 |

---

## 1. 模块定位

AI 无法自助解决时进入工单流程。LangGraph `tool_node` 先尝试从对话中自动创建工单；若判断为复杂工单则退化为让用户填表；`transfer_node` 作为最终兜底。

```
RAG 兜底
  └─ tool_node
       ├─ 简单工单（字段完整、低风险）
       │    └─ create_ticket() ──► 返回工单号给用户
       └─ 复杂工单（字段缺失 / 金额大 / 投诉）
            └─ 返回预填表单链接 ──► 用户填表提交 ──► tickets 表
                                                        └─ 定时脚本 ──► 通知处理人
                                                                          └─ 处理人后台标记解决

transfer_node（兜底，不经过 tool_node 时使用）
  └─ 直接返回表单链接（无预填）
```

---

## 2. P1 范围与约束

| 做 | 不做 |
| --- | --- |
| tool_node 从对话提取字段，简单工单自动创建 | NLI 告警等非对话触发的系统内部自动开单 |
| 复杂工单返回带预填参数的表单链接 | 动态表单配置后台 |
| transfer_node 兜底（无 LLM 提取，直接给链接） | 实时在线坐席分配 |
| 前端硬编码表单，4 种类型映射 4 个组件，支持 prefill 参数解析 | SLA 计算器、SLA 策略表 |
| 定时脚本通知处理人（每 10 分钟） | AI 摘要、推荐解法 |
| 脚本超时升级（配置写在代码里） | EAV 动态字段表、工作流配置表 |
| 处理人在管理后台标记处理状态 | |
| 2 张数据库表（tickets + notification_logs） | |

---

## 3. 工单表单（前端硬编码）

### 3.1 路由映射

URL 参数 `type` 决定渲染哪个表单组件，`prefill` 携带 LLM 预提取的字段（base64 JSON）：

```
/tickets/new?type=after_sales_refund&session=s_xxx&prefill=eyJvcmRlcl9pZCI6...}
                ↓
          FORM_MAP[type]  →  对应 React 组件（自动填入 prefill 字段）
```

```jsx
// admin-ui/src/pages/TicketNew.jsx
import { useMemo } from "react";

const FORM_MAP = {
  after_sales_refund: AfterSalesRefundForm,
  complaint:          ComplaintForm,
  inquiry:            InquiryForm,
  technical_issue:    TechnicalIssueForm,
};

export default function TicketNew() {
  const [params] = useSearchParams();
  const Form = FORM_MAP[params.get("type")] ?? InquiryForm;

  const prefill = useMemo(() => {
    const raw = params.get("prefill");
    if (!raw) return {};
    try { return JSON.parse(atob(raw)); } catch { return {}; }
  }, [params]);

  return <Form sessionId={params.get("session")} prefill={prefill} />;
}
```

### 3.2 各类型字段

| 工单类型 | 必填 | 选填 |
| --- | --- | --- |
| `after_sales_refund` | 订单号、问题描述、联系方式 | 期望退款金额 |
| `complaint` | 投诉内容、联系方式 | 涉及订单号 |
| `inquiry` | 问题描述 | 联系方式 |
| `technical_issue` | 问题描述、联系方式 | 错误截图、错误码 |

所有表单隐藏字段：`ticket_type`（字面量）、`session_id`（URL 参数）。

### 3.3 组件骨架（以退款为例，其余同结构）

```jsx
// admin-ui/src/pages/tickets/AfterSalesRefundForm.jsx
export default function AfterSalesRefundForm({ sessionId, prefill = {} }) {
  const [form, setForm] = useState({
    order_id:    prefill.order_id    ?? "",
    description: prefill.summary     ?? "",
    contact:     prefill.contact     ?? "",
  });
  const [done, setDone] = useState(null);

  async function submit(e) {
    e.preventDefault();
    const res = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticket_type: "after_sales_refund",
        session_id: sessionId,
        fields: form,
      }),
    });
    const data = await res.json();
    setDone(data.ticket_id);
  }

  if (done) return <p>工单 {done} 已提交，我们将尽快联系您。</p>;

  return (
    <form onSubmit={submit}>
      <input required placeholder="订单号" value={form.order_id}
        onChange={e => setForm({ ...form, order_id: e.target.value })} />
      <textarea required placeholder="问题描述" value={form.description}
        onChange={e => setForm({ ...form, description: e.target.value })} />
      <input required placeholder="联系方式（手机/邮箱）" value={form.contact}
        onChange={e => setForm({ ...form, contact: e.target.value })} />
      <button type="submit">提交工单</button>
    </form>
  );
}
```

---

## 4. 状态机（5 态）

```
open ──► notified ──► processing ──► resolved ──► closed
              └──────────────────────────────► escalated
                    (超时，脚本升级通知)
```

| 状态 | 含义 | 由谁变更 |
| --- | --- | --- |
| `open` | 用户已提交，待首次通知 | 工单创建时写入 |
| `notified` | 处理人已收到通知 | 通知脚本 |
| `processing` | 处理人打开后台详情页 | 后台 API |
| `escalated` | 超时未处理，已升级通知 | 通知脚本 |
| `resolved` | 处理人标记解决 | 后台 API |
| `closed` | 48h 无异议自动关闭 | 通知脚本 |

---

## 5. 数据模型（2 张表）

```sql
-- 工单主表
CREATE TABLE tickets (
    ticket_id    TEXT PRIMARY KEY,        -- T-YYYYMMDD-NNNN
    ticket_type  TEXT NOT NULL,
    session_id   TEXT,                    -- 关联 RAG 会话
    status       TEXT NOT NULL DEFAULT 'open',
    fields       JSONB NOT NULL DEFAULT '{}',  -- 各类型自定义字段
    contact      TEXT,                    -- 联系方式（冗余，方便通知）
    assignee_id  TEXT,                    -- 当前处理人
    assigned_at  TIMESTAMPTZ,             -- 最近一次分配/转派时间，脚本以此去重通知
    created_at   TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now(),
    resolved_at  TIMESTAMPTZ,
    closed_at    TIMESTAMPTZ
);

CREATE INDEX ON tickets (status, created_at);
CREATE INDEX ON tickets (assignee_id, status);

-- 通知日志（防重发 + 审计）
CREATE TABLE notification_logs (
    id          BIGSERIAL PRIMARY KEY,
    ticket_id   TEXT NOT NULL,
    handler_id  TEXT NOT NULL,
    notify_type TEXT NOT NULL,   -- first / reassigned / reminder / escalation / closed
    channel     TEXT NOT NULL,   -- dingtalk / email
    status      TEXT NOT NULL,   -- sent / failed
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON notification_logs (ticket_id, handler_id, notify_type);
```

**`assigned_at` 的作用**：每次转派时更新此字段，脚本判断"当前处理人自 `assigned_at` 起是否已收到通知"，而不是判断工单全生命周期内有无通知记录，从而正确支持多次流转。

`ticket_id` 生成规则：

```python
def new_ticket_id() -> str:
    from datetime import date
    seq = get_next_seq()          # 当日序号，简单用 SEQUENCE 或 COUNT+1
    return f"T-{date.today().strftime('%Y%m%d')}-{seq:04d}"
```

---

## 6. API（最小集）

```
POST   /api/tickets                      # 用户提交表单 / tool_node 自动创建工单
GET    /api/tickets                      # 处理人查看工单列表（管理后台）
GET    /api/tickets/{ticket_id}          # 工单详情
PATCH  /api/tickets/{ticket_id}/status   # 变更状态（processing / resolved）
PATCH  /api/tickets/{ticket_id}/assign   # 转派处理人
GET    /api/tickets/link                 # transfer_node 兜底调用，返回无预填的表单 URL
GET    /api/tickets/handlers             # 可选处理人列表（转派下拉用）
```

### 6.1 创建工单（表单提交 / 自动创建共用）

```http
POST /api/tickets
Content-Type: application/json

{
  "ticket_type": "after_sales_refund",
  "session_id": "s_20260801_0231",
  "fields": {
    "order_id": "ORD-2026073100123",
    "description": "草莓变质，申请退款",
    "contact": "138xxxx8888"
  }
}
```

```json
{ "ticket_id": "T-20260801-0042", "status": "open" }
```

后端在写库前检查：同 `session_id` 最近 1 小时内已有同类型工单时，直接返回已有 `ticket_id`，不重复创建。

### 6.2 获取表单链接（transfer_node 兜底）

```http
GET /api/tickets/link?type=after_sales_refund&session=s_20260801_0231
```

```json
{ "url": "https://admin.example.com/tickets/new?type=after_sales_refund&session=s_20260801_0231" }
```

### 6.3 变更状态

```http
PATCH /api/tickets/T-20260801-0042/status
Content-Type: application/json

{ "status": "resolved" }
```

### 6.4 转派处理人

```http
PATCH /api/tickets/T-20260801-0042/assign
Content-Type: application/json

{ "handler_id": "handler_002", "reason": "跨部门问题，转产品组" }
```

后端逻辑：
1. 更新 `assignee_id = handler_002`、`assigned_at = now()`、`status = 'notified'`
2. **立即**向新处理人发一条 `reassigned` 通知（不等 cron tick）
3. 向旧处理人发一条"工单已转派"消息

```json
{ "ticket_id": "T-20260801-0042", "assignee_id": "handler_002", "status": "notified" }
```

### 6.5 处理人列表（转派下拉）

```http
GET /api/tickets/handlers
```

```json
[
  { "handler_id": "handler_001", "name": "李晓燕" },
  { "handler_id": "handler_002", "name": "张明" }
]
```

数据直接从 `config.py` 的 `HANDLERS` 字典返回，无需数据库查询。

---

## 7. 通知脚本

### 7.1 处理人配置（代码写死，P2 再做数据库配置）

```python
# app/tickets/config.py
HANDLERS = {
    "handler_001": {
        "name": "李晓燕",
        "dingtalk_webhook": "https://oapi.dingtalk.com/robot/send?access_token=xxx",
        "email": "li@example.com",
    },
}

ASSIGNMENT = {
    "after_sales_refund": "handler_001",
    "complaint":          "handler_001",
    "inquiry":            "handler_001",
    "technical_issue":    "handler_001",
    "default":            "handler_001",
}

# 超时升级阈值（分钟）
ESCALATE_AFTER_MINUTES = 120
CLOSE_AFTER_HOURS = 48
REMIND_INTERVAL_MINUTES = 30   # 防抖：同一工单两次提醒间隔
```

### 7.2 脚本逻辑

```python
# scripts/notify_tick.py  ── 每 10 分钟由 Cron 调用
import asyncio, httpx
from app.db import get_pool
from app.tickets.config import ASSIGNMENT, HANDLERS, ESCALATE_AFTER_MINUTES, CLOSE_AFTER_HOURS

async def run():
    pool = await get_pool()
    async with pool.acquire() as conn:
        await notify_open(conn)
        await escalate_stale(conn)
        await auto_close(conn)

async def notify_open(conn):
    """首次/转派通知：当前处理人自 assigned_at 起尚未收到通知"""
    rows = await conn.fetch("""
        SELECT t.* FROM tickets t
        WHERE t.status IN ('open', 'notified')
          AND t.assignee_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM notification_logs n
            WHERE n.ticket_id  = t.ticket_id
              AND n.handler_id = t.assignee_id
              AND n.notify_type IN ('first', 'reassigned')
              AND n.created_at >= t.assigned_at   -- 只看本次分配之后的记录
              AND n.status = 'sent'
          )
        ORDER BY t.created_at
        LIMIT 50
    """)
    for row in rows:
        handler_id = ASSIGNMENT.get(row["ticket_type"], ASSIGNMENT["default"])
        notify_type = "first" if row["status"] == "open" else "reassigned"
        await send_notify(conn, row, handler_id, notify_type)
        await conn.execute(
            """UPDATE tickets
               SET status='notified', assignee_id=$1, assigned_at=now(), updated_at=now()
               WHERE ticket_id=$2""",
            handler_id, row["ticket_id"]
        )

async def escalate_stale(conn):
    """超时未处理 → 升级通知"""
    rows = await conn.fetch("""
        SELECT t.* FROM tickets t
        WHERE t.status = 'notified'
          AND t.updated_at < now() - ($1 || ' minutes')::interval
          AND NOT EXISTS (
            SELECT 1 FROM notification_logs n
            WHERE n.ticket_id = t.ticket_id AND n.notify_type = 'escalation'
          )
    """, str(ESCALATE_AFTER_MINUTES))
    for row in rows:
        handler_id = ASSIGNMENT.get(row["ticket_type"], ASSIGNMENT["default"])
        await send_notify(conn, row, handler_id, "escalation")
        await conn.execute(
            "UPDATE tickets SET status='escalated', updated_at=now() WHERE ticket_id=$1",
            row["ticket_id"]
        )

async def auto_close(conn):
    """resolved 超 48h 自动关闭"""
    await conn.execute("""
        UPDATE tickets
        SET status='closed', closed_at=now(), updated_at=now()
        WHERE status='resolved'
          AND resolved_at < now() - ($1 || ' hours')::interval
    """, str(CLOSE_AFTER_HOURS))

async def send_notify(conn, ticket, handler_id, notify_type):
    handler = HANDLERS[handler_id]
    text = build_message(ticket, notify_type)
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(handler["dingtalk_webhook"],
                              json={"msgtype": "text", "text": {"content": text}})
        status = "sent"
    except Exception:
        status = "failed"
    await conn.execute(
        "INSERT INTO notification_logs(ticket_id,handler_id,notify_type,channel,status)"
        " VALUES($1,$2,$3,'dingtalk',$4)",
        ticket["ticket_id"], handler_id, notify_type, status
    )

def build_message(ticket, notify_type) -> str:
    prefix = {"first": "📋 新工单", "escalation": "🔴 工单超时升级", "reminder": "⏰ 工单待处理",
              "reassigned": "🔄 工单转派"}.get(notify_type, "工单通知")
    fields = ticket["fields"] or {}
    desc = fields.get("description", fields.get("summary", ""))[:80]
    return (
        f"{prefix} #{ticket['ticket_id']}\n"
        f"类型：{ticket['ticket_type']}\n"
        f"描述：{desc}\n"
        f"联系：{ticket.get('contact', '—')}\n"
        f"处理链接：{build_admin_url(ticket['ticket_id'])}"
    )

if __name__ == "__main__":
    asyncio.run(run())
```

### 7.3 Cron 配置

```bash
*/10 * * * * cd /app && python scripts/notify_tick.py >> /var/log/verity/notify.log 2>&1
```

---

## 8. 与 LangGraph 集成

### 8.1 tool_node：自动提取与创建（主路径）

`intent_node` 识别到下列意图时，由 `tool_node` 进入工单流程：

| intent | 触发说明 |
| --- | --- |
| `after_sales_refund` | 退款 / 换货 / 维修 |
| `complaint` | 投诉（直接判定为复杂工单，不自动创建） |
| `inquiry`（含未解决标志） | 多轮对话未能解答 |

#### 简单 vs. 复杂工单判断

**简单工单**（全部满足）：

1. 工单类型为 `inquiry` / `technical_issue` / `after_sales_refund`（金额 ≤ `COMPLEX_AMOUNT_THRESHOLD`）
2. LLM 能从对话中提取到必填字段（`ticket_type`、`summary`、`contact`）
3. 对话轮数 ≤ 10 且诉求单一

**复杂工单**（满足任意一项）：

| 条件 | 示例 |
| --- | --- |
| 涉及金额 > `COMPLEX_AMOUNT_THRESHOLD`（默认 1000 元） | "我要退 3000 块" |
| 意图为 `complaint` / 涉及法律 / 媒体曝光 | complaint 类意图 |
| 缺少联系方式且无法从会话推断 | 匿名用户且未提供手机/邮箱 |
| 诉求超过 2 个独立问题 | "退款 + 开发票 + 投诉快递" |
| LLM 信心评分 < 0.7 | 提取字段时 LLM 返回 `confidence < 0.7` |

#### LLM 字段提取提示词

```
从以下客服对话中提取工单信息，以 JSON 格式返回。
若某字段无法从对话中推断，值设为 null。

必填字段：
- ticket_type: "after_sales_refund" | "complaint" | "inquiry" | "technical_issue"
- summary: 一句话问题描述（≤50字）
- contact: 用户联系方式（手机/邮箱/uid，任意一种）

选填字段：
- amount: 涉及金额（数字，单位元，null 表示无涉及）
- order_id: 订单号
- priority: "low" | "normal" | "high"（默认 normal）
- detail: 详细描述（≤200字）

额外输出：
- confidence: 0.0~1.0，你对提取结果的置信度
- is_complex: true/false，是否判断为复杂工单（依据上方规则）
- complex_reason: is_complex=true 时说明原因

对话：
{conversation_text}
```

#### 简单工单流程

```
tool_node
   ├─ LLM 提取字段 → fields dict（confidence ≥ 0.7，必填字段完整）
   ├─ is_complex = false
   └─ create_ticket(ticket_type, session_id, fields)
        └─ 返回 tool_results:
           { "type": "ticket_created",
             "ticket_id": "T-20260803-0012",
             "message": "已为您创建工单 T-20260803-0012，预计24小时内处理。" }
```

`generate_node` 将 `tool_results` 插入上下文，LLM 向用户确认工单号。

#### 复杂工单流程

```
tool_node
   ├─ LLM 提取字段（部分可能为 null）
   ├─ is_complex = true
   └─ 构造预填链接：
        prefill = base64(json.dumps(fields))
        url = f"{TICKET_FORM_URL}?type={ticket_type}&session={session_id}&prefill={prefill}"
        └─ 返回 tool_results:
           { "type": "ticket_link",
             "url": "https://admin.example.com/tickets/new?...",
             "reason": "涉及金额较大，需人工核实",
             "message": "您的问题较为复杂，请点击链接填写详细工单，我们将安排专员跟进。" }
```

#### 边界情况

| 场景 | 处理方式 |
| --- | --- |
| LLM 提取失败（JSON 解析异常） | 降级为复杂工单，返回表单链接 |
| `TICKET_FORM_URL` 未配置 | 返回纯文本"请联系人工客服" |
| 同 `session_id` 1 小时内已有工单 | `create_ticket` 前检查，有则返回已有工单号，不重复创建 |
| 用户拒绝创建工单 | 不强制创建，仅在用户明确同意时触发 |
| `intent` 不在触发列表 | `tool_node` 返回空 `tool_results`，由后续节点处理 |

#### tool_node 实现骨架

```python
# app/graph/nodes/tool.py
import base64, json
from app.tickets.service import create_ticket
from app.graph.state import OrchestratorState

TICKET_INTENTS = {"after_sales_refund", "complaint", "inquiry"}

async def tool_node(state: OrchestratorState) -> dict:
    intent = state.get("intent")
    if intent not in TICKET_INTENTS:
        return {"tool_results": []}

    history = state.get("history_recent", [])
    fields, is_complex = await _extract_ticket_fields(history, state["query_raw"])

    if is_complex:
        result = _build_ticket_link(fields, state["session_id"])
    else:
        ticket = await create_ticket(fields["ticket_type"], state["session_id"], fields)
        result = {
            "type": "ticket_created",
            "ticket_id": ticket["ticket_id"],
            "message": f"已为您创建工单 {ticket['ticket_id']}，预计24小时内处理。",
        }

    return {"tool_results": [result]}

def _build_ticket_link(fields: dict, session_id: str) -> dict:
    import os
    base_url = os.getenv("TICKET_FORM_URL", "")
    if not base_url:
        return {"type": "ticket_link", "url": None,
                "message": "请联系人工客服，我们将尽快跟进您的问题。"}
    prefill = base64.b64encode(json.dumps(fields, ensure_ascii=False).encode()).decode()
    ticket_type = fields.get("ticket_type", "inquiry")
    url = f"{base_url}?type={ticket_type}&session={session_id}&prefill={prefill}"
    return {
        "type": "ticket_link",
        "url": url,
        "reason": fields.get("complex_reason", ""),
        "message": "您的问题较为复杂，请点击链接填写详细工单，我们将安排专员跟进。",
    }
```

#### 环境变量

```env
TICKET_FORM_URL=https://admin.example.com/tickets/new
COMPLEX_AMOUNT_THRESHOLD=1000
```

---

### 8.2 transfer_node（兜底路径）

当 `tool_node` 未介入（如 `intent_node` 直接路由至 transfer）时使用，直接返回无预填的表单链接：

```python
# app/graph/nodes/transfer.py
import os
from app.graph.state import OrchestratorState

_BASE = os.getenv("TICKET_FORM_URL", os.getenv("ADMIN_UI_BASE_URL", "http://localhost:5173"))

_TYPE_MAP = {
    "after_sales":    "after_sales_refund",
    "complaint":      "complaint",
    "technical":      "technical_issue",
}

async def transfer_node(state: OrchestratorState) -> dict:
    ticket_type = _TYPE_MAP.get(state.get("intent", ""), "inquiry")
    session_id  = state.get("session_id", "")
    link = f"{_BASE}/tickets/new?type={ticket_type}&session={session_id}"
    return {
        "answer_stream": f"很抱歉暂时无法为您解答，请点击链接提交工单，我们将尽快联系您：\n{link}",
        "transferred": True,
        "transfer_reason": state.get("transfer_reason", "fallback"),
    }
```

---

### 8.3 Function Call 定义

```python
# tool_node 使用的工具定义
CREATE_OR_LINK_TICKET_TOOL = {
    "name": "create_or_link_ticket",
    "description": "从对话中提取工单字段；简单工单直接创建，复杂工单返回预填表单链接",
    "input_schema": {
        "type": "object",
        "properties": {
            "ticket_type": {
                "type": "string",
                "enum": ["after_sales_refund", "complaint", "inquiry", "technical_issue"],
            },
            "summary":    {"type": "string"},
            "contact":    {"type": ["string", "null"]},
            "amount":     {"type": ["number", "null"]},
            "order_id":   {"type": ["string", "null"]},
            "priority":   {"type": "string", "enum": ["low", "normal", "high"]},
            "detail":     {"type": ["string", "null"]},
            "confidence": {"type": "number"},
            "is_complex": {"type": "boolean"},
            "complex_reason": {"type": ["string", "null"]},
        },
        "required": ["ticket_type", "summary", "confidence", "is_complex"],
    },
}

# transfer_node 使用的工具定义（兜底，无字段提取）
GET_TICKET_LINK_TOOL = {
    "name": "get_ticket_link",
    "description": "当问题无法自助解决时，返回对应类型的工单提交链接",
    "input_schema": {
        "type": "object",
        "properties": {
            "ticket_type": {
                "type": "string",
                "enum": ["after_sales_refund", "complaint", "inquiry", "technical_issue"],
            }
        },
        "required": ["ticket_type"],
    },
}
```

---

## 9. 文件结构

```
app/
├── api/
│   └── tickets.py          # POST /api/tickets, GET /api/tickets, PATCH .../status, GET .../link
├── tickets/
│   ├── __init__.py
│   ├── config.py           # HANDLERS / ASSIGNMENT / 阈值常量
│   └── service.py          # new_ticket_id(), create_ticket(), list_tickets(), update_status()
└── graph/nodes/
    ├── tool.py             # tool_node：LLM 提取 + 简单/复杂分支
    └── transfer.py         # transfer_node：兜底，直接返回表单链接

scripts/
└── notify_tick.py          # Cron 脚本

admin-ui/src/pages/
├── TicketNew.jsx           # FORM_MAP 路由 + prefill 解析
├── Tickets.jsx             # 处理人工单列表（管理后台）
└── tickets/
    ├── AfterSalesRefundForm.jsx
    ├── ComplaintForm.jsx
    ├── InquiryForm.jsx
    └── TechnicalIssueForm.jsx
```

---

## 10. P2+ 升级路径

> P1 完成后按需升级，不影响已有数据。

| 能力 | P2 方案 |
| --- | --- |
| 分配规则动态化 | `assignment_rules` 表替换 `config.py` 常量，支持按区域/产品线路由处理人 |
| 动态表单 | `field_schemas` 表 + 后台配置页 → 前端改为 `<DynamicForm>` 通用组件 |
| AI 摘要 / 推荐解法 | 工单创建后异步触发，结果内嵌进通知消息 |
| SLA 计算 | `sla_policies` 表 + 脚本增加 `business_hours_elapsed()` 计算 |
| 知识闭环 | 处理人"沉淀为知识"按钮 → 触发 `/api/pipeline/ingest` |
| NLI 自动开单 | RAG 链路检测到不一致 → 调 `ticket_service.create_ticket()` 内部创建 |
| 工单状态反向通知用户 | webhook 回调 → session push，告知用户处理进度 |
| 多通知渠道 | `notify_channels` 字段支持 email / 企微 / 飞书，统一 Notifier 接口 |