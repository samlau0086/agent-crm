# 部署安全配置

生产环境启动前建议执行：

```bash
npm run config:validate
```

Docker 镜像启动时默认也会执行同一个校验脚本；除非紧急排障且已经人工确认风险，不要设置 `SKIP_ENV_VALIDATION=true`。

## 必填与高风险配置

- `DATABASE_URL`: 必须设置。
- `APP_BASE_URL`: 生产环境必须设置为应用对外访问地址，例如 `https://crm.example.com`。登录跳转和密码设置链接都会使用它。
- `ALLOW_TEST_USER_HEADER`: 生产环境必须保持关闭。`ALLOW_TEST_USER_HEADER=true` 会被启动校验直接拦截。
- `ALLOW_INSECURE_APP_BASE_URL`: 默认 `false`。公网生产地址必须使用 HTTPS；只有可信内网 HTTP 部署才应临时设置为 `true`。
- `ALLOW_PRIVATE_WEBHOOK_URLS`: 默认 `false`。生产环境 Webhook 不允许指向 localhost、私网、link-local 或单标签主机；投递前也会解析 DNS 并阻止解析到私网地址的目标。只有明确需要内网 Webhook 且已评估 SSRF 风险时才设置为 `true`。
- `REDIS_URL`: 当 `JOB_EXECUTOR=redis` 时必须设置。
- `EMAIL_CONFIG_SECRET`: 生产环境必须设置，至少 16 字符，用于加密邮箱连接凭据。用 `npm run config:secrets` 生成，不要使用 `.env.example` 的 placeholder。
- `EMAIL_OAUTH_STATE_SECRET`: 建议设置，至少 16 字符，用于签名邮箱 OAuth state；未设置时会回退到 `APP_SECRET` 或 `EMAIL_CONFIG_SECRET`。用 `npm run config:secrets` 生成，不要使用 placeholder。

## 警告级配置

以下配置不会阻止启动，但校验会输出警告：

- `SEED_ON_EMPTY=true`: 空生产库会灌入演示数据，正式部署建议设为 `false`。
- `AI_API_KEY` 为空：AI 会使用本地只读 fallback，不会调用远端模型。
- `APP_BASE_URL` 带路径、查询或 hash：建议只配置 origin，例如 `https://crm.example.com`。

## 验证示例

```bash
NODE_ENV=production npm run config:validate
```

需要把警告也作为失败处理时：

```bash
NODE_ENV=production npm run config:validate -- --strict
```

## HTTP 安全响应头

应用通过 `src/middleware.ts` 为页面和 API 响应统一添加基础安全头：

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: same-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`
- `Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; form-action 'self'`

当 `NODE_ENV=production` 且 `APP_BASE_URL` 使用 HTTPS 时，还会添加：

- `Strict-Transport-Security: max-age=31536000; includeSubDomains`

当前 CSP 先覆盖嵌入、防 base tag 注入和表单提交边界，不限制 `script-src`。如果后续要加入完整脚本 CSP，需要为 Next.js 运行时和第三方资源设计 nonce 或 hash 策略。

## 跨站写请求防护

应用中间件会检查 `POST`、`PATCH`、`DELETE` 等写请求：

- `Origin` 或 `Referer` 明确来自非信任来源时，返回 `403 CSRF_BLOCKED`。
- `Sec-Fetch-Site: cross-site` 的写请求会被直接阻止。
- 未携带浏览器来源头的服务端调用会继续进入 API 层，由 session 或 Bearer API key 认证决定是否允许。
- 本地开发时允许 `localhost` 与 `127.0.0.1` 之间的同端口环回地址差异。

生产环境应设置 `APP_BASE_URL`，让中间件在反向代理或容器内部地址与公网域名不一致时仍能识别可信来源。
