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

Compose 会启动 `web`、`postgres`、`redis`：

- `postgres` 通过 `pg_isready` 做健康检查。
- `redis` 通过 `redis-cli ping` 做健康检查。
- `web` 会等待数据库、执行 `prisma migrate deploy`，并在 `SEED_ON_EMPTY=true` 且数据库没有 workspace 时灌入演示数据。
- 应用健康检查地址：`/api/health`。

关键环境变量：

- `DATABASE_URL`：PostgreSQL 连接串。
- `APP_BASE_URL`：应用对外访问地址，用于登录跳转和密码设置链接，生产环境应设为真实 HTTPS 域名。
- `RUN_MIGRATIONS`：默认 `true`，容器启动时执行迁移。
- `SEED_ON_EMPTY`：默认建议生产为 `false`；演示环境可设为 `true`。
- `AI_PROVIDER`：默认 `openai-compatible`；没有 `AI_API_KEY` 时会自动使用本地只读 fallback。
- `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`：OpenAI-compatible `/chat/completions` provider 配置。
- `AI_TIMEOUT_MS`：AI provider 请求超时，默认 `10000`，超时或失败时回退到本地只读建议。
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

该命令会校验 Docker Compose 配置、构建镜像、启动服务、检查 `/api/health`，并在 `web` 容器内验证 PostgreSQL client 与备份 dry-run。没有 Docker 的开发环境可以先运行：

```bash
npm run deploy:verify -- --dry-run
```

## 数据库

正式交付以 `prisma/migrations` 为准。开发环境可临时使用 `npm run db:push` 对齐 schema，但不要用它替代生产迁移。

索引策略见 [docs/database-indexing.md](docs/database-indexing.md)。

## 安全说明

- Session cookie 使用 HttpOnly、SameSite=Lax，生产环境启用 Secure。
- 数据库只保存 session token 的 SHA-256 hash，不保存浏览器 cookie 中的原始 token。

## 运维

Docker Compose 启动、备份、恢复和升级步骤见 [docs/operations.md](docs/operations.md)。

生产环境安全配置校验见 [docs/deployment-security.md](docs/deployment-security.md)。
