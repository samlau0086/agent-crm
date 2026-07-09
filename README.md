# AI Agent CRM

私有化部署优先的 HubSpot 风格销售 CRM。当前版本包含联系人、公司、交易、任务、活动、CSV 导入、审计日志、RBAC、可配置对象/字段/关系/视图，以及只读 AI 助手层。

## 演示账号

- 管理员：`admin@example.com` / `Admin123!`
- 销售：`sales@example.com` / `Sales123!`

## 本地开发

```bash
npm install
npm run prisma:generate
npm run db:migrate
npm run db:seed
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## Docker Compose 部署

```bash
docker compose up --build
```

首次部署前先从 `.env.example` 初始化 `.env`，脚本会自动生成邮件加密和 OAuth state 密钥，且默认不会覆盖已有 `.env`：

```bash
npm run config:init
```

For an existing `.env` or `.env.local`, use `npm run config:init -- --output .env.local --merge-missing` to append only missing keys while preserving current values.

只想生成两条密钥用于已有配置文件时，可运行 `npm run config:secrets`。

Compose 会启动 `web`、`postgres`、`redis`：

- `postgres` 通过 `pg_isready` 做健康检查。
- `redis` 通过 `redis-cli ping` 做健康检查。
- `web` 会等待数据库、执行 `prisma migrate deploy`，并在 `SEED_ON_EMPTY=true` 且数据库没有 workspace 时灌入演示数据。
- 应用健康检查地址：`/api/health`。

关键环境变量：

- `DATABASE_URL`：PostgreSQL 连接串。
- `APP_BASE_URL`：应用对外访问地址，用于登录跳转、密码设置链接和邮箱 OAuth callback，生产环境应设为真实 HTTPS 域名。
- `RUN_MIGRATIONS`：默认 `true`，容器启动时执行迁移。
- `SEED_ON_EMPTY`：默认建议生产为 `false`；演示环境可设为 `true`。
- `AI_PROVIDER`：默认 `openai-compatible`；没有 `AI_API_KEY` 时会自动使用本地只读 fallback。
- `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`：OpenAI-compatible `/chat/completions` provider 配置。
- `AI_TIMEOUT_MS`：AI provider 请求超时，默认 `10000`，超时或失败时回退到本地只读建议。
- `EMAIL_CONFIG_SECRET`：邮箱 SMTP/IMAP/OAuth 凭据加密密钥，至少 16 字符；Compose 部署必须在 `.env` 中显式设置，不能使用 `.env.example` 的 placeholder。
- `EMAIL_OAUTH_STATE_SECRET`：Gmail/Outlook OAuth state 签名密钥，至少 16 字符；建议和 `EMAIL_CONFIG_SECRET` 分开，不能使用 placeholder。
- `LOGIN_RATE_LIMIT_MAX_ATTEMPTS`：同一邮箱/IP 在窗口期内允许的失败次数，默认 `5`，设为 `0` 可关闭。
- `LOGIN_RATE_LIMIT_WINDOW_MS`：登录失败计数窗口，默认 `900000`。
- `LOGIN_RATE_LIMIT_LOCK_MS`：触发限流后的锁定时长，默认 `900000`。

## 验证

```bash
npm run prisma:generate
npm run verify
```

`npm run verify` 会按顺序执行：

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm run test:e2e
```

生产配置校验：

```bash
npm run config:validate
```

Docker 私有化部署验收：

```bash
npm run deploy:verify
```

该命令会校验 Docker Compose 配置、构建镜像、启动服务、检查 `/api/health`，并在 `web` 容器内验证 PostgreSQL client、备份 dry-run 和邮件 diagnostics。上线前需要同时验证真实邮箱连接、AI provider、邮件应用 smoke 流程并要求 `readiness.liveTrafficReady=true` 时运行：

```bash
npm run deploy:verify:live-email
```

没有 Docker 的开发环境可以先运行：

```bash
npm run deploy:verify:dry-run
```

## GitHub Actions 部署到 VPS

项目包含 [`.github/workflows/deploy-vps.yml`](.github/workflows/deploy-vps.yml)，用于把镜像发布到 GHCR，并通过 SSH 在 VPS 的 `/opt/ai-agent-crm` 目录用 Docker Compose 运行。VPS 专用 Compose 文件见 [`deploy/docker-compose.vps.yml`](deploy/docker-compose.vps.yml)，示例环境变量见 [`deploy/vps.env.example`](deploy/vps.env.example)。

GitHub Actions Secrets：

- `VPS_HOST`：VPS IP 或域名。
- `VPS_USER`：SSH 用户。
- `VPS_SSH_KEY`：SSH 私钥。
- `VPS_PORT`：SSH 端口，默认 `22`，可选；优先建议放在 Variables，同名 Secret 仍兼容。
- `POSTGRES_PASSWORD`：外部 Postgres 密码；workflow 渲染 `DATABASE_URL` 时会自动 URL encode，手写 `DATABASE_URL` 时才需要自己编码。
- `EMAIL_CONFIG_SECRET`：邮箱 SMTP/IMAP/OAuth 凭据加密密钥。至少 16 字符，建议 32 字符以上；必须长期稳定保存，不能每次部署重新生成。更换它会导致已有邮箱配置无法解密，除非先做密钥轮换迁移。
- `EMAIL_OAUTH_STATE_SECRET`：Gmail/Outlook OAuth state 签名密钥。至少 16 字符，建议 32 字符以上；必须和 `EMAIL_CONFIG_SECRET` 使用不同随机值。
- `APP_BASE_URL`：对外访问地址，例如 `https://crm.example.com`，可选；优先建议放在 Variables，同名 Secret 仍兼容。
- `AI_API_KEY`：按需配置；如果启用 `RUN_EMAIL_AI_PROVIDER_TEST=true` 或 `REQUIRE_LIVE_EMAIL_READINESS=true`，该 Secret 必须存在，否则 workflow 会在部署前失败。
- `GMAIL_OAUTH_CLIENT_ID` / `GMAIL_OAUTH_CLIENT_SECRET`：使用 Gmail OAuth 时成对配置；只配置其中一个会被部署校验拒绝。
- `OUTLOOK_OAUTH_CLIENT_ID` / `OUTLOOK_OAUTH_CLIENT_SECRET`：使用 Outlook OAuth 时成对配置；只配置其中一个会被部署校验拒绝。
- `GHCR_USERNAME`、`GHCR_TOKEN`：GHCR 私有包拉取凭据，可选；公开包或默认 token 可用时不需要。

生成邮箱相关密钥：

```bash
npm run config:secrets
```

也可以用 OpenSSL 生成两条不同的随机值：

```bash
openssl rand -base64 32
openssl rand -base64 32
```

把两条值分别保存为 GitHub Actions Secrets：`EMAIL_CONFIG_SECRET` 和 `EMAIL_OAUTH_STATE_SECRET`。不要提交到 Git，也不要用 `.env.example` 里的 placeholder。

GitHub Actions Variables：

- `VPS_APP_PORT`：VPS 对外暴露的 Web 端口，例如 `3000`。手动运行 workflow 时填写的 `app_port` 会覆盖它。
- `VPS_PORT`：SSH 端口，默认 `22`；会优先覆盖同名 Secret。
- `APP_BASE_URL`：CRM 对外访问 origin，例如 `https://crm.example.com`；会优先覆盖同名 Secret。未设置时 workflow 会使用 `http://VPS_HOST:APP_PORT`。
- `POSTGRES_HOST`：默认 `postgres`，使用部署栈内置的 `pgvector/pgvector:pg16` 数据库容器。若你坚持使用外部 Postgres 容器并映射为 `5433:5432`，可改为 `host.docker.internal`。
- `POSTGRES_PORT`：默认 `5432`；外部 Postgres 容器映射为 `5433:5432` 时改为 `5433`。
- `POSTGRES_USER`：默认 `crm`。
- `POSTGRES_DB`：默认 `ai_agent_crm`。
- `ALLOW_INSECURE_APP_BASE_URL`：直接用 `http://ip:port` 部署时可设为 `true`；HTTPS 域名部署建议为 `false`。
- `SEED_ON_EMPTY`、`EMAIL_DELIVERY_MODE`、`EMAIL_SYNC_INTERVAL_MS`、`EMAIL_SYNC_LIMIT`、`EMAIL_SYNC_USER_ID`、`EMAIL_SYNC_JOB_TIMEOUT_MS`、`EMAIL_VERIFY_USER_ID`、`EMAIL_SEND_CLAIM_TIMEOUT_MS`、`MAIL_CONNECT_TIMEOUT_MS`、`MAIL_RESPONSE_TIMEOUT_MS`、`MAIL_FETCH_RESPONSE_TIMEOUT_MS`、`MAIL_IMAP_FETCH_BYTES`、`AI_PROVIDER`、`AI_BASE_URL`、`AI_MODEL`、`AI_TIMEOUT_MS`、`GMAIL_OAUTH_SCOPE`、`OUTLOOK_OAUTH_SCOPE`：按需覆盖默认值。
- `MAIL_IMAP_FETCH_BYTES`：IMAP 同步时单封邮件最多拉取的原始字节数，默认 `262144`，最大 `5000000`。邮箱服务响应慢或邮件附件较大导致同步超时时，可以先保持较小值让列表和正文先同步；需要更完整正文时再适当调大。
- `MAIL_FETCH_RESPONSE_TIMEOUT_MS`：IMAP `FETCH` 拉取正文的空闲超时，默认 `60000`；只要服务器持续返回数据就不会中断，如果超过该时间没有任何数据才会失败。
- `EMAIL_SYNC_JOB_TIMEOUT_MS`：单个邮箱账号一轮同步的总时限，默认 `540000`（9 分钟），最大 `1800000`。该值应小于前端/调度器的 stale 判定窗口，避免慢邮箱把状态长期卡在 running。
- `EMAIL_VERIFY_USER_ID`：部署后 `email:verify` 优先使用的管理员用户 ID，默认跟随 `EMAIL_SYNC_USER_ID`，再尝试 `user-admin`；如果该用户不存在，脚本会自动回退到第一个 active `crm.admin` 用户。全新空库可临时设置 `SEED_ON_EMPTY=true` 初始化演示管理员，随后改回 `false`。
- `RUN_EMAIL_CONNECTION_TESTS`、`RUN_EMAIL_AI_PROVIDER_TEST`、`RUN_EMAIL_SMOKE_TEST`：设为 `true` 时，每次自动部署都会在 VPS 的 `web` 容器内运行对应的 `email:verify` 真实邮箱、AI provider 或应用 smoke 检查。手动运行 workflow 时，也可以用 `run_email_connections`、`run_email_ai_provider`、`run_email_smoke` 输入临时开启。
- `REQUIRE_LIVE_EMAIL_READINESS`：设为 `true` 时，自动部署会追加 `email:verify --require-live-readiness`，并自动运行真实邮箱连接、AI provider 生成和 smoke 检查；只有 `readiness.liveTrafficReady=true` 才算成功。启用它后不需要再单独设置上面三个 `RUN_EMAIL_*` 变量。

部署前 workflow 会先校验配置：邮件密钥必须不是 placeholder、长度至少 16 字符且两条值不同；启用 AI provider 验证或 live readiness 时必须设置 `AI_API_KEY`；Gmail/Outlook OAuth client id 和 secret 必须成对出现；`EMAIL_DELIVERY_MODE`、`EMAIL_SYNC_INTERVAL_MS`、`EMAIL_SYNC_LIMIT`、`EMAIL_SEND_CLAIM_TIMEOUT_MS` 和 live readiness 组合也会在 SSH 前校验。

当前 VPS 部署默认创建专用 `pgvector/pgvector:pg16` 数据库容器，CRM 容器通过 `postgres:5432` 连接数据库；该部署栈管理 `web`、`worker`、`email-sync`、`postgres` 和 `redis`，并把 Postgres 数据、Redis 数据和备份目录挂载到 `/opt/ai-agent-crm`。workflow 会把 `/opt/ai-agent-crm/postgres-data` 和 `/opt/ai-agent-crm/redis-data` 修正为容器需要的 `999:999` 权限，避免 Postgres `global/pg_filenode.map: Permission denied` 或 Redis `Failed opening the temp RDB file ... Permission denied` 这类启动/健康检查错误。完整说明见 [`docs/vps-github-actions-deploy.md`](docs/vps-github-actions-deploy.md)。

每次 VPS 部署都会先清理旧的邮件验证结果，再把最近一次 `email:verify` 的完整 JSON 结果保存为 `/opt/ai-agent-crm/email-verify-last.json`，并把紧凑摘要保存为 `/opt/ai-agent-crm/email-verify-last-summary.txt`，便于回看 `liveTrafficReady`、blockers 和 manualActions。没有 `jq` 时可用 `npm run email:verify:report -- --file email-verify-last.json --fail-on-not-ready=false` 查看摘要。

## 数据库

正式交付以 `prisma/migrations` 为准。开发环境可临时使用 `npm run db:push` 对齐 schema，但不要用它替代生产迁移。

索引策略见 [docs/database-indexing.md](docs/database-indexing.md)。

## 安全说明

- Session cookie 使用 HttpOnly、SameSite=Lax，生产环境启用 Secure。
- 数据库只保存 session token 的 SHA-256 hash，不保存浏览器 cookie 中的原始 token。

## 运维

Docker Compose 启动、备份、恢复和升级步骤见 [docs/operations.md](docs/operations.md)。

生产环境安全配置校验见 [docs/deployment-security.md](docs/deployment-security.md)。
