# 动态工单模块设计

| 项目 | 内容 |
| --- | --- |
| 文档名称 | 动态工单模块设计 |
| 版本 | V2.0 |
| 变更说明 | 重构为 P1 最低成本实现为主体，P2+ 升级路径独立成节 |
| 关联文档 | design.md V1.1 / arch.md V1.3 |
| 读者对象 | 后端工程师、前端工程师 |

---

## 1. 模块定位

AI 无法自助解决时，向用户输出工单链接；用户填表提交后，定时脚本通知处理人跟进；处理结果最终反哺知识库。

```
RAG 兜底
  └─ get_ticket_link(type) ──► 用户收到链接
                                  └─ 用户填表提交 ──► tickets 表
                                                        └─ 定时脚本 ──► 通知处理人
                                                                          └─ 处理人后台标记解决
```

---

## 2. P1 范围与约束

| 做 | 不做 |
| --- | --- |
| 按工单类型生成链接，由用户填表创建工单 | 系统内部自动创建工单（NLI 告警等） |
| 前端硬编码表单，4 种类型映射 4 个组件 | 动态表单配置后台 |
| 定时脚本通知处理人（每 10 分钟） | 实时在线坐席分配 |
| 脚本超时升级（配置写在代码里） | SLA 计算器、SLA 策略表 |
| 处理人在管理后台标记处理状态 | AI 摘要、推荐解法 |
| 2 张数据库表（tickets + notification_logs） | EAV 动态字段表、工作流配置表 |

---

## 3. 工单表单（前端硬编码）

### 3.1 路由映射

URL 参数 `type` 决定渲染哪个表单组件：

```
/tickets/new?type=after_sales_refund&session=s_xxx
                ↓
          FORM_MAP[type]  →  对应 React 组件
```

```jsx
// admin-ui/src/pages/TicketNew.jsx
const FORM_MAP = {
  after_sales_refund: AfterSalesRefundForm,
  complaint:          ComplaintForm,
  inquiry:            InquiryForm,
  technical_issue:    TechnicalIssueForm,
};

export default function TicketNew() {
  const [params] = useSearchParams();
  const Form = FORM_MAP[params.get("type")] ?? InquiryForm;
  return <Form sessionId={params.get("session")} />;
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

### 3.3 组件骨架

```jsx
// admin-ui/src/pages/tickets/AfterSalesRefundForm.jsx
export default function AfterSalesRefundForm({ sessionId }) {
  const [form, setForm] = useState({ order_id: "", description: "", contact: "" });
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
      <input required placeholder="订单号"
        onChange={e => setForm({ ...form, order_id: e.target.value })} />
      <textarea required placeholder="问题描述"
        onChange={e => setForm({ ...form, description: e.target.value })} />
      <input required placeholder="联系方式（手机/邮箱）"
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
POST   /api/tickets                      # 用户提交表单，创建工单
GET    /api/tickets                      # 处理人查看工单列表（管理后台）
GET    /api/tickets/{ticket_id}          # 工单详情
PATCH  /api/tickets/{ticket_id}/status   # 变更状态（processing / resolved）
PATCH  /api/tickets/{ticket_id}/assign   # 转派处理人
GET    /api/tickets/link                 # RAG 调用，返回带参数的表单 URL
GET    /api/tickets/handlers             # 可选处理人列表（转派下拉用）
```

### 6.1 创建工单

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

### 6.2 获取表单链接（供 transfer_node 调用）

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
        await send_notify(conn, row, handler_id, "first")
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
    prefix = {"first": "📋 新工单", "escalation": "🔴 工单超时升级", "reminder": "⏰ 工单待处理"}.get(notify_type, "工单通知")
    fields = ticket["fields"] or {}
    desc = fields.get("description", "")[:80]
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

### 8.1 transfer_node（P1）

```python
# app/graph/nodes/transfer.py
import os
from graph.state import OrchestratorState

_BASE = os.getenv("ADMIN_UI_BASE_URL", "http://localhost:5173")

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

### 8.2 Function Call 定义（`create_ticket` 占位符替换为 `get_ticket_link`）

```python
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
│   └── service.py          # new_ticket_id(), create(), list_tickets(), update_status()
└── graph/nodes/
    └── transfer.py         # 已有，补充 get_ticket_link 逻辑

scripts/
└── notify_tick.py          # Cron 脚本

admin-ui/src/pages/
├── TicketNew.jsx           # FORM_MAP 路由
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
| 动态表单 | `field_schemas` 表 + 后台配置页 → 前端改为 `<DynamicForm>` 通用组件 |
| AI 摘要 / 推荐解法 | 工单创建后异步触发，结果内嵌进通知消息 |
| SLA 计算 | `sla_policies` 表 + 脚本增加 `business_hours_elapsed()` 计算 |
| 分配规则动态化 | `assignment_rules` 表替换 `config.py` 常量，后台可配 |
| 知识闭环 | 处理人"沉淀为知识"按钮 → 触发 `/api/pipeline/ingest` |
| NLI 自动开单 | RAG 链路检测到不一致 → 调 `ticket_service.create()` 内部创建 |
| 多通知渠道 | `notify_channels` 字段支持 email / 企微 / 飞书，统一 Notifier 接口 |