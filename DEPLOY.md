# VPS 部署与更新

## 分支与镜像

所有功能统一在 `main`：普通 Claude 渠道、官方 OpenAI API、Codex 和 Claude Code 订阅，以及唯一的 Atelier 管理前端。原功能分支合并后删除，后续从 `main` 更新。

Git 存放源码；GHCR 存放 GitHub Actions 构建的容器镜像。推送 `main` 会运行 `.github/workflows/build.yml`，只构建并发布镜像，不运行测试。成功发布后 VPS 可以直接拉取，无需安装 Python 或在 VPS 构建。

| 标签 | 用途 |
| --- | --- |
| `ghcr.io/skaria1267/claudecatche:latest` | 跟随最近成功发布的 main |
| `ghcr.io/skaria1267/claudecatche:main` | 同上，显式标注 main |
| `ghcr.io/skaria1267/claudecatche:<提交短SHA>` | 固定版本或回滚，使用 Actions 实际发布的标签 |

源码已经推送不代表镜像已经发布；应等待对应提交的 Actions 成功，再更新 VPS。

## 首次安装

准备 Docker Engine 和 Docker Compose 插件，执行：

```bash
mkdir -p /opt/claudecatche/data /opt/claudecatche/backups
cd /opt/claudecatche
curl -fL https://raw.githubusercontent.com/skaria1267/claudecatche/main/docker-compose.yml -o docker-compose.yml
openssl rand -base64 32
```

私有仓库下载 Compose 需授权，也可从已授权的 Git 检出目录复制文件。将以下配置保存为 `/opt/claudecatche/.env`，填入自己的值；最后一项填写刚生成的密钥：

```dotenv
BIND_HOST=127.0.0.1
HOST_PORT=53247
CATCH_IMAGE_TAG=latest
ADMIN_PASSWORD=replace-with-your-admin-password
ACCESS_KEY=replace-with-your-client-access-key
CATCH_MASTER_KEY=replace-with-generated-base64-key
```

```bash
chmod 600 /opt/claudecatche/.env
```

`ADMIN_PASSWORD` 和 `ACCESS_KEY` 是初始化配置；如果已在前端修改，以 SQLite 中保存的设置为准。已有部署必须保留原 `CATCH_MASTER_KEY`，否则现有订阅凭据无法解密。数据库和 `.env` 含敏感信息，不提交 Git。

公开 GHCR 包无需登录。若包是私有的，使用有该包读取权限的 GitHub token（通常需 `read:packages`），通过标准输入登录，避免把 token 写在命令行：

```bash
read -rs -p 'GitHub token: ' GHCR_TOKEN; echo
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
unset GHCR_TOKEN
```

```bash
cd /opt/claudecatche
docker compose pull claudecatche
docker compose up -d claudecatche
```

## HTTPS 与客户端路由

推荐 Nginx 反代到本机 `127.0.0.1:53247`，通过自己的域名配置 TLS。转发位置的核心配置：

```nginx
location / {
    proxy_pass http://127.0.0.1:53247;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 600s;
    client_max_body_size 50m;
}
```

不要在公网直接暴露无 TLS 的管理端口。所有客户端使用前端「设置」中的全局 Access Key，上游 key 和订阅凭据只保留在服务端。

| 功能 | Base URL |
| --- | --- |
| Claude 渠道 | `https://你的域名/<渠道名>/v1` |
| 官方 OpenAI | `https://你的域名/gpt/v1` |
| Codex 订阅 | `https://你的域名/codex/v1` |
| Claude Code 订阅 | `https://你的域名/claudecode/v1` |

Claude Code CLI 的 `ANTHROPIC_BASE_URL` 使用 `https://你的域名/claudecode`，不带末尾 `/v1`。开启「接入电脑 CC 模式」后由客户端控制缓存断点。

## 日常更新

先等待 main 对应的 GitHub Actions 构建发布成功。更新前使用 SQLite 在线备份 API，不能在写入时仅复制 `proxy.db` 而遗漏 WAL：

```bash
cd /opt/claudecatche
docker compose exec -T claudecatche python -c "import sqlite3; from datetime import datetime; p='/data/proxy.backup.'+datetime.now().strftime('%Y%m%d-%H%M%S')+'.db'; src=sqlite3.connect('/data/proxy.db'); dst=sqlite3.connect(p); src.backup(dst); dst.close(); src.close(); print(p)"
```

备份位于宿主机 `data/`；另行备份 `.env` 并妥善保护。确保 `CATCH_IMAGE_TAG=latest` 或 `main`，执行：

```bash
docker compose pull claudecatche
docker compose up -d --force-recreate claudecatche
docker compose ps claudecatche
docker inspect claudecatche --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'
```

最后两项查看运行状态和镜像源码提交，不调用模型或运行测试。需要排查启动错误时查看 `docker compose logs --tail=80 claudecatche`，注意不要对外贴出敏感信息。

### 从旧本地镜像迁移

旧 VPS 的 `docker-compose.override.yml` 可能将镜像覆盖为 `claudecatche:atelier`。仅更新主 Compose 文件不够：备份 override 和旧镜像后，把对应服务的 image 改成 `ghcr.io/skaria1267/claudecatche:${CATCH_IMAGE_TAG:-latest}`，保留其它端口、挂载和配置。随后执行上述 pull/up 流程。

如果保留 `/opt/claudecatche-src` 源码目录，切换到 `main` 并用 `git pull --ff-only origin main` 更新即可；运行中的服务从镜像读取代码，源码检出不再参与正常构建。不要覆盖服务器上未提交或未跟踪的文件。

## 回滚

保留最近使用的镜像与更新前数据库备份。把 `.env` 的 `CATCH_IMAGE_TAG` 改成目标提交短 SHA，执行 pull/up 即可切回镜像。旧本地镜像还在时，也可临时恢复备份的 override 使用它。

如果新版本已修改数据库且旧版本不兼容，先停止容器，再从更新前在线备份恢复数据库，处理对应 WAL/SHM 文件后启动。恢复会丢失备份后新增数据，不能未经确认直接覆盖生产库。任何回滚都必须保留原来的 `CATCH_MASTER_KEY`。

实际服务器地址、密码、现行提交和迁移记录只放在本地 `CLAUDE.md`，不加入公共部署文档或镜像。
