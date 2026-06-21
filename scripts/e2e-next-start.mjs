import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { assertE2eDatabaseReachable } from "./e2e-database-preflight.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const buildIdPath = resolve(projectRoot, ".next", "BUILD_ID");
const nextBin = resolve(projectRoot, "node_modules", "next", "dist", "bin", "next");
const port = process.env.E2E_PORT ?? "3014";
const databasePreflightTimeoutMs = Number(process.env.E2E_DATABASE_PREFLIGHT_TIMEOUT_MS ?? 5000);

if (!existsSync(buildIdPath)) {
  console.error("[e2e-next-start] Missing .next/BUILD_ID. Run npm run build before npm run test:e2e.");
  process.exit(1);
}
if (!existsSync(nextBin)) {
  console.error("[e2e-next-start] Missing node_modules/next/dist/bin/next. Run npm install before npm run test:e2e.");
  process.exit(1);
}

const fileEnv = loadEnvFiles([".env", ".env.local"]);
const e2eEnv = {
  EMAIL_CONFIG_SECRET: "e2e-local-email-config-secret-32",
  EMAIL_OAUTH_STATE_SECRET: "e2e-local-oauth-state-secret-32",
  EMAIL_DELIVERY_MODE: "dry-run"
};
const runtimeEnv = {
  ...fileEnv,
  ...e2eEnv,
  ...process.env,
  PORT: port,
  HOSTNAME: "127.0.0.1",
  ALLOW_TEST_USER_HEADER: "true"
};

try {
  await assertE2eDatabaseReachable(runtimeEnv.DATABASE_URL, { label: "e2e-next-start", timeoutMs: databasePreflightTimeoutMs });
} catch (error) {
  console.error(error instanceof Error ? error.message : "[e2e-next-start] Database preflight failed.");
  process.exit(1);
}

console.log(`[e2e-next-start] starting Next production server on http://127.0.0.1:${port}`);

const child = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", port], {
  cwd: projectRoot,
  env: runtimeEnv,
  stdio: "inherit"
});

function shutdown(signal) {
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  child.kill(signal);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
child.on("error", (error) => {
  console.error(`[e2e-next-start] failed to start child: ${error.message}`);
});
child.on("exit", (code) => {
  console.log(`[e2e-next-start] child exited with code=${code ?? "null"}`);
  process.exit(code ?? 0);
});

function loadEnvFiles(fileNames) {
  const values = {};
  for (const fileName of fileNames) {
    const filePath = resolve(projectRoot, fileName);
    if (!existsSync(filePath)) {
      continue;
    }
    const content = readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }
      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      values[key] = unquoteEnvValue(rawValue);
    }
  }
  return values;
}

function unquoteEnvValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
