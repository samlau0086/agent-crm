# 运维手册

本项目首版按私有化部署设计，默认运行在 Docker Compose 中：

- `web`: Next.js 应用和 API。
- `worker`: Redis 队列后台任务处理。
- `postgres`: CRM 主数据库。
- `redis`: 导入、Webhook 等后台任务队列基础设施。

## 启动

```bash
docker compose up --build -d
docker compose ps
```

健康检查：

```bash
curl http://127.0.0.1:3000/api/health
```

健康接口会返回 `database` 和 `jobs` 两组运行态状态。默认 inline 作业执行器只检查数据库；当 `JOB_EXECUTOR=redis` 时，接口会额外执行一次 Redis `PING`，Redis 不可用或缺少 `REDIS_URL` 时返回 HTTP 503。错误信息会脱敏连接串，不暴露密码。

部署验收：

```bash
npm run deploy:verify
```

该命令默认执行：

- `docker compose version`
- `docker compose config`
- `docker compose build`
- `docker compose up -d`
- 轮询 `http://127.0.0.1:3000/api/health`
- 在 `web` 容器内检查 `pg_dump --version`
- 在 `web` 容器内执行一次备份 dry-run

只查看将要执行的步骤，不启动容器：

```bash
npm run deploy:verify -- --dry-run
```

需要在验收时创建一份真实备份：

```bash
npm run deploy:verify -- --run-backup
```

如果部署机器使用不同端口或反向代理地址：

```bash
npm run deploy:verify -- --health-url http://127.0.0.1:8080/api/health
```

生产环境建议显式设置：

- `APP_BASE_URL=https://crm.example.com`: 应用对外访问地址，用于登录跳转和密码设置链接；不要依赖请求 `Origin` 头。
- `SEED_ON_EMPTY=false`: 避免空库自动灌入演示数据。
- `RUN_MIGRATIONS=true`: 容器启动时执行 Prisma 迁移。
- `AI_API_KEY`: 不配置时 AI 会使用本地只读 fallback。
- `BACKUP_DIR=/app/backups`: Web 管理台列出和下载备份文件的目录。
- `DB_MAINTENANCE_MODE=direct`: 容器内使用 PostgreSQL client 直连 `DATABASE_URL` 做备份。
- `HEALTHCHECK_TIMEOUT_MS=5000`: 按部署环境网络情况调整。

## 备份

Docker Compose 默认把宿主机 `./backups` 挂载到 `web` 容器内的 `/app/backups`。管理员在 CRM 设置页触发备份时，Web 容器会使用镜像内置的 `pg_dump` 通过 `DATABASE_URL` 直连数据库，并把 `.dump` 文件写入这个持久化目录。

命令行备份：

```bash
npm run db:backup
```

指定文件：

```bash
npm run db:backup -- backups/pre-upgrade.dump
```

只验证将要执行的备份计划，不实际连接数据库或写文件：

```bash
npm run db:backup -- --dry-run --mode=direct --output backups/pre-upgrade.dump
```

备份脚本支持三种模式：

- `auto`: 默认模式。有 `DATABASE_URL` 时优先使用 `pg_dump` 直连；如果 PostgreSQL client 不存在，则回退 Docker Compose。
- `direct`: 使用本机或容器内的 PostgreSQL client 直连 `DATABASE_URL`。
- `compose`: 使用 `docker compose exec postgres pg_dump`，适合宿主机只安装 Docker 的场景。

可选环境变量：

- `DATABASE_URL`: direct 模式使用的 PostgreSQL 连接串。
- `POSTGRES_SERVICE=postgres`: compose 模式的数据库服务名。
- `POSTGRES_USER=crm`: compose 模式的数据库用户。
- `POSTGRES_DB=ai_agent_crm`: compose 模式的数据库名。
- `BACKUP_DIR=backups`: Web 管理台列出和下载备份文件的目录。
- `DB_MAINTENANCE_MODE=auto`: `auto`、`direct` 或 `compose`。

管理员也可以在 CRM 设置页的“数据库备份”面板查看备份文件、触发一次备份，并下载已有 `.dump`、`.sql` 或 `.backup` 文件。下载接口只允许访问 `BACKUP_DIR` 内的备份文件名，不能读取任意路径。

## 恢复

恢复会覆盖目标数据库对象。实际执行恢复时必须显式传入 `yes` 或 `--yes`：

```bash
npm run db:restore -- backups/pre-upgrade.dump yes
```

恢复前先做 dry-run，确认输入文件、目标数据库和执行模式：

```bash
npm run db:restore -- backups/pre-upgrade.dump --dry-run --mode=direct
```

脚本支持 PostgreSQL custom dump，也支持 `.sql` 明文备份：

- `.dump` / `.backup`: 使用 `pg_restore --clean --if-exists --no-owner --no-acl`。
- `.sql`: 使用 `psql --set ON_ERROR_STOP=on`。

恢复操作刻意保留在命令行脚本中，不在 Web 管理台暴露按钮，避免管理员误触覆盖生产数据。

恢复前建议：

1. 停止写入流量，避免恢复过程中产生新数据。
2. 对当前库再做一次备份。
3. 执行 dry-run，确认恢复目标不是错误环境。
4. 执行恢复。
5. 恢复后执行健康检查和核心 E2E。

```bash
curl http://127.0.0.1:3000/api/health
npm run test:e2e
```

## 升级顺序

```bash
npm run db:backup -- backups/before-upgrade.dump
docker compose pull
docker compose up --build -d
docker compose logs -f web
```

`web` 容器启动时会按 `RUN_MIGRATIONS=true` 执行 `prisma migrate deploy`。如果迁移失败，不要反复重启容器；先查看 `web` 日志和数据库连接配置。

## 权限检查

管理员可以在设置页查看权限矩阵。当前内置权限包括：

- `crm.read`
- `crm.write`
- `crm.import`
- `crm.admin`
- `ai.use`

新增权限时需要同步更新 `src/lib/auth/permissions.ts`，否则设置页会缺少权限说明。
