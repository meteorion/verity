<#
  本地 Postgres(pgvector) 管理脚本
  数据库跑在 WSL(Ubuntu-24.04) 里，未使用 Docker。
  用法：
    .\scripts\db_local.ps1 start   # 启动
    .\scripts\db_local.ps1 stop    # 停止
    .\scripts\db_local.ps1 status  # 查看状态
#>
param(
    [ValidateSet("start", "stop", "status")]
    [string]$Action = "start"
)

$Distro = "Ubuntu-24.04"

switch ($Action) {
    "start" {
        wsl -d $Distro -u root service postgresql start
        wsl -d $Distro -u root pg_lsclusters
    }
    "stop" {
        wsl -d $Distro -u root service postgresql stop
    }
    "status" {
        wsl -d $Distro -u root pg_lsclusters
    }
}
