import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { assertE2eDatabaseReachable } from "./e2e-database-preflight.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const nextBin = resolve(projectRoot, "node_modules", "next", "dist", "bin", "next");
const port = process.env.E2E_PORT ?? "3014";
const distDir = process.env.E2E_NEXT_DIST_DIR ?? ".next-e2e";
const fileEnv = loadEnvFiles([".env", ".env.local"]);
const databasePreflightTimeoutMs = Number(process.env.E2E_DATABASE_PREFLIGHT_TIMEOUT_MS ?? 5000);

rmSync(resolve(projectRoot, distDir), { recursive: true, force: true });

const runtimeEnv = {
  ...fileEnv,
  ...process.env,
  ALLOW_TEST_USER_HEADER: "true",
  NEXT_DIST_DIR: distDir
};

try {
  await assertE2eDatabaseReachable(runtimeEnv.DATABASE_URL, { label: "e2e-next-dev", timeoutMs: databasePreflightTimeoutMs });
} catch (error) {
  console.error(error instanceof Error ? error.message : "[e2e-next-dev] Database preflight failed.");
  process.exit(1);
}

console.log(`[e2e-next-dev] starting Next dev server on http://127.0.0.1:${port}`);
console.log(`[e2e-next-dev] projectRoot=${projectRoot}`);
console.log(`[e2e-next-dev] nextBin=${nextBin}`);
console.log(`[e2e-next-dev] distDir=${distDir}`);

const child = spawn(process.execPath, [nextBin, "dev", "-p", port], {
  cwd: projectRoot,
  env: runtimeEnv,
  stdio: "inherit"
});

console.log(`[e2e-next-dev] child pid=${child.pid ?? "unknown"}`);

function shutdown(signal) {
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  child.kill(signal);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
child.on("exit", (code) => {
  console.log(`[e2e-next-dev] child exited with code=${code ?? "null"}`);
  process.exit(code ?? 0);
});
child.on("error", (error) => {
  console.error(`[e2e-next-dev] failed to start child: ${error.message}`);
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
