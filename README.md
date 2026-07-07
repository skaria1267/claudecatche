# Claude Catche

多渠道 Claude API 缓存反向代理。在管理面板里添加各个中转/官转**渠道**（渠道名 + 上游 URL + 渠道 Key），
客户端把 base URL 填成 `http://你的地址/<渠道名>/v1`、Key 填**访问密钥**，发送标准 Claude 格式请求，
反代会校验访问密钥、按该渠道的缓存规则自动打缓存断点，再用该渠道的上游 URL 和 Key 转发出去。

## 核心特性

- **多渠道路由** — 每个渠道独立配置上游 URL、Key、认证头模式、缓存规则
- **URL 路由** — 客户端 base url 填 `你的地址/<渠道名>/v1`，自动补 `/messages`，和普通 Claude 反代填法一致
- **认证头可选** — 每个渠道可选 `仅 x-api-key` / `仅 Authorization Bearer` / `两个都带`
- **缓存断点** — 与 wanquan 一致的两种打标模式：
  - 自动模式：顶层 `cache_control`，由 API 自动管理断点
  - 自定义断点：最多 4 条规则，精确控制 system / messages 的断点位置
- **OpenRouter 供应商锁定** — 渠道可开启后，模型名加 `@厂商` 后缀即**硬锁定**该上游供应商（`provider.only` + 不回退）；客户端拉模型时会自动带出 `@anthropic` / `@google-vertex` / `@amazon-bedrock` 等变体，下拉直接选
- **思考虚拟模型名** — 渠道可开启后，模型名加 `-thinking[-挡位]` 后缀即注入 adaptive thinking + effort（详见下文）
- **每渠道出站代理** — 每个渠道可单独配置 http/socks5 代理，转发与拉模型列表都经此代理，配置时可一键测试连通性
- **模型列表管理** — 渠道配置可从上游一键拉取模型名、勾选保存，也可手动填；客户端能从 `你的地址/<渠道名>/v1/models` 拉取该渠道配置的模型清单
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

### 拉取模型列表（客户端）

客户端可向以下任一路径拉取该渠道**已配置的模型清单**（同样用访问密钥鉴权）：

- `GET /<渠道名>/v1/models`
- `GET /<渠道名>/models`

返回 OpenAI/Anthropic 通用的 `{"data":[{"id":"..."}]}` 结构。渠道开启「供应商锁定」后，
每个模型会额外带出 `模型名@anthropic`、`模型名@google-vertex`、`模型名@amazon-bedrock` 等变体。

## OpenRouter 供应商锁定

OpenRouter 上的 Claude 由 **三家** 供给：`anthropic`（官方直连）、`google-vertex`、`amazon-bedrock`
（基础 slug 会自动匹配各自的全部地区变体）。本反代支持在**模型名里指定供应商**，把它翻译成
OpenRouter 的 `provider` 硬锁定字段：

1. 渠道配置里打开「OpenRouter 供应商锁定」开关，填好「供应商清单」（默认即这三家）。
2. 客户端模型名用 `<模型>@<供应商>` 形式，例如 `anthropic/claude-sonnet-4.5@google-vertex`。
3. 反代会还原模型名，并注入 `provider: {"only": ["google-vertex"], "allow_fallbacks": false}`
   ——**只走该供应商，挂了直接报错，不偷偷换家**。多个用逗号：`...@anthropic,azure`。

> 提示：`@google-vertex` / `@amazon-bedrock` 不支持「自动模式」的顶层缓存；要对这两家做缓存请用「自定义断点（rules）」模式。
> 渠道上游 URL 直接填 `https://openrouter.ai/api/v1` 即可（反代自动补 `/messages`），OpenRouter 原生支持 Anthropic Messages 格式。

## 思考虚拟模型名（每渠道开关）

渠道配置里打开「思考虚拟模型名」后，模型名加 `-thinking[-挡位]` 后缀即注入 adaptive thinking 参数，
客户端换模型名即可切挡，无需自己构造 `thinking` / `output_config` 字段（自带的会被覆盖——模型名即契约）：

| 客户端 `model`               | 上游 `model` | 注入 `thinking`        | 注入 `output_config`   |
| ---------------------------- | ------------ | ---------------------- | ---------------------- |
| `<模型名>-thinking`          | `<模型名>`   | `{"type":"adaptive"}`  | —（上游走默认 `high`） |
| `<模型名>-thinking-<挡位>`   | `<模型名>`   | `{"type":"adaptive"}`  | `{"effort":"<挡位>"}`  |

挡位：`low` / `medium` / `high` / `xhigh` / `max`（`xhigh` 仅 Opus 4.7+ / Sonnet 5 / Fable 5）。
可与供应商锁定叠加：`claude-sonnet-4.6-thinking-max@anthropic`（先剥 `@厂商` 再剥 `-thinking`）。
开启后客户端拉模型列表会自动带出 `<模型名>-thinking` 变体，挡位后缀自行追加。

注意：

- adaptive thinking / effort 仅 **Claude 4.6+** 模型支持，老模型用虚拟名会被上游 400
- 上游本身就有 `xxx-thinking` 字面模型名的中转渠道**不要开启**此开关（会撞名被误改写），这也是它做成每渠道开关、默认关闭的原因

## 每渠道出站代理

每个渠道可单独配置一个出站代理，该渠道的转发请求和「从上游拉取模型」都会经此代理发出：

- 格式：`http://host:port`、`http://user:pass@host:port`、`socks5://host:port`、`socks5h://host:port`（域名在代理端解析）等
- 渠道表单里有「测试连通性」按钮：经该代理实际请求一次渠道上游 URL（未填则测 api.anthropic.com），返回延迟和出口 IP
- 渠道列表有代理列，`user:pass` 部分脱敏显示；清空保存即恢复直连
- SOCKS 代理依赖 `httpx[socks]`（已在 requirements.txt 中），老环境记得重新 `pip install -r requirements.txt`

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
