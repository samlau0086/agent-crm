import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { createAiProvider } from "../src/lib/ai/provider.ts";
import { buildAiQueryPlan, validateAiQueryPlan } from "../src/lib/ai/query-planner.ts";
import { assertReadOnlyAiQuestion } from "../src/lib/ai/query-guard.ts";
import { getApiErrorAuditCredential } from "../src/lib/api-audit.ts";
import { ApiError, toApiErrorPayload } from "../src/lib/api-error.ts";
import { parseFormBody, parseJsonBody } from "../src/lib/api-validation.ts";
import { createApiKeyToken, getApiKeyTokenPrefix, hashApiKeyToken, getBearerToken } from "../src/lib/auth/api-key.ts";
import { clearFailedLogin, isLoginRateLimited, recordFailedLogin, resetLoginRateLimitsForTests } from "../src/lib/auth/login-rate-limit.ts";
import { createPasswordSetupToken, hashPasswordSetupToken, normalizePasswordSetupPurpose } from "../src/lib/auth/password-setup.ts";
import { createSessionToken, hashSessionToken } from "../src/lib/auth/session.ts";
import { describePermission, permissionCatalog } from "../src/lib/auth/permissions.ts";
import {
  csvImportSchema,
  importPresetCreateSchema,
  MAX_CSV_IMPORT_CHARS,
  MAX_IMPORT_MAPPING_FIELDS,
  MAX_SAVED_VIEW_COLUMNS,
  MAX_SAVED_VIEW_FILTERS,
  savedViewCreateSchema
} from "../src/lib/crm/api-schemas.ts";
import { defaultWorkspaceId, seedData } from "../src/lib/crm/seed.ts";
import { CrmStore } from "../src/lib/crm/store.ts";
import { formatAuditAction } from "../src/lib/crm/audit-labels.ts";
import { buildCsv } from "../src/lib/crm/csv.ts";
import { buildImportJobObservability } from "../src/lib/crm/import-observability.ts";
import { parseAuditLogQuery } from "../src/lib/crm/audit-query.ts";
import { parseRecordListQuery } from "../src/lib/crm/record-query.ts";
import { getBackupFile, listBackupFiles, resolveBackupFilePath } from "../src/lib/ops/backups.ts";
import { assertValidFieldDefinition, validateRecordPayload } from "../src/lib/crm/validation.ts";
import { compareRecords, findRelatedRecords, matchesSavedView } from "../src/lib/crm/views.ts";
import { assertValidWebhookEvents, assertValidWebhookUrl, assertWebhookDeliveryTarget, buildWebhookSignatureHeader, createWebhookSecret, signWebhookPayload } from "../src/lib/integrations/webhook.ts";
import { buildCsvImportJobEnvelope, buildWebhookEventEnvelope, InlineBackgroundJobExecutor } from "../src/lib/jobs/executor.ts";
import { encodeRedisCommand, getDeadLetterQueueName } from "../src/lib/jobs/redis-queue.ts";
import { buildFailedJobEnvelope, getMaxJobAttempts } from "../src/lib/jobs/worker-policy.ts";
import { checkJobHealth, toSafeHealthError } from "../src/lib/ops/health.ts";
import { appUrl, getAppBaseUrl } from "../src/lib/security/app-origin.ts";
import { shouldBlockCrossSiteMutation } from "../src/lib/security/csrf.ts";
import { applySecurityHeaders, buildSecurityHeaders } from "../src/lib/security/headers.ts";
import { shouldProceedWithDangerousAction } from "../src/lib/ui/confirm.ts";

const results = [];

async function run(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error });
  }
}

await run("field definition rejects invalid key", () => {
  assert.throws(() => assertValidFieldDefinition({ key: "Bad Key", label: "Bad field", type: "text" }), /key/);
});

await run("field definition requires select options", () => {
  assert.throws(() => assertValidFieldDefinition({ key: "tier", label: "Tier", type: "select" }), /options/);
});

await run("record validation rejects missing required value", () => {
  const emailField = {
    id: "field-email",
    workspaceId: "workspace-private",
    objectKey: "contacts",
    key: "email",
    label: "Email",
    type: "text",
    required: true,
    unique: true,
    isSystem: true,
    position: 1
  };

  assert.throws(() => validateRecordPayload([emailField], {}, []), /Email/);
});

await run("session tokens are random and stored as one-way hashes", () => {
  const tokenA = createSessionToken();
  const tokenB = createSessionToken();
  const hashA = hashSessionToken(tokenA);

  assert.notEqual(tokenA, tokenB);
  assert.notEqual(hashA, tokenA);
  assert.equal(hashA, hashSessionToken(tokenA));
  assert.match(hashA, /^[0-9a-f]{64}$/);
});

await run("api key tokens are random hashed and bearer parseable", () => {
  const tokenA = createApiKeyToken();
  const tokenB = createApiKeyToken();
  const hashA = hashApiKeyToken(tokenA);

  assert.match(tokenA, /^crm_live_/);
  assert.notEqual(tokenA, tokenB);
  assert.notEqual(hashA, tokenA);
  assert.equal(hashA, hashApiKeyToken(tokenA));
  assert.match(hashA, /^[0-9a-f]{64}$/);
  assert.equal(getApiKeyTokenPrefix(tokenA), tokenA.slice(0, 18));
  assert.equal(getBearerToken(`Bearer ${tokenA}`), tokenA);
  assert.equal(getBearerToken("Basic abc"), undefined);
});

await run("webhook secrets sign payloads with timestamped hmac headers", () => {
  const secret = createWebhookSecret();
  const payload = JSON.stringify({ event: "webhook.test" });
  const signature = signWebhookPayload(secret, payload, 123);
  const header = buildWebhookSignatureHeader(secret, payload, 123);

  assert.match(secret, /^whsec_/);
  assert.match(signature, /^[0-9a-f]{64}$/);
  assert.equal(header, `t=123,v1=${signature}`);
  assert.deepEqual(assertValidWebhookEvents(["webhook.test", "record.created", "webhook.test"]), ["webhook.test", "record.created"]);
  assert.throws(() => assertValidWebhookEvents(["bad.event"]), /unsupported events/);
  assert.equal(assertValidWebhookUrl("https://example.com/hook", { NODE_ENV: "production" }), "https://example.com/hook");
  assert.equal(assertValidWebhookUrl("http://127.0.0.1:9/hook", { NODE_ENV: "development" }), "http://127.0.0.1:9/hook");
  assert.equal(assertValidWebhookUrl("http://10.0.0.5/hook", { NODE_ENV: "production", ALLOW_PRIVATE_WEBHOOK_URLS: "true" }), "http://10.0.0.5/hook");
  assert.throws(() => assertValidWebhookUrl("http://example.com/hook", { NODE_ENV: "development" }), /HTTPS/);
  assert.throws(() => assertValidWebhookUrl("https://127.0.0.1/hook", { NODE_ENV: "production" }), /private network/);
  assert.throws(() => assertValidWebhookUrl("https://localhost/hook", { NODE_ENV: "production" }), /private network/);
  assert.throws(() => assertValidWebhookUrl("https://metadata/hook", { NODE_ENV: "production" }), /private network/);
  assert.throws(() => assertValidWebhookUrl("https://user:pass@example.com/hook", { NODE_ENV: "production" }), /credentials/);
});

await run("webhook delivery target validation blocks DNS rebinding to private addresses", async () => {
  await assertWebhookDeliveryTarget("https://hooks.example.com/crm", {
    env: { NODE_ENV: "production" },
    resolver: async () => [{ address: "203.0.113.10", family: 4 }]
  });

  await assert.rejects(
    () =>
      assertWebhookDeliveryTarget("https://hooks.example.com/crm", {
        env: { NODE_ENV: "production" },
        resolver: async () => [{ address: "10.0.0.5", family: 4 }]
      }),
    /private network/
  );

  await assert.rejects(
    () =>
      assertWebhookDeliveryTarget("https://hooks.example.com/crm", {
        env: { NODE_ENV: "production" },
        resolver: async () => [{ address: "127.0.0.1", family: 4 }]
      }),
    /private network/
  );

  await assertWebhookDeliveryTarget("https://hooks.example.com/crm", {
    env: { NODE_ENV: "production", ALLOW_PRIVATE_WEBHOOK_URLS: "true" },
    resolver: async () => [{ address: "10.0.0.5", family: 4 }]
  });
});

await run("password setup tokens are random one-way values with constrained purposes", () => {
  const tokenA = createPasswordSetupToken();
  const tokenB = createPasswordSetupToken();
  const hashA = hashPasswordSetupToken(tokenA);

  assert.notEqual(tokenA, tokenB);
  assert.notEqual(hashA, tokenA);
  assert.equal(hashA, hashPasswordSetupToken(tokenA));
  assert.match(hashA, /^[0-9a-f]{64}$/);
  assert.equal(normalizePasswordSetupPurpose("invite"), "invite");
  assert.equal(normalizePasswordSetupPurpose("anything-else"), "reset");
});

await run("login rate limit locks repeated failed attempts by email and ip", () => {
  const previousMax = process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS;
  const previousWindow = process.env.LOGIN_RATE_LIMIT_WINDOW_MS;
  const previousLock = process.env.LOGIN_RATE_LIMIT_LOCK_MS;
  process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS = "3";
  process.env.LOGIN_RATE_LIMIT_WINDOW_MS = "60000";
  process.env.LOGIN_RATE_LIMIT_LOCK_MS = "120000";
  resetLoginRateLimitsForTests();
  try {
    const identity = { email: "Admin@Example.com", ip: "10.0.0.1" };
    const otherIp = { email: "admin@example.com", ip: "10.0.0.2" };

    assert.equal(isLoginRateLimited(identity, 1000).limited, false);
    assert.equal(recordFailedLogin(identity, 1000).limited, false);
    assert.equal(recordFailedLogin(identity, 2000).limited, false);
    assert.equal(recordFailedLogin(identity, 3000).limited, true);
    assert.equal(isLoginRateLimited(identity, 4000).limited, true);
    assert.equal(isLoginRateLimited(otherIp, 4000).limited, false);

    clearFailedLogin(identity);
    assert.equal(isLoginRateLimited(identity, 5000).limited, false);
  } finally {
    resetLoginRateLimitsForTests();
    restoreEnv("LOGIN_RATE_LIMIT_MAX_ATTEMPTS", previousMax);
    restoreEnv("LOGIN_RATE_LIMIT_WINDOW_MS", previousWindow);
    restoreEnv("LOGIN_RATE_LIMIT_LOCK_MS", previousLock);
  }
});

await run("api helpers return structured invalid json and validation errors", async () => {
  await assert.rejects(
    () => parseJsonBody(new Request("http://local.test", { method: "POST", body: "{", headers: { "content-type": "application/json" } })),
    (error) => error instanceof ApiError && error.status === 400 && error.code === "INVALID_JSON"
  );

  await assert.rejects(
    () =>
      parseJsonBody(
        new Request("http://local.test", {
          method: "POST",
          body: JSON.stringify({ email: "not-an-email" }),
          headers: { "content-type": "application/json" }
        }),
        z.object({ email: z.string().email() })
      ),
    (error) => error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_ERROR"
  );

  const { status, payload } = toApiErrorPayload(new ApiError(403, "FORBIDDEN", "Missing permission: crm.admin"));
  assert.equal(status, 403);
  assert.equal(payload.code, "FORBIDDEN");
  assert.equal(payload.error, "Missing permission: crm.admin");
});

await run("api json helper rejects oversized request bodies", async () => {
  await assert.rejects(
    () =>
      parseJsonBody(
        new Request("http://local.test", {
          method: "POST",
          body: JSON.stringify({ value: "too large" }),
          headers: { "content-type": "application/json", "content-length": "100" }
        }),
        z.object({ value: z.string() }),
        { maxBytes: 10 }
      ),
    (error) => error instanceof ApiError && error.status === 413 && error.code === "PAYLOAD_TOO_LARGE"
  );

  await assert.rejects(
    () =>
      parseJsonBody(
        new Request("http://local.test", {
          method: "POST",
          body: JSON.stringify({ value: "abcdef" }),
          headers: { "content-type": "application/json" }
        }),
        z.object({ value: z.string() }),
        { maxBytes: 5 }
      ),
    (error) => error instanceof ApiError && error.status === 413 && error.code === "PAYLOAD_TOO_LARGE"
  );
});

await run("api form helper rejects non-form request bodies", async () => {
  const form = await parseFormBody(
    new Request("http://local.test", {
      method: "POST",
      body: new URLSearchParams({ email: "admin@example.com", password: "Admin123!" })
    })
  );

  assert.equal(form.get("email"), "admin@example.com");
  await assert.rejects(
    () =>
      parseFormBody(
        new Request("http://local.test", {
          method: "POST",
          body: JSON.stringify({ email: "admin@example.com" }),
          headers: { "content-type": "application/json" }
        })
      ),
    (error) => error instanceof ApiError && error.status === 400 && error.code === "BAD_REQUEST"
  );
});

await run("api form helper rejects oversized urlencoded bodies without content length", async () => {
  await assert.rejects(
    () =>
      parseFormBody(
        new Request("http://local.test", {
          method: "POST",
          body: new URLSearchParams({ token: "abc", password: "x".repeat(20) }),
          headers: { "content-type": "application/x-www-form-urlencoded" }
        }),
        { maxBytes: 10 }
      ),
    (error) => error instanceof ApiError && error.status === 413 && error.code === "PAYLOAD_TOO_LARGE"
  );
});

await run("crm api schemas cap oversized import and view payloads", () => {
  assert.equal(
    csvImportSchema.safeParse({
      objectKey: "contacts",
      csv: "x".repeat(MAX_CSV_IMPORT_CHARS + 1)
    }).success,
    false
  );

  const oversizedMapping = Object.fromEntries(Array.from({ length: MAX_IMPORT_MAPPING_FIELDS + 1 }, (_, index) => [`Column ${index}`, `field_${index}`]));
  assert.equal(
    importPresetCreateSchema.safeParse({
      objectKey: "contacts",
      name: "Oversized Mapping",
      mapping: oversizedMapping
    }).success,
    false
  );

  assert.equal(
    savedViewCreateSchema.safeParse({
      objectKey: "contacts",
      name: "Oversized View",
      columns: Array.from({ length: MAX_SAVED_VIEW_COLUMNS + 1 }, (_, index) => `field_${index}`),
      isDefault: false
    }).success,
    false
  );

  assert.equal(
    savedViewCreateSchema.safeParse({
      objectKey: "contacts",
      name: "Oversized Filters",
      columns: ["title"],
      filters: Array.from({ length: MAX_SAVED_VIEW_FILTERS + 1 }, (_, index) => ({ field: `field_${index}`, operator: "contains", value: "x" })),
      isDefault: false
    }).success,
    false
  );
});

await run("api error audit credentials prefer bearer tokens over session cookies", () => {
  const credential = getApiErrorAuditCredential(
    new Request("http://local.test/api/records/contacts", {
      headers: {
        authorization: "Bearer crm_live_test_token",
        cookie: "crm_session=session-token"
      }
    })
  );

  assert.deepEqual(credential, { type: "api_key", token: "crm_live_test_token" });
});

await run("api error audit credentials allow test user header only when enabled", () => {
  const previous = process.env.ALLOW_TEST_USER_HEADER;
  try {
    delete process.env.ALLOW_TEST_USER_HEADER;
    assert.equal(
      getApiErrorAuditCredential(new Request("http://local.test/api/records/contacts", { headers: { "x-user-id": "user-admin" } })),
      undefined
    );

    process.env.ALLOW_TEST_USER_HEADER = "true";
    assert.deepEqual(
      getApiErrorAuditCredential(new Request("http://local.test/api/records/contacts", { headers: { "x-user-id": "user-admin" } })),
      { type: "test_user", userId: "user-admin" }
    );
  } finally {
    restoreEnv("ALLOW_TEST_USER_HEADER", previous);
  }
});

await run("api error audit credentials fall back to session cookie", () => {
  assert.deepEqual(
    getApiErrorAuditCredential(new Request("http://local.test/api/records/contacts", { headers: { cookie: "theme=dark; crm_session=session-token" } })),
    { type: "session", token: "session-token" }
  );
});

await run("app base url ignores untrusted origin headers and supports configured public url", () => {
  const previous = process.env.APP_BASE_URL;
  try {
    delete process.env.APP_BASE_URL;
    assert.equal(getAppBaseUrl("http://internal.local/api/auth/login"), "http://internal.local");
    assert.equal(String(appUrl("/login?error=invalid", "http://internal.local/api/auth/login")), "http://internal.local/login?error=invalid");
    assert.equal(
      getAppBaseUrl(new Request("http://localhost:3014/api/auth/login", { headers: { origin: "http://127.0.0.1:3014" } })),
      "http://127.0.0.1:3014"
    );
    assert.equal(
      getAppBaseUrl(new Request("https://crm.example.com/api/auth/login", { headers: { origin: "https://evil.example" } })),
      "https://crm.example.com"
    );

    process.env.APP_BASE_URL = "https://crm.example.com/app";
    assert.equal(getAppBaseUrl("http://internal.local/api/auth/login"), "https://crm.example.com");
    assert.equal(String(appUrl("/setup-password?token=abc", "http://internal.local/api/users/user-1/password-link")), "https://crm.example.com/setup-password?token=abc");
  } finally {
    restoreEnv("APP_BASE_URL", previous);
  }
});

await run("security headers include framing referrer permissions and production hsts", () => {
  const developmentHeaders = new Headers();
  applySecurityHeaders(developmentHeaders, { NODE_ENV: "development", APP_BASE_URL: "https://crm.example.com" });
  assert.equal(developmentHeaders.get("X-Content-Type-Options"), "nosniff");
  assert.equal(developmentHeaders.get("X-Frame-Options"), "DENY");
  assert.equal(developmentHeaders.get("Referrer-Policy"), "same-origin");
  assert.match(developmentHeaders.get("Permissions-Policy") ?? "", /camera=\(\)/);
  assert.match(developmentHeaders.get("Content-Security-Policy") ?? "", /frame-ancestors 'none'/);
  assert.equal(developmentHeaders.get("Strict-Transport-Security"), null);

  const productionHeaders = buildSecurityHeaders({ NODE_ENV: "production", APP_BASE_URL: "https://crm.example.com" });
  assert.deepEqual(
    productionHeaders.find(([name]) => name === "Strict-Transport-Security"),
    ["Strict-Transport-Security", "max-age=31536000; includeSubDomains"]
  );
  assert.equal(buildSecurityHeaders({ NODE_ENV: "production", APP_BASE_URL: "http://127.0.0.1:3000" }).some(([name]) => name === "Strict-Transport-Security"), false);
});

await run("cross-site mutation guard blocks browser-origin writes without blocking server calls", () => {
  const previous = process.env.APP_BASE_URL;
  try {
    delete process.env.APP_BASE_URL;
    assert.equal(
      shouldBlockCrossSiteMutation({
        method: "POST",
        url: "http://localhost:3014/api/records/contacts",
        origin: "http://127.0.0.1:3014"
      }),
      false
    );
    assert.equal(
      shouldBlockCrossSiteMutation({
        method: "POST",
        url: "https://crm.example.com/api/records/contacts",
        origin: "https://evil.example"
      }),
      true
    );
    assert.equal(
      shouldBlockCrossSiteMutation({
        method: "GET",
        url: "https://crm.example.com/api/records/contacts",
        origin: "https://evil.example"
      }),
      false
    );
    assert.equal(
      shouldBlockCrossSiteMutation({
        method: "PATCH",
        url: "https://crm.example.com/api/records/contacts/1"
      }),
      false
    );
    assert.equal(
      shouldBlockCrossSiteMutation({
        method: "DELETE",
        url: "https://crm.example.com/api/records/contacts/1",
        secFetchSite: "cross-site"
      }),
      true
    );

    process.env.APP_BASE_URL = "https://crm.example.com";
    assert.equal(
      shouldBlockCrossSiteMutation({
        method: "POST",
        url: "http://internal:3000/api/records/contacts",
        origin: "https://crm.example.com"
      }),
      false
    );
  } finally {
    restoreEnv("APP_BASE_URL", previous);
  }
});

await run("record list query accepts search alias and q precedence", () => {
  const aliasQuery = parseRecordListQuery({
    nextUrl: new URL("http://local.test/api/records/contacts?search=Acme&page=2&pageSize=25")
  });
  assert.equal(aliasQuery.q, "Acme");
  assert.equal(aliasQuery.page, 2);
  assert.equal(aliasQuery.pageSize, 25);

  const explicitQuery = parseRecordListQuery({
    nextUrl: new URL("http://local.test/api/records/contacts?q=Primary&search=Fallback")
  });
  assert.equal(explicitQuery.q, "Primary");
});

await run("list query pagination accepts only positive integers and caps page size", () => {
  const invalidRecordQuery = parseRecordListQuery({
    nextUrl: new URL("http://local.test/api/records/contacts?page=-2&pageSize=2.5")
  });
  assert.equal(invalidRecordQuery.page, undefined);
  assert.equal(invalidRecordQuery.pageSize, undefined);

  const cappedRecordQuery = parseRecordListQuery({
    nextUrl: new URL("http://local.test/api/records/contacts?page=3&pageSize=9999")
  });
  assert.equal(cappedRecordQuery.page, 3);
  assert.equal(cappedRecordQuery.pageSize, 200);

  const cappedAuditQuery = parseAuditLogQuery({
    nextUrl: new URL("http://local.test/api/audit-logs?page=4&pageSize=9999")
  });
  assert.equal(cappedAuditQuery.page, 4);
  assert.equal(cappedAuditQuery.pageSize, 200);
});

await run("dangerous action confirmation follows the provided confirm result", () => {
  const messages = [];
  assert.equal(shouldProceedWithDangerousAction("Delete record?", (message) => {
    messages.push(message);
    return false;
  }), false);
  assert.deepEqual(messages, ["Delete record?"]);
  assert.equal(shouldProceedWithDangerousAction("Delete record?", () => true), true);
  assert.equal(shouldProceedWithDangerousAction("Delete record?", undefined), true);
});

await run("audit action labels are readable Chinese text", () => {
  assert.equal(formatAuditAction("create"), "创建");
  assert.equal(formatAuditAction("update"), "更新");
  assert.equal(formatAuditAction("delete"), "删除");
  assert.equal(formatAuditAction("import"), "导入");
  assert.equal(formatAuditAction("api_error"), "API 错误");
  for (const action of ["create", "update", "delete", "import", "api_error"]) {
    assert.doesNotMatch(formatAuditAction(action), /\?\?|锛|銆|\uFFFD/);
  }
});

await run("csv builder escapes commas quotes newlines and object values", () => {
  const csv = buildCsv(["name", "note", "meta"], [{ name: "Acme, Inc.", note: "He said \"yes\"\nsoon", meta: { tier: "gold" } }]);

  assert.equal(csv, 'name,note,meta\r\n"Acme, Inc.","He said ""yes""\nsoon","{""tier"":""gold""}"');
});

await run("backup file listing includes only backup artifacts", async () => {
  const directory = join(tmpdir(), `ai-agent-crm-backups-${Date.now()}`);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(join(directory, "latest.dump"), "dump");
    await writeFile(join(directory, "manual.sql"), "select 1;");
    await writeFile(join(directory, "notes.txt"), "ignore");

    const backups = await listBackupFiles(directory);

    assert.deepEqual(
      backups.map((backup) => backup.name).sort(),
      ["latest.dump", "manual.sql"]
    );
    assert.equal(backups.every((backup) => backup.sizeBytes > 0), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await run("backup file access is constrained to named backup artifacts", async () => {
  const directory = join(tmpdir(), `ai-agent-crm-backup-access-${Date.now()}`);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(join(directory, "latest.dump"), "dump");

    const backup = await getBackupFile("latest.dump", directory);

    assert.equal(backup?.name, "latest.dump");
    assert.equal(resolveBackupFilePath("latest.dump", directory), join(directory, "latest.dump"));
    assert.throws(() => resolveBackupFilePath("../latest.dump", directory), /Invalid backup file name/);
    assert.throws(() => resolveBackupFilePath("latest.txt", directory), /Invalid backup file name/);
    assert.equal(await getBackupFile("missing.dump", directory), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await run("database backup dry run can use direct pg_dump with DATABASE_URL", () => {
  const output = join(tmpdir(), `ai-agent-crm-dry-backup-${Date.now()}.dump`);
  const databaseUrl = "postgresql://crm:crm@postgres:5432/ai_agent_crm?schema=public";
  const result = spawnSync(process.execPath, ["scripts/db-backup.mjs", "--dry-run", "--mode=direct", "--output", output], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: databaseUrl }
  });

  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.output, output);
  assert.equal(plan.mode, "direct");
  assert.equal(plan.candidates.length, 1);
  assert.equal(plan.candidates[0].kind, "direct");
  assert.equal(plan.candidates[0].command, "pg_dump");
  assert.deepEqual(plan.candidates[0].args, ["--format=custom", "--no-owner", "--no-acl", databaseUrl]);
});

await run("database restore dry run can use direct pg_restore with DATABASE_URL", async () => {
  const directory = join(tmpdir(), `ai-agent-crm-dry-restore-${Date.now()}`);
  const input = join(directory, "restore.dump");
  const databaseUrl = "postgresql://crm:crm@postgres:5432/ai_agent_crm?schema=public";

  await mkdir(directory, { recursive: true });
  await writeFile(input, "not a real dump", "utf8");
  try {
    const result = spawnSync(process.execPath, ["scripts/db-restore.mjs", input, "--dry-run", "--mode=direct"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: databaseUrl }
    });

    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.input, input);
    assert.equal(plan.mode, "direct");
    assert.equal(plan.candidates.length, 1);
    assert.equal(plan.candidates[0].kind, "direct");
    assert.equal(plan.candidates[0].command, "pg_restore");
    assert.deepEqual(plan.candidates[0].args, ["--dbname", databaseUrl, "--clean", "--if-exists", "--no-owner", "--no-acl", input]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await run("deployment verification dry run describes docker health and backup checks", () => {
  const healthUrl = "http://127.0.0.1:3999/api/health";
  const backupOutput = "/app/backups/deploy-verify-test.dump";
  const result = spawnSync(
    process.execPath,
    ["scripts/deploy-verify.mjs", "--dry-run", "--skip-build", "--skip-up", "--health-url", healthUrl, "--backup-output", backupOutput],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.healthUrl, healthUrl);
  assert.equal(plan.backupOutput, backupOutput);
  assert.deepEqual(
    plan.steps.map((step) => step.name),
    [
      "Check Docker Compose",
      "Validate Docker Compose config",
      "Check application health",
      "Validate web container environment",
      "Verify PostgreSQL client inside web container",
      "Verify container backup plan"
    ]
  );
  assert.equal(plan.steps.find((step) => step.name === "Check application health")?.url, healthUrl);
  assert.deepEqual(plan.steps.find((step) => step.name === "Validate web container environment")?.args, [
    "compose",
    "exec",
    "-T",
    "web",
    "node",
    "scripts/validate-env.mjs"
  ]);
  assert.deepEqual(plan.steps.find((step) => step.name === "Verify PostgreSQL client inside web container")?.args, [
    "compose",
    "exec",
    "-T",
    "web",
    "pg_dump",
    "--version"
  ]);
  assert.deepEqual(plan.steps.find((step) => step.name === "Verify container backup plan")?.args, [
    "compose",
    "exec",
    "-T",
    "web",
    "node",
    "scripts/db-backup.mjs",
    "--dry-run",
    "--mode=direct",
    "--output",
    backupOutput
  ]);
});

await run("production environment validation blocks dangerous test auth header", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-env.mjs", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://crm:crm@postgres:5432/ai_agent_crm?schema=public",
      APP_BASE_URL: "https://crm.example.com",
      ALLOW_TEST_USER_HEADER: "true"
    }
  });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.errors.join("\n"), /ALLOW_TEST_USER_HEADER/);
});

await run("production environment validation blocks insecure public app base url", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-env.mjs", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://crm:crm@postgres:5432/ai_agent_crm?schema=public",
      APP_BASE_URL: "http://crm.example.com"
    }
  });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.errors.join("\n"), /https/);
});

await run("production environment validation allows local compose but warns on demo seed", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-env.mjs", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://crm:crm@postgres:5432/ai_agent_crm?schema=public",
      APP_BASE_URL: "http://127.0.0.1:3000",
      JOB_EXECUTOR: "redis",
      REDIS_URL: "redis://redis:6379",
      SEED_ON_EMPTY: "true"
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.match(payload.warnings.join("\n"), /SEED_ON_EMPTY/);
});

await run("permission catalog describes every seeded permission", () => {
  const catalogKeys = permissionCatalog.map((permission) => permission.key);
  const seededPermissions = [...new Set(seedData.roles.flatMap((role) => role.permissions))];

  assert.equal(new Set(catalogKeys).size, catalogKeys.length);
  assert.deepEqual(
    seededPermissions.filter((permission) => !catalogKeys.includes(permission)),
    []
  );
  for (const permission of permissionCatalog) {
    assert.equal(describePermission(permission.key).key, permission.key);
    assert.ok(permission.label);
    assert.ok(permission.description);
  }
});

await run("admins can create update and delete unassigned roles", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const role = store.createRole(context, {
    name: "Import Operator",
    permissions: ["crm.read", "crm.import"]
  });

  const updated = store.updateRole(context, role.id, {
    name: "Import Manager",
    permissions: ["crm.read", "crm.import", "ai.use"]
  });

  assert.equal(updated.name, "Import Manager");
  assert.deepEqual(updated.permissions, ["crm.read", "crm.import", "ai.use"]);
  assert.equal(store.listRoles(context).some((candidate) => candidate.id === role.id), true);

  store.deleteRole(context, role.id);
  assert.equal(store.listRoles(context).some((candidate) => candidate.id === role.id), false);
});

await run("role management blocks unsafe permission changes", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");

  assert.throws(
    () => store.createRole(context, { name: "Bad Role", permissions: ["crm.read", "crm.drop"] }),
    /unsupported permissions/
  );
  assert.throws(() => store.deleteRole(context, "role-sales"), /assigned to 1 users/);
  assert.throws(() => store.updateRole(context, "role-admin", { permissions: ["crm.read", "crm.write"] }), /crm\.admin/);
});

await run("admins can manage teams and user assignments", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const team = store.createTeam(context, { name: "Enterprise Sales" });
  const role = store.createRole(context, { name: "Account Executive", permissions: ["crm.read", "crm.write"] });
  const user = store.createUser(context, {
    email: "new-sales@example.com",
    name: "New Sales",
    roleId: role.id,
    teamId: team.id,
    password: "NewSales123!"
  });

  assert.equal(user.email, "new-sales@example.com");
  assert.equal(user.teamId, team.id);

  const updatedTeam = store.updateTeam(context, team.id, { name: "Strategic Sales" });
  const updatedUser = store.updateUser(context, user.id, { name: "Strategic Seller", teamId: "", password: "Changed123!" });

  assert.equal(updatedTeam.name, "Strategic Sales");
  assert.equal(updatedUser.name, "Strategic Seller");
  assert.equal(updatedUser.teamId, undefined);
  const disabledUser = store.updateUser(context, user.id, { active: false });
  assert.equal(disabledUser.active, false);
  assert.throws(() => store.getContext(user.id), /disabled/);

  store.deleteTeam(context, team.id);
  assert.equal(store.listTeams(context).some((candidate) => candidate.id === team.id), false);
});

await run("user and team management blocks unsafe changes", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");

  assert.throws(
    () => store.createUser(context, { email: "bad", name: "Bad User", roleId: "role-sales", password: "Password123!" }),
    /email/
  );
  assert.throws(
    () => store.createUser(context, { email: "short@example.com", name: "Short Password", roleId: "role-sales", password: "short" }),
    /Password/
  );
  assert.throws(() => store.deleteTeam(context, "team-sales"), /assigned to 2 users/);
  assert.throws(() => store.updateUser(context, "user-admin", { roleId: "role-sales" }), /crm\.admin/);
  assert.throws(() => store.updateUser(context, "user-admin", { active: false }), /crm\.admin/);
});

await run("admins can create custom metadata and records", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const object = store.createObjectDefinition(context, {
    key: "regions",
    label: "Region",
    pluralLabel: "Regions",
    description: "Sales regions",
    icon: "Map"
  });

  store.createFieldDefinition(context, {
    objectKey: object.key,
    key: "code",
    label: "Region code",
    type: "text",
    required: true,
    unique: true
  });

  const record = store.createRecord(context, object.key, { title: "East China", data: { code: "east" } });
  assert.equal(record.title, "East China");
  assert.equal(store.listRecords(context, "regions").length, 1);
});

await run("admins can create and revoke api keys without storing the plaintext token", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const created = store.createApiKey(context, {
    name: "Warehouse Sync",
    permissions: ["crm.read", "crm.import"]
  });

  assert.match(created.token, /^crm_live_/);
  assert.equal(created.apiKey.name, "Warehouse Sync");
  assert.deepEqual(created.apiKey.permissions, ["crm.read", "crm.import"]);
  assert.equal("tokenHash" in created.apiKey, false);
  assert.equal(store.listApiKeys(context).some((apiKey) => apiKey.id === created.apiKey.id), true);

  const revoked = store.revokeApiKey(context, created.apiKey.id);
  assert.equal(Boolean(revoked.revokedAt), true);
  assert.equal(store.listAuditLogs(context, { entityType: "api_key" }).some((log) => log.entityId === created.apiKey.id), true);
});

await run("api key management requires admin and blocks admin-scoped keys", () => {
  const store = new CrmStore();
  const adminContext = store.getContext("user-admin");
  const salesContext = store.getContext("user-sales");

  assert.throws(() => store.listApiKeys(salesContext), /crm\.admin/);
  assert.throws(() => store.createApiKey(salesContext, { name: "Nope", permissions: ["crm.read"] }), /crm\.admin/);
  assert.throws(() => store.createApiKey(adminContext, { name: "Too Powerful", permissions: ["crm.admin"] }), /unsupported permissions/);
});

await run("admins can create update and test webhooks without exposing stored secrets", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const created = store.createWebhook(context, {
    name: "Ops Hook",
    url: "https://example.com/webhooks/crm",
    events: ["webhook.test", "record.created"]
  });

  assert.match(created.secret, /^whsec_/);
  assert.equal(created.webhook.name, "Ops Hook");
  assert.equal("secret" in created.webhook, false);
  assert.deepEqual(created.webhook.events, ["webhook.test", "record.created"]);

  const updated = store.updateWebhook(context, created.webhook.id, { active: false });
  assert.equal(updated.active, false);
  assert.throws(() => store.testWebhook(context, created.webhook.id), /inactive/);

  store.updateWebhook(context, created.webhook.id, { active: true });
  const delivery = store.testWebhook(context, created.webhook.id);
  assert.equal(delivery.status, "success");
  assert.equal(delivery.event, "webhook.test");
  assert.equal(store.listWebhookDeliveries(context, created.webhook.id).some((candidate) => candidate.id === delivery.id), true);
  assert.equal(store.listAuditLogs(context, { entityType: "webhook_delivery" }).some((log) => log.entityId === delivery.id), true);
});

await run("webhook management requires admin and validates https event subscriptions", () => {
  const store = new CrmStore();
  const adminContext = store.getContext("user-admin");
  const salesContext = store.getContext("user-sales");

  assert.throws(() => store.listWebhooks(salesContext), /crm\.admin/);
  assert.throws(() => store.createWebhook(salesContext, { name: "Nope", url: "https://example.com/hook", events: ["webhook.test"] }), /crm\.admin/);
  assert.throws(() => store.createWebhook(adminContext, { name: "Bad URL", url: "http://example.com/hook", events: ["webhook.test"] }), /HTTPS/);
  assert.throws(() => store.createWebhook(adminContext, { name: "Bad Event", url: "https://example.com/hook", events: ["bad.event"] }), /unsupported events/);
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    assert.throws(() => store.createWebhook(adminContext, { name: "Private URL", url: "https://127.0.0.1/hook", events: ["webhook.test"] }), /private network/);
  } finally {
    restoreEnv("NODE_ENV", previousNodeEnv);
  }
});

await run("webhook subscriptions receive record activity and import events", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const created = store.createWebhook(context, {
    name: "Event Hook",
    url: "https://example.com/webhooks/events",
    events: ["record.created", "record.updated", "record.deleted", "activity.created", "import.completed", "import.failed"]
  });

  const record = store.createRecord(context, "contacts", { title: "Event Contact", data: { email: "event-contact@example.com" } });
  store.updateRecord(context, "contacts", record.id, { data: { phone: "13800000009" } });
  store.createActivity(context, { recordId: record.id, type: "note", title: "Event Note" });
  store.deleteRecord(context, "contacts", record.id);

  const completed = store.createCsvImportJob(context, {
    objectKey: "deals",
    csv: "title,amount\nEvent Deal,1200",
    strategy: "skip-invalid"
  });
  const queued = store.createQueuedCsvImportJob(context, {
    objectKey: "contacts",
    csv: "title,email\nBad Import,bad-import@example.com",
    strategy: "skip-invalid"
  });
  const failed = store.runCsvImportJob(context, queued.id, {
    objectKey: "missing-objects",
    csv: "title,email\nBad Import,bad-import@example.com",
    strategy: "skip-invalid"
  });

  const deliveries = store.listWebhookDeliveries(context, created.webhook.id);
  assert.equal(deliveries.some((delivery) => delivery.event === "record.created" && delivery.requestBody.data?.recordId === record.id), true);
  assert.equal(deliveries.some((delivery) => delivery.event === "record.updated" && delivery.requestBody.data?.recordId === record.id), true);
  assert.equal(deliveries.some((delivery) => delivery.event === "activity.created" && delivery.requestBody.data?.title === "Event Note"), true);
  assert.equal(deliveries.some((delivery) => delivery.event === "record.deleted" && delivery.requestBody.data?.recordId === record.id), true);
  assert.equal(deliveries.some((delivery) => delivery.event === "import.completed" && delivery.requestBody.data?.jobId === completed.id), true);
  assert.equal(deliveries.some((delivery) => delivery.event === "import.failed" && delivery.requestBody.data?.jobId === failed.id), true);

  store.updateWebhook(context, created.webhook.id, { active: false });
  const beforeInactive = store.listWebhookDeliveries(context, created.webhook.id).length;
  store.createRecord(context, "contacts", { title: "Inactive Hook Contact", data: { email: "inactive-hook@example.com" } });
  assert.equal(store.listWebhookDeliveries(context, created.webhook.id).length, beforeInactive);
});

await run("webhook delivery filters and retries preserve payload attempts", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const created = store.createWebhook(context, {
    name: "Retry Hook",
    url: "https://example.com/webhooks/retry",
    events: ["webhook.test"]
  });
  const delivery = store.testWebhook(context, created.webhook.id);

  const filtered = store.listWebhookDeliveries(context, created.webhook.id, {
    status: "success",
    event: "webhook.test",
    limit: 1
  });
  assert.deepEqual(filtered.map((candidate) => candidate.id), [delivery.id]);

  const retry = store.retryWebhookDelivery(context, created.webhook.id, delivery.id);
  assert.equal(retry.event, "webhook.test");
  assert.equal(retry.attempts, 2);
  assert.equal(retry.requestBody.data?.test, true);

  store.updateWebhook(context, created.webhook.id, { active: false });
  assert.throws(() => store.retryWebhookDelivery(context, created.webhook.id, delivery.id), /inactive/);
});

await run("admins can manage relations, pipelines, and saved views", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");

  const relation = store.createRelationDefinition(context, {
    fromObjectKey: "companies",
    toObjectKey: "partners",
    key: "company_partners",
    label: "Company Partners",
    cardinality: "many-to-many"
  });
  const updatedRelation = store.updateRelationDefinition(context, relation.id, { label: "Partner Accounts" });

  const pipeline = store.createPipeline(context, {
    objectKey: "partners",
    name: "Partner Pipeline",
    isDefault: true,
    stages: [{ key: "new", label: "New", probability: 0.1, position: 1, color: "#2563eb" }]
  });
  const updatedPipeline = store.updatePipeline(context, pipeline.id, {
    stages: [{ key: "active", label: "Active", probability: 0.6, position: 1, color: "#0f766e" }]
  });

  const view = store.createSavedView(context, {
    objectKey: "partners",
    name: "Partner Overview",
    columns: ["title", "tier"],
    sort: { field: "title", direction: "asc" },
    isDefault: true
  });
  const updatedView = store.updateSavedView(context, view.id, { name: "Partner List" });

  assert.equal(updatedRelation.label, "Partner Accounts");
  assert.equal(updatedPipeline.stages[0]?.key, "active");
  assert.equal(updatedView.name, "Partner List");

  store.deleteRelationDefinition(context, relation.id);
  store.deletePipeline(context, pipeline.id);
  store.deleteSavedView(context, view.id);

  assert.equal(store.listRelationDefinitions(context).some((item) => item.id === relation.id), false);
  assert.equal(store.listPipelines(context).some((item) => item.id === pipeline.id), false);
  assert.equal(store.listSavedViews(context, "partners").some((item) => item.id === view.id), false);
});

await run("saved views reject unknown columns filters and sorts", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");

  assert.throws(
    () =>
      store.createSavedView(context, {
        objectKey: "contacts",
        name: "Bad Column View",
        columns: ["title", "missingField"],
        isDefault: false
      }),
    /unknown column missingField/
  );

  assert.throws(
    () =>
      store.createSavedView(context, {
        objectKey: "contacts",
        name: "Bad Filter View",
        columns: ["title"],
        filters: [{ field: "missingFilter", operator: "equals", value: "x" }],
        isDefault: false
      }),
    /unknown filter field missingFilter/
  );

  const view = store.createSavedView(context, {
    objectKey: "contacts",
    name: "Valid Owner View",
    columns: ["title", "ownerId"],
    filters: [{ field: "ownerId", operator: "equals", value: "user-sales" }],
    sort: { field: "updatedAt", direction: "desc" },
    isDefault: false
  });

  assert.equal(view.columns.includes("ownerId"), true);
  assert.throws(() => store.updateSavedView(context, view.id, { sort: { field: "missingSort", direction: "asc" } }), /unknown sort field missingSort/);
});

await run("object deletion is blocked by records and inbound references", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const region = store.createObjectDefinition(context, {
    key: "regions",
    label: "Region",
    pluralLabel: "Regions"
  });
  store.createRecord(context, "regions", { title: "North", data: {} });

  assert.throws(() => store.deleteObjectDefinition(context, region.id), /still has 1 records/);

  const vendor = store.createObjectDefinition(context, {
    key: "vendors",
    label: "Vendor",
    pluralLabel: "Vendors"
  });
  store.createFieldDefinition(context, {
    objectKey: "contacts",
    key: "vendorId",
    label: "Vendor",
    type: "reference",
    options: [{ label: "Vendor", value: "vendors" }]
  });

  assert.throws(() => store.deleteObjectDefinition(context, vendor.id), /still references it/);
});

await run("relation deletion is blocked while reference data still uses it", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const relation = store.listRelationDefinitions(context).find((item) => item.key === "company_contacts");

  assert.ok(relation);
  assert.throws(() => store.deleteRelationDefinition(context, relation.id), /still uses field/);
});

await run("pipeline stage changes are blocked while records use removed stages", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const pipeline = store.listPipelines(context).find((item) => item.objectKey === "deals" && item.isDefault);

  assert.ok(pipeline);
  assert.throws(
    () =>
      store.updatePipeline(context, pipeline.id, {
        stages: pipeline.stages.filter((stage) => stage.key !== "proposal")
      }),
    /cannot remove stage proposal/
  );
});

await run("pipeline deletion is blocked while records still use pipeline stages", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const pipeline = store.listPipelines(context).find((item) => item.objectKey === "deals" && item.isDefault);

  assert.ok(pipeline);
  assert.throws(() => store.deletePipeline(context, pipeline.id), /still uses a pipeline stage/);
});

await run("field deletion is blocked while records or views still use the field", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const field = store.createFieldDefinition(context, {
    objectKey: "contacts",
    key: "externalCode",
    label: "External Code",
    type: "text"
  });
  const record = store.createRecord(context, "contacts", {
    title: "Delete Guard",
    data: { email: "delete-guard@example.com", externalCode: "EXT-1" }
  });

  assert.throws(() => store.deleteFieldDefinition(context, field.id), /still has data/);
  store.updateRecord(context, "contacts", record.id, { data: { externalCode: "" } });

  const view = store.createSavedView(context, {
    objectKey: "contacts",
    name: "External Codes",
    columns: ["title", "externalCode"],
    isDefault: false
  });
  assert.throws(() => store.deleteFieldDefinition(context, field.id), /saved view/);

  store.deleteSavedView(context, view.id);
  assert.doesNotThrow(() => store.deleteFieldDefinition(context, field.id));
});

await run("unique field changes are rejected when existing records already duplicate values", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const field = store.createFieldDefinition(context, {
    objectKey: "contacts",
    key: "legacyCode",
    label: "Legacy Code",
    type: "text"
  });

  store.createRecord(context, "contacts", { title: "Legacy A", data: { email: "legacy-a@example.com", legacyCode: "DUP" } });
  store.createRecord(context, "contacts", { title: "Legacy B", data: { email: "legacy-b@example.com", legacyCode: "dup" } });

  assert.throws(() => store.updateFieldDefinition(context, field.id, { unique: true }), /cannot be unique/);
});

await run("reference fields require existing target objects and records", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");

  assert.throws(
    () =>
      store.createFieldDefinition(context, {
        objectKey: "contacts",
        key: "missingAccountId",
        label: "Missing Account",
        type: "reference",
        options: [{ label: "Missing", value: "missing_accounts" }]
      }),
    /Object|对象|不存在|not found/i
  );

  const field = store.createFieldDefinition(context, {
    objectKey: "contacts",
    key: "primaryDealId",
    label: "Primary Deal",
    type: "reference",
    options: [{ label: "Deal", value: "deals" }]
  });

  assert.equal(field.type, "reference");
  assert.throws(
    () =>
      store.createRecord(context, "contacts", {
        title: "Broken Reference",
        data: { email: "broken-reference@example.com", primaryDealId: "deal-missing" }
      }),
    /missing record/
  );
});

await run("sales users cannot manage metadata", () => {
  const store = new CrmStore();
  const context = store.getContext("user-sales");

  assert.throws(
    () =>
      store.createObjectDefinition(context, {
        key: "regions",
        label: "Region",
        pluralLabel: "Regions"
      }),
    /crm\.admin/
  );

  assert.throws(
    () =>
      store.createRelationDefinition(context, {
        fromObjectKey: "companies",
        toObjectKey: "contacts",
        key: "blocked_relation",
        label: "Blocked Relation",
        cardinality: "one-to-many"
      }),
    /crm\.admin/
  );
});

await run("sales users only see owned or team-owned records", () => {
  const snapshot = structuredClone(seedData);
  snapshot.teams.push({ id: "team-enterprise", workspaceId: defaultWorkspaceId, name: "Enterprise" });
  snapshot.users.push({
    id: "user-other",
    workspaceId: defaultWorkspaceId,
    email: "other@example.com",
    name: "Other Sales",
    roleId: "role-sales",
    teamId: "team-enterprise"
  });
  snapshot.records.push({
    id: "contact-other",
    workspaceId: defaultWorkspaceId,
    objectKey: "contacts",
    title: "Other Team Contact",
    ownerId: "user-other",
    data: { email: "other-team@example.com" },
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z"
  });

  const store = new CrmStore(snapshot);
  const salesContext = store.getContext("user-sales");
  const adminContext = store.getContext("user-admin");

  assert.equal(store.listRecords(salesContext, "contacts").some((record) => record.id === "contact-other"), false);
  assert.throws(() => store.getRecord(salesContext, "contacts", "contact-other"), /not found|不存在/);
  assert.equal(store.listActivities(salesContext, "contact-other").length, 0);
  assert.throws(
    () => store.createActivity(salesContext, { recordId: "contact-other", type: "note", title: "Blocked" }),
    /not found|不存在/
  );
  assert.equal(store.getRecord(adminContext, "contacts", "contact-other").id, "contact-other");
});

await run("non-admin record writes keep owner scoped to the current user", () => {
  const store = new CrmStore();
  const salesContext = store.getContext("user-sales");
  const record = store.createRecord(salesContext, "contacts", {
    title: "Owner Scope",
    ownerId: "user-admin",
    data: { email: "owner-scope@example.com" }
  });

  assert.equal(record.ownerId, "user-sales");

  const updated = store.updateRecord(salesContext, "contacts", record.id, {
    ownerId: "user-admin",
    data: { phone: "13900000000" }
  });

  assert.equal(updated.ownerId, "user-sales");
});

await run("unique validation includes records hidden by RBAC", () => {
  const snapshot = structuredClone(seedData);
  snapshot.teams.push({ id: "team-enterprise", workspaceId: defaultWorkspaceId, name: "Enterprise" });
  snapshot.users.push({
    id: "user-other-unique",
    workspaceId: defaultWorkspaceId,
    email: "other-unique@example.com",
    name: "Other Unique Sales",
    roleId: "role-sales",
    teamId: "team-enterprise"
  });
  snapshot.records.push({
    id: "contact-hidden-unique",
    workspaceId: defaultWorkspaceId,
    objectKey: "contacts",
    title: "Hidden Unique Contact",
    ownerId: "user-other-unique",
    data: { email: "hidden-unique@example.com" },
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z"
  });

  const store = new CrmStore(snapshot);
  const salesContext = store.getContext("user-sales");

  assert.throws(
    () => store.createRecord(salesContext, "contacts", { title: "Duplicate Hidden", data: { email: "hidden-unique@example.com" } }),
    /unique|唯一/i
  );
});

await run("critical writes create admin-visible audit logs", () => {
  const store = new CrmStore();
  const adminContext = store.getContext("user-admin");
  const salesContext = store.getContext("user-sales");
  const before = store.listAuditLogs(adminContext).length;

  const record = store.createRecord(salesContext, "contacts", {
    title: "Audit Contact",
    data: { email: "audit-contact@example.com" }
  });
  store.updateActivity(adminContext, "act-2", { completedAt: "2026-06-18T08:30:00.000Z" });
  store.updateRecord(salesContext, "contacts", record.id, { data: { phone: "13800000001" } });

  const logs = store.listAuditLogs(adminContext);
  assert.equal(logs.length, before + 3);
  assert.equal(logs.some((log) => log.action === "create" && log.entityType === "record" && log.entityId === record.id), true);
  assert.equal(logs.some((log) => log.action === "update" && log.entityType === "activity" && log.entityId === "act-2"), true);
  assert.equal(logs.some((log) => log.action === "update" && log.entityType === "record" && log.objectKey === "contacts"), true);
});

await run("audit logs can be filtered by action entity object actor and query", () => {
  const store = new CrmStore();
  const adminContext = store.getContext("user-admin");
  const record = store.createRecord(adminContext, "contacts", {
    title: "Filtered Audit Contact",
    data: { email: "filtered-audit@example.com" }
  });

  assert.equal(store.listAuditLogs(adminContext, { action: "create" }).some((log) => log.entityId === record.id), true);
  assert.equal(store.listAuditLogs(adminContext, { entityType: "record" }).some((log) => log.entityId === record.id), true);
  assert.equal(store.listAuditLogs(adminContext, { objectKey: "contacts" }).some((log) => log.entityId === record.id), true);
  assert.equal(store.listAuditLogs(adminContext, { actorId: adminContext.user.id }).some((log) => log.entityId === record.id), true);
  assert.equal(store.listAuditLogs(adminContext, { q: "Filtered Audit" }).some((log) => log.entityId === record.id), true);
});

await run("audit logs can be exported as filtered csv", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const record = store.createRecord(context, "contacts", {
    title: "Exported Audit Contact",
    data: { email: "exported-audit@example.com" }
  });

  const csv = store.exportAuditLogsCsv(context, { action: "create", entityType: "record", objectKey: "contacts", q: "Exported Audit" });

  assert.match(csv, /^id,createdAt,action,entityType,entityId,objectKey,actorId,summary,details/m);
  assert.match(csv, new RegExp(record.id));
  assert.match(csv, /create,record/);
  assert.match(csv, /contacts/);
  assert.match(csv, /Exported Audit Contact/);
});

await run("audit logs require admin permission", () => {
  const store = new CrmStore();
  const salesContext = store.getContext("user-sales");

  assert.throws(() => store.listAuditLogs(salesContext), /crm\.admin/);
  assert.throws(() => store.exportAuditLogsCsv(salesContext), /crm\.admin/);
});

await run("csv import reports row-level errors", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const result = store.importCsv(context, "contacts", "title,email,phone\nWang Min,wang@example.com,139\nNo Email,,138");

  assert.equal(result.created.length, 1);
  assert.match(result.errors[0] ?? "", /Email|邮箱/);
});

await run("csv import writes a summary audit log", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");

  store.importCsv(context, "contacts", "title,email\nAudit Import,audit-import@example.com\nNo Email,");
  const logs = store.listAuditLogs(context);

  const importLog = logs.find((log) => log.action === "import" && log.entityType === "csv_import" && log.objectKey === "contacts");
  assert.ok(importLog);
  assert.match(importLog.summary, /1 created, 0 updated, 1 failed/);
  assert.equal(importLog.details?.totalRows, 2);
  assert.equal(importLog.details?.updated, 0);
});

await run("csv import jobs track status counts and audit logs", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const job = store.createCsvImportJob(context, {
    objectKey: "contacts",
    csv: "title,email\nJob Import,job-import@example.com\nMissing Email,",
    strategy: "skip-invalid"
  });

  assert.equal(job.status, "completed");
  assert.equal(job.totalRows, 2);
  assert.equal(job.createdCount, 1);
  assert.equal(job.errorCount, 1);
  assert.equal(job.preview?.errorRows, 1);
  assert.equal(store.listImportJobs(context, "contacts").some((candidate) => candidate.id === job.id), true);
  assert.equal(store.listAuditLogs(context, { entityType: "import_job" }).some((log) => log.entityId === job.id), true);
});

await run("csv import jobs can be queued before execution", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const queued = store.createQueuedCsvImportJob(context, {
    objectKey: "contacts",
    csv: "title,email\nQueued Import,queued-import@example.com",
    strategy: "skip-invalid"
  });

  assert.equal(queued.status, "queued");
  assert.equal(queued.createdCount, 0);
  const completed = store.runCsvImportJob(context, queued.id, {
    objectKey: "contacts",
    csv: "title,email\nQueued Import,queued-import@example.com",
    strategy: "skip-invalid"
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.createdCount, 1);
});

await run("csv import jobs can be cancelled while queued", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const queued = store.createQueuedCsvImportJob(context, {
    objectKey: "contacts",
    csv: "title,email\nCancel Import,cancel-import@example.com",
    strategy: "skip-invalid"
  });

  const cancelled = store.cancelCsvImportJob(context, queued.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.completedAt.length > 0, true);
  assert.equal(store.runCsvImportJob(context, queued.id, { objectKey: "contacts", csv: "title,email\nCancel Import,cancel-import@example.com" }).status, "cancelled");
  assert.equal(store.listAuditLogs(context, { entityType: "import_job" }).some((log) => log.entityId === queued.id && /Cancelled/.test(log.summary)), true);
});

await run("csv import jobs retry from the stored source payload", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const queued = store.createQueuedCsvImportJob(context, {
    objectKey: "contacts",
    csv: "title,email\nRetry Import,retry-import@example.com",
    strategy: "skip-invalid"
  });
  const failed = store.runCsvImportJob(context, queued.id, {
    objectKey: "missing-objects",
    csv: "title,email\nRetry Import,retry-import@example.com",
    strategy: "skip-invalid"
  });
  assert.equal(failed.status, "failed");

  const retry = store.createRetryCsvImportJob(context, failed.id);
  const completed = store.runCsvImportJob(context, retry.job.id, retry.payload);
  assert.equal(completed.status, "completed");
  assert.equal(completed.createdCount, 1);
  assert.equal(retry.payload.objectKey, "contacts");
});

await run("csv import jobs preserve update-existing strategy in copied payloads", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const completed = store.createCsvImportJob(context, {
    objectKey: "contacts",
    csv: "title,email,phone\nCopied Strategy Lin,lin@example.com,13912345678",
    strategy: "update-existing"
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.result?.updated.length, 1);

  const rerun = store.createRerunCsvImportJob(context, completed.id);
  assert.equal(rerun.payload.strategy, "update-existing");
});

await run("csv import jobs preserve explicit header mappings", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const completed = store.createCsvImportJob(context, {
    objectKey: "contacts",
    csv: "姓名,邮箱\n任务映射客户,job-mapped@example.com",
    strategy: "skip-invalid",
    mapping: { 姓名: "title", 邮箱: "email" }
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.createdCount, 1);
  assert.equal(completed.result?.created[0]?.data.email, "job-mapped@example.com");
  assert.deepEqual(completed.sourcePayload?.mapping, { 姓名: "title", 邮箱: "email" });
  assert.deepEqual(store.listImportJobs(context, "contacts").find((job) => job.id === completed.id)?.sourcePayload?.mapping, { 姓名: "title", 邮箱: "email" });

  const rerun = store.createRerunCsvImportJob(context, completed.id);
  assert.deepEqual(rerun.payload.mapping, { 姓名: "title", 邮箱: "email" });
});

await run("csv import jobs preserve preset context and observability summary", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const job = store.createCsvImportJob(context, {
    objectKey: "contacts",
    csv: "Name,Email,Extra\nPreset Import,preset-observe@example.com,ignored\nDuplicate Lin,lin@example.com,ignored",
    strategy: "skip-invalid",
    mapping: { Name: "title", Email: "email" },
    presetId: "preset-contacts-standard",
    presetName: "Contacts standard"
  });

  const details = buildImportJobObservability(job);
  assert.equal(job.sourcePayload?.presetName, "Contacts standard");
  assert.equal(details.presetName, "Contacts standard");
  assert.deepEqual(details.headers, ["Name", "Email", "Extra"]);
  assert.deepEqual(details.mappingEntries, [
    { header: "Name", target: "title" },
    { header: "Email", target: "email" }
  ]);
  assert.deepEqual(details.unmappedHeaders, ["Extra"]);
  assert.deepEqual(details.issueBuckets, [{ label: "conflict", count: 1 }]);
  assert.equal(details.createdSamples.length, 1);
  assert.equal(details.conflictSamples.length, 1);

  const rerun = store.createRerunCsvImportJob(context, job.id);
  assert.equal(rerun.payload.presetName, "Contacts standard");
});

await run("csv import jobs export issue rows as csv", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const job = store.createCsvImportJob(context, {
    objectKey: "contacts",
    csv: "title,email,phone\nMissing Email,,13900000001\nDuplicate Lin,lin@example.com,13900000002\nFresh,fresh-issues@example.com,13900000003",
    strategy: "skip-invalid"
  });

  const csv = store.exportImportJobIssuesCsv(context, job.id);
  assert.match(csv, /^rowNumber,status,issues,title,email,phone/m);
  assert.match(csv, /Missing Email/);
  assert.match(csv, /Duplicate Lin/);
  assert.match(csv, /conflicts with/);
  assert.doesNotMatch(csv, /fresh-issues@example\.com/);

  const preview = store.previewCsvImport(context, "contacts", csv);
  assert.equal(preview.unmappedHeaders.length, 0);
  assert.equal(preview.mappedFields.some((field) => field.key === "email"), true);
});

await run("csv import issue export reuses explicit mappings as field headers", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const job = store.createCsvImportJob(context, {
    objectKey: "contacts",
    csv: "姓名,邮箱,电话\n重复林,lin@example.com,13900000004",
    strategy: "skip-invalid",
    mapping: { 姓名: "title", 邮箱: "email", 电话: "phone" }
  });

  const csv = store.exportImportJobIssuesCsv(context, job.id);
  assert.match(csv, /^rowNumber,status,issues,title,email,phone/m);
  assert.doesNotMatch(csv, /姓名,邮箱,电话/);
  assert.match(csv, /lin@example\.com/);

  const preview = store.previewCsvImport(context, "contacts", csv);
  assert.equal(preview.unmappedHeaders.length, 0);
  assert.equal(preview.rows[0]?.values.email, "lin@example.com");
});

await run("csv import jobs can rerun a completed source payload", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const completed = store.createCsvImportJob(context, {
    objectKey: "deals",
    csv: "title,amount\nRerun Deal,9000",
    strategy: "skip-invalid"
  });
  assert.equal(completed.status, "completed");

  const rerun = store.createRerunCsvImportJob(context, completed.id);
  const rerunCompleted = store.runCsvImportJob(context, rerun.job.id, rerun.payload);
  assert.equal(rerunCompleted.status, "completed");
  assert.equal(rerunCompleted.createdCount, 1);
});

await run("import job queue summary reports status counts and worker failures", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const completed = store.createCsvImportJob(context, {
    objectKey: "contacts",
    csv: "title,email\nSummary Completed,summary-completed@example.com",
    strategy: "skip-invalid"
  });
  const queued = store.createQueuedCsvImportJob(context, {
    objectKey: "contacts",
    csv: "title,email\nSummary Queued,summary-queued@example.com",
    strategy: "skip-invalid"
  });
  const cancelled = store.createQueuedCsvImportJob(context, {
    objectKey: "contacts",
    csv: "title,email\nSummary Cancelled,summary-cancelled@example.com",
    strategy: "skip-invalid"
  });
  store.cancelCsvImportJob(context, cancelled.id);
  store.markCsvImportJobFailedFromWorker(context.workspaceId, queued.id, "contacts", "worker crashed");

  const summary = store.getImportJobQueueSummary(context);
  assert.equal(summary.total, 3);
  assert.equal(summary.completed, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.cancelled, 1);
  assert.equal(summary.deadLettered, 1);
  assert.equal(summary.recentJobs.length, 3);
  assert.equal(summary.recentFailures[0].id, queued.id);
  assert.equal(summary.recentJobs.some((job) => job.id === completed.id), true);
});

await run("import job queue summary requires admin permission", () => {
  const store = new CrmStore();
  const salesContext = store.getContext("user-sales");
  assert.throws(() => store.getImportJobQueueSummary(salesContext), /crm\.admin/);
});

await run("inline background executor runs csv import jobs immediately", async () => {
  const calls = [];
  const repository = {
    async runCsvImportJob(context, jobId, payload) {
      calls.push({ context, jobId, payload });
      return { id: jobId, status: "completed" };
    }
  };
  const executor = new InlineBackgroundJobExecutor(repository);
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const result = await executor.runCsvImportJob(context, "job-inline", { objectKey: "contacts", csv: "title,email\nInline,inline@example.com" });

  assert.equal(result.id, "job-inline");
  assert.equal(result.status, "completed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.objectKey, "contacts");
});

await run("inline background executor dispatches webhook events through the repository", async () => {
  const calls = [];
  const repository = {
    async deliverWebhookEvent(context, event, data) {
      calls.push({ context, event, data });
      return [
        {
          id: "delivery-inline",
          workspaceId: context.workspaceId,
          webhookId: "webhook-inline",
          event,
          status: "success",
          attempts: 1,
          requestBody: { data },
          createdAt: new Date().toISOString()
        }
      ];
    }
  };
  const executor = new InlineBackgroundJobExecutor(repository);
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const result = await executor.runWebhookEvent(context, { event: "record.created", data: { recordId: "record-inline" } });

  assert.equal(result.queued, false);
  assert.equal(result.deliveries.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].event, "record.created");
  assert.equal(calls[0].data.recordId, "record-inline");
});

await run("redis job envelopes preserve workspace user and payload", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const envelope = buildCsvImportJobEnvelope(context, "job-queued", {
    objectKey: "contacts",
    csv: "title,email\nQueued,queued@example.com",
    strategy: "skip-invalid"
  });

  assert.equal(envelope.type, "csv_import");
  assert.equal(envelope.workspaceId, context.workspaceId);
  assert.equal(envelope.userId, context.user.id);
  assert.equal(envelope.jobId, "job-queued");
  assert.equal(envelope.payload.strategy, "skip-invalid");
  assert.match(envelope.enqueuedAt, /^\d{4}-\d{2}-\d{2}T/);
});

await run("webhook job envelopes preserve event payload and retry metadata", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const envelope = buildWebhookEventEnvelope(context, {
    event: "record.updated",
    data: { recordId: "record-queued", objectKey: "contacts" }
  });

  assert.equal(envelope.type, "webhook_event");
  assert.equal(envelope.workspaceId, context.workspaceId);
  assert.equal(envelope.userId, context.user.id);
  assert.equal(envelope.payload.event, "record.updated");
  assert.equal(envelope.payload.data.recordId, "record-queued");
  assert.equal(envelope.attempts, 0);
  assert.match(envelope.enqueuedAt, /^\d{4}-\d{2}-\d{2}T/);
});

await run("redis queue commands are encoded with RESP bulk strings", () => {
  assert.equal(encodeRedisCommand(["LPUSH", "crm:jobs", "{}"]).toString("utf8"), "*3\r\n$5\r\nLPUSH\r\n$8\r\ncrm:jobs\r\n$2\r\n{}\r\n");
});

await run("job health treats inline executor as healthy without redis", async () => {
  const health = await checkJobHealth({
    executor: "inline",
    redisUrl: "",
    ping: async () => {
      throw new Error("Redis should not be checked");
    }
  });

  assert.equal(health.ok, true);
  assert.equal(health.executor, "inline");
  assert.equal(health.queue, "inline");
  assert.equal(health.redis, undefined);
});

await run("job health requires redis url when redis executor is enabled", async () => {
  const health = await checkJobHealth({ executor: "redis", redisUrl: "" });

  assert.equal(health.ok, false);
  assert.equal(health.executor, "redis");
  assert.equal(health.queue, "error");
  assert.equal(health.redis, "missing_config");
  assert.match(health.error ?? "", /REDIS_URL/);
});

await run("job health pings redis when redis executor is enabled", async () => {
  const health = await checkJobHealth({
    executor: "redis",
    redisUrl: "redis://redis:6379",
    ping: async (redisUrl) => {
      assert.equal(redisUrl, "redis://redis:6379");
      return "PONG";
    }
  });

  assert.equal(health.ok, true);
  assert.equal(health.queue, "ok");
  assert.equal(health.redis, "ok");
});

await run("job health reports redis ping failure without leaking connection urls", async () => {
  const health = await checkJobHealth({
    executor: "redis",
    redisUrl: "redis://:secret@redis:6379",
    ping: async () => {
      throw new Error("connect failed for redis://:secret@redis:6379");
    }
  });

  assert.equal(health.ok, false);
  assert.equal(health.redis, "error");
  assert.doesNotMatch(health.error ?? "", /secret/);
  assert.match(health.error ?? "", /redis:\/\/\[redacted\]/);
  assert.equal(toSafeHealthError(new Error("failed postgresql://user:pass@db/app")), "failed postgres://[redacted]");
});

await run("worker retry envelopes increment attempts and preserve the last error", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const envelope = buildCsvImportJobEnvelope(context, "job-worker-retry", {
    objectKey: "contacts",
    csv: "title,email\nRetry,retry@example.com"
  });
  const failedOnce = buildFailedJobEnvelope(envelope, "database unavailable");

  assert.equal(failedOnce.attempts, 1);
  assert.equal(failedOnce.lastError, "database unavailable");
  assert.equal(failedOnce.jobId, envelope.jobId);
});

await run("worker queue settings expose max attempts and dead letter queue names", () => {
  const previousMaxAttempts = process.env.JOB_MAX_ATTEMPTS;
  const previousDeadLetterQueue = process.env.JOB_DEAD_LETTER_QUEUE_NAME;
  try {
    delete process.env.JOB_MAX_ATTEMPTS;
    delete process.env.JOB_DEAD_LETTER_QUEUE_NAME;
    assert.equal(getMaxJobAttempts(), 3);
    assert.equal(getDeadLetterQueueName("crm:jobs"), "crm:jobs:dead");

    process.env.JOB_MAX_ATTEMPTS = "5";
    process.env.JOB_DEAD_LETTER_QUEUE_NAME = "crm:jobs:failed";
    assert.equal(getMaxJobAttempts(), 5);
    assert.equal(getDeadLetterQueueName("crm:jobs"), "crm:jobs:failed");
  } finally {
    if (previousMaxAttempts === undefined) {
      delete process.env.JOB_MAX_ATTEMPTS;
    } else {
      process.env.JOB_MAX_ATTEMPTS = previousMaxAttempts;
    }
    if (previousDeadLetterQueue === undefined) {
      delete process.env.JOB_DEAD_LETTER_QUEUE_NAME;
    } else {
      process.env.JOB_DEAD_LETTER_QUEUE_NAME = previousDeadLetterQueue;
    }
  }
});

await run("csv import all-or-nothing aborts when any row is invalid", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const before = store.listRecords(context, "contacts").length;
  const result = store.importCsv(
    context,
    "contacts",
    "title,email\nAtomic Good,atomic-good@example.com\nAtomic Bad,",
    "all-or-nothing"
  );

  assert.equal(result.aborted, true);
  assert.equal(result.created.length, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(store.listRecords(context, "contacts").length, before);
  const importLog = store.listAuditLogs(context).find((log) => log.action === "import" && log.entityType === "csv_import");
  assert.equal(importLog?.details?.strategy, "all-or-nothing");
  assert.equal(importLog?.details?.aborted, true);
});

await run("csv import all-or-nothing creates rows when preview is clean", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const result = store.importCsv(
    context,
    "contacts",
    "title,email\nAtomic One,atomic-one@example.com\nAtomic Two,atomic-two@example.com",
    "all-or-nothing"
  );

  assert.equal(result.aborted, false);
  assert.equal(result.created.length, 2);
  assert.equal(result.errors.length, 0);
});

await run("csv import preview reports mappings and row-level errors without creating records", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const result = store.previewCsvImport(
    context,
    "contacts",
    "title,email,unknown\nValid Contact,valid-preview@example.com,x\nNo Email,,y\nDuplicate,lin@example.com,z"
  );

  assert.equal(result.totalRows, 3);
  assert.equal(result.creatableRows, 1);
  assert.equal(result.errorRows, 1);
  assert.equal(result.conflictRows, 1);
  assert.equal(result.mappedFields.some((field) => field.key === "email"), true);
  assert.deepEqual(result.unmappedHeaders, ["unknown"]);
  assert.equal(result.errors.length, 2);
  assert.deepEqual(
    result.rows.map((row) => row.status),
    ["ready", "error", "conflict"]
  );
  assert.equal(result.rows[2]?.conflicts[0]?.existingRecordId, "contact-lin");
  assert.equal(store.listRecords(context, "contacts").some((record) => record.title === "Valid Contact"), false);
});

await run("csv import supports explicit header mapping for preview and import", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const mapping = { 姓名: "title", 邮箱: "email", 电话: "phone" };
  const preview = store.previewCsvImport(
    context,
    "contacts",
    "姓名,邮箱,电话\n映射客户,mapped-contact@example.com,13988880000",
    mapping
  );

  assert.equal(preview.creatableRows, 1);
  assert.equal(preview.errorRows, 0);
  assert.equal(preview.unmappedHeaders.length, 0);
  assert.equal(preview.mappedFields.some((field) => field.key === "email"), true);
  assert.equal(preview.rows[0]?.values.email, "mapped-contact@example.com");

  const result = store.importCsv(
    context,
    "contacts",
    "姓名,邮箱,电话\n映射客户,mapped-contact@example.com,13988880000",
    "skip-invalid",
    mapping
  );
  assert.equal(result.created.length, 1);
  assert.equal(result.created[0]?.title, "映射客户");
  assert.equal(result.created[0]?.data.email, "mapped-contact@example.com");
});

await run("csv import rejects mappings that target unknown or duplicate fields", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");

  assert.throws(
    () => store.previewCsvImport(context, "contacts", "姓名\n映射客户", { 姓名: "missingField" }),
    /unknown field missingField/
  );
  assert.throws(
    () => store.previewCsvImport(context, "contacts", "邮箱一,邮箱二\none@example.com,two@example.com", { 邮箱一: "email", 邮箱二: "email" }),
    /targets email more than once/
  );
});

await run("csv import skips existing-record conflicts and reports conflict metadata", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const before = store.listRecords(context, "contacts").length;
  const result = store.importCsv(
    context,
    "contacts",
    "title,email\nFresh Import,fresh-import@example.com\nExisting Lin,lin@example.com"
  );

  assert.equal(result.aborted, false);
  assert.equal(result.created.length, 1);
  assert.equal(result.updated.length, 0);
  assert.equal(result.preview.conflictRows, 1);
  assert.equal(result.preview.rows[1]?.status, "conflict");
  assert.equal(result.preview.rows[1]?.conflicts[0]?.existingRecordId, "contact-lin");
  assert.match(result.errors[0], /conflicts with existing record/i);
  assert.equal(store.listRecords(context, "contacts").length, before + 1);
});

await run("csv import update-existing updates conflict rows instead of creating duplicates", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const before = store.listRecords(context, "contacts").length;
  const result = store.importCsv(
    context,
    "contacts",
    "title,email,phone\nLin Updated,lin@example.com,13999990000\nFresh Update Import,fresh-update-import@example.com,13999990001",
    "update-existing"
  );

  const updatedLin = store.getRecord(context, "contacts", "contact-lin");
  assert.equal(result.aborted, false);
  assert.equal(result.created.length, 1);
  assert.equal(result.updated.length, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(result.preview.conflictRows, 1);
  assert.equal(updatedLin.title, "Lin Updated");
  assert.equal(updatedLin.data.phone, "13999990000");
  assert.equal(store.listRecords(context, "contacts").length, before + 1);
  assert.equal(store.listAuditLogs(context, { action: "import", entityType: "csv_import" })[0]?.details?.updated, 1);
});

await run("csv import all-or-nothing aborts on existing-record conflicts", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const before = store.listRecords(context, "contacts").length;
  const result = store.importCsv(
    context,
    "contacts",
    "title,email\nAtomic Fresh,atomic-fresh-conflict@example.com\nAtomic Existing,lin@example.com",
    "all-or-nothing"
  );

  assert.equal(result.aborted, true);
  assert.equal(result.created.length, 0);
  assert.equal(result.preview.errorRows, 0);
  assert.equal(result.preview.conflictRows, 1);
  assert.equal(store.listRecords(context, "contacts").length, before);
});

await run("csv import preview rejects duplicate values inside the same file", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const result = store.previewCsvImport(
    context,
    "contacts",
    "title,email\nFirst,dupe-preview@example.com\nSecond,dupe-preview@example.com"
  );

  assert.equal(result.creatableRows, 1);
  assert.equal(result.errorRows, 1);
  assert.equal(result.rows[1]?.status, "error");
  assert.match(result.rows[1]?.errors[0] ?? "", /unique|唯一|重复|already/i);
});

await run("saved views apply filters and sorting", () => {
  const records = [
    {
      id: "deal-1",
      workspaceId: "workspace-private",
      objectKey: "deals",
      title: "Big Deal",
      data: { amount: 200, status: "open" },
      createdAt: "2026-06-17T12:00:00.000Z",
      updatedAt: "2026-06-17T12:00:00.000Z"
    },
    {
      id: "deal-2",
      workspaceId: "workspace-private",
      objectKey: "deals",
      title: "Small Deal",
      data: { amount: 100, status: "open" },
      createdAt: "2026-06-17T12:00:00.000Z",
      updatedAt: "2026-06-17T12:00:00.000Z"
    },
    {
      id: "deal-3",
      workspaceId: "workspace-private",
      objectKey: "deals",
      title: "Closed Deal",
      data: { amount: 300, status: "closed" },
      createdAt: "2026-06-17T12:00:00.000Z",
      updatedAt: "2026-06-17T12:00:00.000Z"
    }
  ];
  const view = {
    id: "view-open-deals",
    workspaceId: "workspace-private",
    objectKey: "deals",
    name: "Open Deals",
    columns: ["title", "amount"],
    filters: [{ field: "status", operator: "equals", value: "open" }],
    sort: { field: "amount", direction: "desc" },
    isDefault: false
  };

  const visible = records.filter((record) => matchesSavedView(record, view)).sort((left, right) => compareRecords(left, right, view.sort));

  assert.deepEqual(
    visible.map((record) => record.id),
    ["deal-1", "deal-2"]
  );
});

await run("saved views can keep title as the only visible configured column", () => {
  const view = {
    id: "view-title-only",
    workspaceId: "workspace-private",
    objectKey: "resellers",
    name: "Title Only",
    columns: ["title"],
    isDefault: false
  };

  const configuredColumns = view.columns.filter((column) => column !== "title");

  assert.deepEqual(configuredColumns, []);
});

await run("saved view filters can target standard fields and sort metadata fields", () => {
  const records = [
    {
      id: "contact-a",
      workspaceId: "workspace-private",
      objectKey: "contacts",
      title: "Acme Buyer",
      ownerId: "user-sales",
      data: { email: "buyer@acme.example" },
      createdAt: "2026-06-17T12:00:00.000Z",
      updatedAt: "2026-06-18T12:00:00.000Z"
    },
    {
      id: "contact-b",
      workspaceId: "workspace-private",
      objectKey: "contacts",
      title: "Beta Buyer",
      ownerId: "user-admin",
      data: { email: "buyer@beta.example" },
      createdAt: "2026-06-17T12:00:00.000Z",
      updatedAt: "2026-06-19T12:00:00.000Z"
    }
  ];
  const view = {
    id: "view-acme",
    workspaceId: "workspace-private",
    objectKey: "contacts",
    name: "Acme Contacts",
    columns: ["title", "email"],
    filters: [{ field: "title", operator: "contains", value: "Acme" }],
    sort: { field: "updatedAt", direction: "desc" },
    isDefault: false
  };

  assert.deepEqual(
    records.filter((record) => matchesSavedView(record, view)).sort((left, right) => compareRecords(left, right, view.sort)).map((record) => record.id),
    ["contact-a"]
  );

  const ownerView = {
    ...view,
    id: "view-owner",
    name: "Sales Owned",
    columns: ["title", "ownerId"],
    filters: [{ field: "ownerId", operator: "equals", value: "user-sales" }],
    sort: { field: "ownerId", direction: "asc" }
  };

  assert.deepEqual(
    records.filter((record) => matchesSavedView(record, ownerView)).sort((left, right) => compareRecords(left, right, ownerView.sort)).map((record) => record.id),
    ["contact-a"]
  );
});

await run("record list query filters searches sorts and paginates records", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.createRecord(context, "contacts", { title: "Query Alpha", data: { email: "query-alpha@example.com", phone: "13900000001" } });
  store.createRecord(context, "contacts", { title: "Query Beta", data: { email: "query-beta@example.com", phone: "13900000002" } });
  store.createRecord(context, "contacts", { title: "Query Gamma", data: { email: "gamma@example.com", phone: "13900000003" } });

  const result = store.queryRecords(context, "contacts", {
    page: 1,
    pageSize: 1,
    q: "query",
    filters: [{ field: "email", operator: "contains", value: "query-" }],
    sort: { field: "title", direction: "desc" }
  });

  assert.equal(result.total, 2);
  assert.equal(result.pageCount, 2);
  assert.deepEqual(
    result.records.map((record) => record.title),
    ["Query Beta"]
  );
});

await run("record list query normalizes unsafe pagination values at the store boundary", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const result = store.queryRecords(context, "contacts", {
    page: Number.NaN,
    pageSize: Number.POSITIVE_INFINITY
  });

  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 50);

  const capped = store.queryRecords(context, "contacts", {
    page: 1,
    pageSize: 9999
  });
  assert.equal(capped.pageSize, 200);
});

await run("record list query keeps RBAC ownership limits", () => {
  const snapshot = structuredClone(seedData);
  snapshot.teams.push({ id: "team-enterprise", workspaceId: defaultWorkspaceId, name: "Enterprise" });
  snapshot.users.push({
    id: "user-other",
    workspaceId: defaultWorkspaceId,
    email: "other-query@example.com",
    name: "Other Query Sales",
    roleId: "role-sales",
    teamId: "team-enterprise"
  });
  snapshot.records.push({
    id: "contact-query-other",
    workspaceId: defaultWorkspaceId,
    objectKey: "contacts",
    title: "Hidden Query Contact",
    ownerId: "user-other",
    data: { email: "hidden-query@example.com" },
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z"
  });

  const store = new CrmStore(snapshot);
  const salesContext = store.getContext("user-sales");
  const result = store.queryRecords(salesContext, "contacts", { q: "hidden-query", pageSize: 10 });

  assert.equal(result.total, 0);
  assert.equal(result.records.length, 0);
});

await run("record csv export uses filters and RBAC visibility", () => {
  const snapshot = structuredClone(seedData);
  snapshot.teams.push({ id: "team-export-other", workspaceId: defaultWorkspaceId, name: "Export Other Team" });
  snapshot.users.push({
    id: "user-export-other",
    workspaceId: defaultWorkspaceId,
    email: "export-other@example.com",
    name: "Export Other",
    roleId: "role-sales",
    teamId: "team-export-other",
    active: true
  });
  snapshot.records.push(
    {
      id: "contact-export-owned",
      workspaceId: defaultWorkspaceId,
      objectKey: "contacts",
      title: "Export Owned",
      ownerId: "user-sales",
      data: { email: "export-owned@example.com", phone: "139,quoted" },
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:00.000Z"
    },
    {
      id: "contact-export-hidden",
      workspaceId: defaultWorkspaceId,
      objectKey: "contacts",
      title: "Export Hidden",
      ownerId: "user-export-other",
      data: { email: "export-hidden@example.com", phone: "13800000000" },
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:00.000Z"
    }
  );

  const store = new CrmStore(snapshot);
  const adminContext = store.getContext("user-admin");
  const salesContext = store.getContext("user-sales");
  const filteredCsv = store.exportRecordsCsv(adminContext, "contacts", { q: "Export Owned" });
  const salesCsv = store.exportRecordsCsv(salesContext, "contacts", { q: "Export" });

  assert.match(filteredCsv, /^id,title,stageKey,ownerId,createdAt,updatedAt,email,phone/m);
  assert.match(filteredCsv, /contact-export-owned,Export Owned/);
  assert.match(filteredCsv, /"139,quoted"/);
  assert.doesNotMatch(filteredCsv, /contact-export-hidden/);
  assert.match(salesCsv, /contact-export-owned/);
  assert.doesNotMatch(salesCsv, /contact-export-hidden/);
});

await run("csv import template exports object field headers and examples", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const csv = store.exportImportTemplateCsv(context, "contacts");

  assert.match(csv, /^title,email,phone,companyId/m);
  assert.match(csv, /Example record/);
  assert.throws(() => store.exportImportTemplateCsv(store.getContext("user-sales"), "contacts"), /crm\.import/);
});

await run("csv import field guide exports validation metadata", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const contactsGuide = store.exportImportTemplateFieldGuideCsv(context, "contacts");
  const companiesGuide = store.exportImportTemplateFieldGuideCsv(context, "companies");

  assert.match(contactsGuide, /^column,label,type,required,unique,defaultValue,allowedValues,referenceObject,exampleValue,notes/m);
  assert.match(contactsGuide, /title,名称,text,yes,no,,,/);
  assert.match(contactsGuide, /email,邮箱,text,yes,yes/);
  assert.match(contactsGuide, /companyId,公司,reference,no,no,,,公司 \(companies\),record-id/);
  assert.match(companiesGuide, /industry,行业,select,no,no,,软件=software; 制造=manufacturing; 金融=finance,,software/);
  assert.throws(() => store.exportImportTemplateFieldGuideCsv(store.getContext("user-sales"), "contacts"), /crm\.import/);
});

await run("csv import presets save reusable strategy and mappings", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const preset = store.createImportPreset(context, {
    objectKey: "contacts",
    name: " Contacts standard ",
    strategy: "update-existing",
    mapping: { 姓名: "title", 邮箱: "email", " ": "phone" }
  });

  assert.equal(preset.name, "Contacts standard");
  assert.equal(preset.strategy, "update-existing");
  assert.deepEqual(preset.mapping, { 姓名: "title", 邮箱: "email" });
  assert.equal(store.listImportPresets(context, "contacts")[0].id, preset.id);
  assert.throws(
    () => store.createImportPreset(context, { objectKey: "contacts", name: "Broken", mapping: { 邮箱: "missingField" } }),
    /unknown field/
  );
  assert.throws(() => store.listImportPresets(store.getContext("user-sales"), "contacts"), /crm\.import/);

  store.deleteImportPreset(context, preset.id);
  assert.equal(store.listImportPresets(context, "contacts").length, 0);
});

await run("csv import presets can be updated without changing object scope", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const preset = store.createImportPreset(context, {
    objectKey: "contacts",
    name: "Initial contacts import",
    strategy: "skip-invalid",
    mapping: { Name: "title" }
  });

  const updated = store.updateImportPreset(context, preset.id, {
    name: "Updated contacts import",
    strategy: "all-or-nothing",
    mapping: { Name: "title", Email: "email" }
  });

  assert.equal(updated.id, preset.id);
  assert.equal(updated.objectKey, "contacts");
  assert.equal(updated.name, "Updated contacts import");
  assert.equal(updated.strategy, "all-or-nothing");
  assert.deepEqual(updated.mapping, { Name: "title", Email: "email" });
  assert.throws(() => store.updateImportPreset(context, preset.id, { mapping: { Email: "missingField" } }), /unknown field/);
  assert.throws(() => store.updateImportPreset(store.getContext("user-sales"), preset.id, { strategy: "update-existing" }), /crm\.import/);
});

await run("dashboard summary aggregates visible CRM data without full page records", () => {
  const store = new CrmStore();
  const context = store.getContext("user-sales");
  const summary = store.getDashboardSummary(context);

  assert.equal(summary.recordCounts.contacts, 1);
  assert.equal(summary.recordCounts.companies, 1);
  assert.equal(summary.totalPipeline, 280000);
  assert.equal(summary.openTaskCount, 1);
  assert.equal(summary.deals.every((record) => record.objectKey === "deals"), true);
  assert.equal(summary.openTasks.every((activity) => activity.type === "task" && !activity.completedAt), true);
});

await run("deal stage updates move records through the configured pipeline", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const pipeline = store.listPipelines(context).find((item) => item.objectKey === "deals" && item.isDefault);
  const nextStage = pipeline?.stages.find((stage) => stage.key === "negotiation");
  assert.equal(nextStage?.key, "negotiation");

  const updated = store.updateRecord(context, "deals", "deal-platform", { stageKey: nextStage.key });

  assert.equal(updated.stageKey, "negotiation");
  assert.equal(store.getRecord(context, "deals", "deal-platform").stageKey, "negotiation");
});

await run("deal stage updates write a stage history activity", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const before = store.listActivities(context, "deal-platform").length;

  store.updateRecord(context, "deals", "deal-platform", { stageKey: "negotiation" });
  const activities = store.listActivities(context, "deal-platform");

  assert.equal(activities.length, before + 1);
  assert.equal(activities[0]?.type, "stage_change");
  assert.match(activities[0]?.title ?? "", /proposal -> negotiation/);
});

await run("tasks can be completed and reopened", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const task = store.listActivities(context, "contact-lin").find((activity) => activity.type === "task");
  assert.ok(task);

  const completed = store.updateActivity(context, task.id, { completedAt: "2026-06-18T08:00:00.000Z" });
  assert.equal(completed.completedAt, "2026-06-18T08:00:00.000Z");
  assert.equal(store.listActivities(context).some((activity) => activity.id === task.id && activity.type === "task" && !activity.completedAt), false);

  const reopened = store.updateActivity(context, task.id, { completedAt: null });
  assert.equal(reopened.completedAt, undefined);
});

await run("deals can be closed won or lost with reasons in extension data", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");

  const won = store.updateRecord(context, "deals", "deal-platform", {
    stageKey: "won",
    data: { dealStatus: "won", wonReason: "Selected private deployment", closedAt: "2026-06-18T09:00:00.000Z" }
  });
  assert.equal(won.stageKey, "won");
  assert.equal(won.data.dealStatus, "won");
  assert.equal(won.data.wonReason, "Selected private deployment");

  const lost = store.updateRecord(context, "deals", "deal-platform", {
    stageKey: "lost",
    data: { dealStatus: "lost", lostReason: "Budget delayed", closedAt: "2026-06-18T10:00:00.000Z" }
  });
  assert.equal(lost.stageKey, "lost");
  assert.equal(lost.data.dealStatus, "lost");
  assert.equal(lost.data.lostReason, "Budget delayed");
});

await run("related records resolve through reference fields", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const objectKeys = store.snapshot().objectDefinitions.map((object) => object.key);
  const records = objectKeys.flatMap((objectKey) => store.listRecords(context, objectKey));
  const fields = store.listFieldDefinitions(context);
  const relations = store.listRelationDefinitions(context);
  const company = store.getRecord(context, "companies", "company-acme");

  const related = findRelatedRecords(company, records, fields, relations);

  assert.equal(related.some((item) => item.record.id === "contact-lin"), true);
  assert.equal(related.some((item) => item.record.id === "deal-platform"), true);
});

await run("email accounts messages and thread summaries are workspace scoped", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Sales Inbox",
    emailAddress: "Sales@Example.com",
    provider: "smtp_imap",
    syncEnabled: true,
    sendEnabled: true,
    status: "active"
  });

  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "lin@example.com",
    to: ["sales@example.com"],
    subject: "Private deployment questions",
    bodyText: "Can you confirm Docker Compose delivery and SSO roadmap?",
    recordId: "contact-lin",
    receivedAt: "2026-06-19T09:00:00.000Z"
  });
  const threads = store.listEmailThreads(context, "contact-lin");
  const activities = store.listActivities(context, "contact-lin");

  assert.equal(account.emailAddress, "sales@example.com");
  assert.equal(message.status, "received");
  assert.equal(threads.length, 1);
  assert.match(threads[0].summary ?? "", /Private deployment questions/);
  assert.equal(store.listEmailMessages(context, threads[0].id)[0].id, message.id);
  assert.equal(activities.some((activity) => activity.type === "email" && activity.title === "Private deployment questions"), true);
});

await run("email assistant context obeys feature toggles and includes CRM history and knowledge", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "AI Mailbox",
    emailAddress: "ai-sales@example.com",
    provider: "custom"
  });
  const article = store.createKnowledgeArticle(context, {
    title: "SSO Roadmap",
    body: "Enterprise SSO is planned after the private deployment baseline is stable.",
    tags: ["sso", "deployment"]
  });
  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "lin@example.com",
    to: ["ai-sales@example.com"],
    subject: "SSO and deployment",
    bodyText: "We need private deployment details and SSO timing.",
    recordId: "deal-platform"
  });
  const thread = store.listEmailThreads(context, "deal-platform")[0];

  store.updateEmailAiSettings(context, { features: { draft: false, translate: true, context_analysis: true, auto_summarize: true }, maxHistoryMessages: 1 });
  const disabledDraft = store.buildEmailAssistantContext(context, {
    purpose: "draft",
    objectKey: "deals",
    recordId: "deal-platform",
    threadId: thread.id
  });
  assert.equal(disabledDraft.enabled, false);
  assert.match(disabledDraft.instruction, /disabled/);

  store.updateEmailAiSettings(context, { features: { draft: true } });
  const draftContext = store.buildEmailAssistantContext(context, {
    purpose: "draft",
    objectKey: "deals",
    recordId: "deal-platform",
    threadId: thread.id,
    targetLocale: "en-US"
  });

  assert.equal(draftContext.enabled, true);
  assert.match(draftContext.customerBrief, /Acme/);
  assert.match(draftContext.communicationSummary, /SSO and deployment/);
  assert.match(draftContext.knowledgeBrief, /SSO Roadmap/);
  assert.equal(draftContext.sources.some((source) => source.messageId === message.id), true);
  assert.equal(draftContext.sources.some((source) => source.knowledgeArticleId === article.id), true);
});

await run("ai query planner creates controlled high-value deal queries", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const definitions = store.snapshot().objectDefinitions;
  const fields = store.listFieldDefinitions(context);

  const plan = buildAiQueryPlan({
    question: "show high amount deals for Acme",
    objectDefinitions: definitions,
    fields,
    pageSize: 25
  });

  assert.equal(plan.objectKeys[0], "deals");
  assert.deepEqual(plan.objectKeys, ["deals"]);
  assert.equal(plan.queries.deals.page, 1);
  assert.equal(plan.queries.deals.pageSize, 25);
  assert.deepEqual(plan.queries.deals.sort, { field: "amount", direction: "desc" });
  assert.equal(plan.queries.deals.filters, undefined);
  assert.equal(plan.queries.deals.q, "Acme");
});

await run("ai query planner keeps explicit object scope", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const definitions = store.snapshot().objectDefinitions;
  const fields = store.listFieldDefinitions(context);

  const plan = buildAiQueryPlan({
    question: "show high amount deals",
    objectDefinitions: definitions,
    fields,
    objectKey: "contacts",
    pageSize: 25
  });

  assert.deepEqual(plan.objectKeys, ["contacts"]);
  assert.equal(plan.queries.contacts.sort, undefined);
});

await run("ai query planner validates model-shaped plans through allowlists", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const definitions = store.snapshot().objectDefinitions;
  const fields = store.listFieldDefinitions(context);
  const plan = validateAiQueryPlan(
    {
      objectKeys: ["deals", "missing"],
      queries: {
        deals: {
          page: 9,
          pageSize: 999,
          q: "x".repeat(300),
          filters: [
            { field: "DROP TABLE", operator: "contains", value: "bad" },
            { field: "amount", operator: "equals", value: "280000" }
          ],
          sort: { field: "DROP TABLE", direction: "asc" }
        }
      },
      reason: "model"
    },
    definitions,
    fields,
    25
  );

  assert.deepEqual(plan.objectKeys, ["deals"]);
  assert.equal(plan.queries.deals.page, 1);
  assert.equal(plan.queries.deals.pageSize, 25);
  assert.equal(plan.queries.deals.q?.length, 200);
  assert.deepEqual(plan.queries.deals.filters, [{ field: "amount", operator: "equals", value: "280000" }]);
  assert.equal(plan.queries.deals.sort, undefined);
});

await run("ai natural language queries reject write intents", () => {
  assert.doesNotThrow(() => assertReadOnlyAiQuestion("Find Acme opportunities this month"));
  assert.throws(() => assertReadOnlyAiQuestion("删除 Acme 联系人"), /read-only/);
  assert.throws(() => assertReadOnlyAiQuestion("move the deal to won"), /read-only/);
});

await run("ai suggestions stay read-only and source-backed", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const record = store.getRecord(context, "deals", "deal-platform");
  const activities = store.listActivities(context, record.id);
  const response = await createAiProvider().suggestNextActions({ record, activities });

  assert.match(response.text, /AI/);
  assert.match(response.text, /建议下一步/);
  assert.doesNotMatch(response.text, /锛|銆|鏆|鐨|\uFFFD/);
  assert.equal(response.sources[0]?.objectKey, record.objectKey);
  assert.equal(response.sources[0]?.recordId, record.id);
  assert.equal(store.getRecord(context, "deals", "deal-platform").stageKey, "proposal");
});

await run("openai-compatible ai provider calls chat completions and keeps local sources", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const record = store.getRecord(context, "deals", "deal-platform");
  const activities = store.listActivities(context, record.id);
  const requests = [];
  const provider = createAiProvider({
    config: {
      provider: "openai-compatible",
      apiKey: "test-key",
      baseUrl: "https://ai.example/v1/",
      model: "crm-test-model",
      timeoutMs: 1000
    },
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ text: "模型建议：联系采购负责人确认预算。 " }) } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const response = await provider.suggestNextActions({ record, activities });
  const body = JSON.parse(String(requests[0].init.body));

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://ai.example/v1/chat/completions");
  assert.equal(requests[0].init.headers.authorization, "Bearer test-key");
  assert.equal(body.model, "crm-test-model");
  assert.match(response.text, /模型建议/);
  assert.match(response.text, /不会修改|只读/);
  assert.equal(response.sources[0]?.objectKey, record.objectKey);
  assert.equal(response.sources[0]?.recordId, record.id);
});

await run("openai-compatible ai provider falls back when remote call fails", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const record = store.getRecord(context, "deals", "deal-platform");
  const provider = createAiProvider({
    config: {
      provider: "openai-compatible",
      apiKey: "test-key",
      baseUrl: "https://ai.example/v1",
      model: "crm-test-model",
      timeoutMs: 1000
    },
    fetchImpl: async () => new Response("bad gateway", { status: 502 })
  });

  const response = await provider.summarizeRecord({ record, fields: store.listFieldDefinitions(context, "deals"), activities: [] });

  assert.match(response.text, /不会修改|只读/);
  assert.equal(response.sources[0]?.objectKey, record.objectKey);
  assert.equal(response.sources[0]?.recordId, record.id);
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

const failed = results.filter((result) => !result.ok);
for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}`);
  if (!result.ok) {
    console.error(result.error);
  }
}

if (failed.length > 0) {
  process.exitCode = 1;
} else {
  console.log(`All ${results.length} tests passed.`);
}
