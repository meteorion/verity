# 对话自动生工单设计方案

## 目标

LLM 从对话上下文中提取工单字段，判断工单复杂度：
- **简单工单**：字段完整、诉求明确 → 直接调用 `tickets.service.create_ticket`，返回工单号
- **复杂工单**：缺少关键信息或属于高风险类型 → 返回带预填参数的工单表单链接，由人工填写提交

---

## 触发时机

意图路由（`intent_node`）识别到以下意图时，`tool_node` 发起工单流程：

| intent | 说明 |
|--------|------|
| `after_sales_refund` | 退款/换货/维修 |
| `complaint` | 投诉（已路由至 transfer，但需留档） |
| `inquiry`（含未解决标志） | 多轮对话未能解答 |

> 投诉类目前直接 transfer，后续可在 transfer_node 内同步创建存档工单。

---

## 简单 vs 复杂判断规则

### 简单工单条件（全部满足）

1. 工单类型属于低风险类型：`inquiry` / `technical_issue` / `after_sales_refund`（金额 ≤ 阈值）
2. LLM 能从对话中提取到必填字段（见下方字段表）
3. 对话轮数 ≤ 10 且诉求单一（无多个并发问题）

### 复杂工单条件（满足任意一项）

| 条件 | 示例 |
|------|------|
| 涉及金额 > `COMPLEX_AMOUNT_THRESHOLD`（默认 1000 元） | "我要退 3000 块" |
| 投诉 / 法律 / 媒体曝光 | complaint 类意图 |
| 缺少联系方式且无法从会话推断 | 匿名用户且未提供手机/邮箱 |
| 诉求超过 2 个独立问题 | "退款 + 开发票 + 投诉快递" |
| LLM 信心评分 < 0.7 | 提取字段时 LLM 返回 `confidence < 0.7` |

---

## 工单字段提取

### LLM 提取提示词

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

### 必填字段

| 字段 | 说明 | 简单工单要求 |
|------|------|-------------|
| `ticket_type` | 工单类型 | 必须能推断 |
| `summary` | 一句话描述 | 必须能生成 |
| `contact` | 联系方式 | 必须存在（手机/邮箱/uid 任一） |

---

## 简单工单流程

```
tool_node
   │
   ├─ LLM 提取字段 → fields dict
   ├─ 判断 is_complex = false
   │
   ▼
tickets.service.create_ticket(
    ticket_type=fields["ticket_type"],
    session_id=state["session_id"],
    fields=fields,
)
   │
   ▼
返回 tool_results:
{
  "type": "ticket_created",
  "ticket_id": "T-20260803-0012",
  "message": "已为您创建工单 T-20260803-0012，预计24小时内处理。"
}
```

generate_node 将 tool_results 插入知识块，LLM 向用户确认工单号。

---

## 复杂工单流程

```
tool_node
   │
   ├─ LLM 提取字段（部分可能为 null）
   ├─ 判断 is_complex = true
   │
   ▼
构造预填链接：
  base_url = TICKET_FORM_URL（env var，如 https://ops.company.com/tickets/new）
  prefill  = base64(json.dumps(fields))
  url      = f"{base_url}?session_id={session_id}&prefill={prefill}"
   │
   ▼
返回 tool_results:
{
  "type": "ticket_link",
  "url": "https://ops.company.com/tickets/new?session_id=xxx&prefill=xxx",
  "reason": "涉及金额较大，需人工核实",
  "message": "您的问题较为复杂，请点击链接填写详细工单，我们将安排专员跟进。"
}
```

---

## 实现路径

### 修改文件

```
app/graph/nodes/tool.py      # 实现工单提取与创建逻辑
app/graph/state.py           # 可选：添加 ticket_id 字段用于追踪
```

### 新增配置（.env / app_settings）

```env
TICKET_FORM_URL=https://ops.company.com/tickets/new
COMPLEX_AMOUNT_THRESHOLD=1000
```

### `tool_node` 骨架

```python
async def tool_node(state: OrchestratorState) -> dict:
    intent = state.get("intent")
    if intent not in ("after_sales_refund", "complaint", "inquiry"):
        return {"tool_results": []}

    history = state.get("history_recent", [])
    fields, is_complex = await _extract_ticket_fields(history, state["query_raw"])

    if is_complex:
        result = _build_ticket_link(fields, state["session_id"])
    else:
        ticket = await create_ticket(fields["ticket_type"], state["session_id"], fields)
        result = {"type": "ticket_created", "ticket_id": ticket["ticket_id"], ...}

    return {"tool_results": [result]}
```

---

## 边界情况

| 场景 | 处理方式 |
|------|----------|
| LLM 提取失败（JSON 解析异常） | 降级为复杂工单，返回表单链接 |
| `TICKET_FORM_URL` 未配置 | 返回纯文本提示"请联系人工客服" |
| 同一会话重复提交 | `create_ticket` 前检查同 `session_id` 最近 1 小时内是否已有工单，有则返回已有工单号 |
| 用户拒绝创建工单 | 不强制创建，仅在用户明确同意时触发 |

---

## 后续迭代

- P2：`tickets/config.py` 的 `ASSIGNMENT` 规则数据库化，支持按区域/产品线路由处理人
- P2：工单创建后通过钉钉 webhook 通知处理人（`HANDLER_001_DINGTALK_WEBHOOK` 已预留）
- P3：工单状态变更时反向通知用户（webhook 回调 → session push）
