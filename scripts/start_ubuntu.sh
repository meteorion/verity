#!/usr/bin/env bash
# scripts/start_ubuntu.sh — 启动后端（postgres + redis + app），仅默认 profile。
# 不会启动 admin-ui / chat-ui（它们走 --profile frontend，或前端各自本地 npm run dev）。
#
# 用法：
#   ./scripts/start_ubuntu.sh          # 启动
#   ./scripts/start_ubuntu.sh logs     # 启动后跟着看 app 日志
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ ! -f .env ]; then
  echo "未找到 .env，从 .env.example 复制一份，记得填 QWEN_API_KEY / POSTGRES_PASSWORD。" >&2
  cp .env.example .env
fi

# WSL2 下，若仓库在 Windows 盘（/mnt/<drive>）上，DrvFs 不支持 Postgres 要求的严格
# 目录权限位，bind mount 会导致 initdb 报 "Operation not permitted"。这种情况下把
# postgres/redis 数据换成 Docker 具名卷（落在 WSL 自己的 ext4 上）。仅当探测到该场景
# 且尚未存在 override 文件时才生成；原生 Linux（非 WSL 或不在 /mnt 下）不受影响。
OVERRIDE_FILE=docker-compose.override.yml
if grep -qi microsoft /proc/version 2>/dev/null \
  && [[ "$(pwd)" == /mnt/* ]] \
  && [ ! -f "$OVERRIDE_FILE" ]; then
  echo "检测到 WSL2 + Windows 盘路径，写入 $OVERRIDE_FILE（postgres/redis 数据用具名卷，避开 DrvFs 权限问题）。"
  cat > "$OVERRIDE_FILE" <<'EOF'
# 本地专用（WSL2 + Windows 盘路径），由 scripts/start_ubuntu.sh 自动生成，不提交 Git。
services:
  postgres:
    volumes:
      - postgres-data:/var/lib/postgresql/data
  redis:
    volumes:
      - redis-data:/data

volumes:
  postgres-data:
  redis-data:
EOF
fi

docker compose up -d postgres redis app

echo "等待 app 健康检查..."
for _ in $(seq 1 30); do
  status="$(docker inspect -f '{{.State.Health.Status}}' verity-app-1 2>/dev/null || true)"
  [ "$status" = "healthy" ] && break
  [ "$status" = "unhealthy" ] && { echo "app 容器 unhealthy，查看日志：docker compose logs app" >&2; exit 1; }
  sleep 2
done

docker compose ps

cat <<EOF

后端已就绪：
  app     http://localhost:8000  (curl http://localhost:8000/health)
  postgres 127.0.0.1:5433
  redis    127.0.0.1:6380

前端不在这里启动，各自本地跑：
  cd admin-ui && npm run dev   # http://localhost:5173
  # chat-ui 默认不启动
EOF

if [ "${1:-}" = "logs" ]; then
  exec docker compose logs -f app
fi
