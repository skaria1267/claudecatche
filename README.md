# Claude Catche

多渠道 Claude API 缓存反向代理。在管理面板里添加各个中转/官转**渠道**（渠道名 + 上游 URL + 渠道 Key），
客户端把 base URL 填成 `http://你的地址/<渠道名>`、Key 填**访问密钥**，发送标准 Claude 格式请求，
反代会校验访问密钥、按该渠道的缓存规则自动打缓存断点，再用该渠道的上游 URL 和 Key 转发出去。

## 核心特性

- **多渠道路由** — 每个渠道独立配置上游 URL、Key、认证头模式、缓存规则
- **URL 路由** — 客户端 base url 填 `你的地址/<渠道名>`，自动补 `/v1/messages`，和普通 Claude 反代填法一致
- **认证头可选** — 每个渠道可选 `仅 x-api-key` / `仅 Authorization Bearer` / `两个都带`
- **缓存断点** — 与 wanquan 一致的两种打标模式：
  - 自动模式：顶层 `cache_control`，由 API 自动管理断点
  - 自定义断点：最多 4 条规则，精确控制 system / messages 的断点位置
- **访问密钥** — 在「账户设置」里配置连接本反代所需的访问密钥（客户端 Key 栏填这个）
- **登录保护** — 管理面板有登录密码，密码可在面板「账户设置 → 安全」里修改
- **请求日志 / 用量统计** — 每个渠道的 token 用量、缓存命中、耗时、状态码
- **Web 管理面板** — 纯 Vanilla JS，无 emoji，图标全部 SVG，日间/夜间主题

## 请求路由说明

客户端（如 SillyTavern 酒馆）填法和普通 Claude 反代完全一样：

- **API URL** 填：`http://你的地址/<渠道名>`
- **API Key** 填：在「账户设置」里配置的**访问密钥**

以下三种路径都会被正确处理（兼容不同客户端）：

- `POST /<渠道名>`
- `POST /<渠道名>/messages`
- `POST /<渠道名>/v1/messages`

访问密钥从请求头读取（`x-api-key` 或 `Authorization: Bearer`，和标准 Claude 客户端一致）。

例如渠道名 `openrouter`：酒馆的 API URL 填 `http://你的地址/openrouter`，
Key 填访问密钥即可。反代校验通过后，会用该渠道配置的上游 URL 和渠道 Key 转发。

## 快速开始（本地）

```bash
pip install -r requirements.txt
python main.py
```

默认端口 `53247`，管理面板 `http://127.0.0.1:53247/`，默认密码 `admin123`。

## Docker / VPS 部署

见 `DEPLOY.txt`，里面是可以直接复制粘贴到 VPS 的整套命令。

## 项目结构

```
claudecatche/
├── main.py              # FastAPI 入口
├── config.py            # 端口、数据库路径、初始密码
├── database.py          # SQLite 初始化
├── models.py            # 数据库 CRUD
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── DEPLOY.txt           # VPS 部署指南
├── routers/
│   ├── auth.py          # 登录认证
│   ├── channels.py      # 渠道增删改查
│   ├── settings.py      # 设置读写
│   ├── logs.py          # 日志 / 用量 / 失败记录
│   └── proxy.py         # 反代核心：路由匹配渠道 + 转发
├── services/
│   ├── cache_inject.py  # 缓存断点注入（auto / rules）
│   ├── request_builder.py # 按渠道配置打断点 + 清洗字段
│   └── upstream.py      # 上游转发（认证头 / 流式 / 日志）
└── static/              # 前端页面
    ├── theme.js index.html dashboard.html
    ├── channels.html settings.html usage.html logs.html
    ├── common.css app.js icons.js
```

## 技术栈

- FastAPI + Uvicorn
- SQLite (aiosqlite)
- httpx (异步 HTTP)
- 纯 Vanilla JS 前端（无框架、无 emoji、SVG 图标）
