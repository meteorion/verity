"""处理人配置与工单分配规则 — P1 写死在代码里，P2 再做数据库化。"""
import os

HANDLERS: dict[str, dict] = {
    "handler_001": {
        "name": os.getenv("HANDLER_001_NAME", "客服"),
        "dingtalk_webhook": os.getenv("HANDLER_001_DINGTALK_WEBHOOK", ""),
        "email": os.getenv("HANDLER_001_EMAIL", ""),
    },
}

ASSIGNMENT: dict[str, str] = {
    "after_sales_refund": "handler_001",
    "complaint":          "handler_001",
    "inquiry":            "handler_001",
    "technical_issue":    "handler_001",
    "default":            "handler_001",
}

ESCALATE_AFTER_MINUTES: int = int(os.getenv("ESCALATE_AFTER_MINUTES", "120"))
CLOSE_AFTER_HOURS: int = int(os.getenv("CLOSE_AFTER_HOURS", "48"))
REMIND_INTERVAL_MINUTES: int = int(os.getenv("REMIND_INTERVAL_MINUTES", "30"))
