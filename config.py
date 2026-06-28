import os

DB_PATH = os.environ.get("DB_PATH", "proxy.db")
PORT = int(os.environ.get("PORT", 29413))

# 从环境变量读取初始配置（部署时通过 .env 文件设置）
INIT_ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
INIT_ACCESS_KEY = os.environ.get("ACCESS_KEY", "")
