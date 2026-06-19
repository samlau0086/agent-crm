import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const nextBin = resolve(projectRoot, "node_modules", "next", "dist", "bin", "next");
const port = process.env.E2E_PORT ?? "3014";
const distDir = process.env.E2E_NEXT_DIST_DIR ?? ".next-e2e";

rmSync(resolve(projectRoot, distDir), { recursive: true, force: true });

const child = spawn(process.execPath, [nextBin, "dev", "-p", port], {
  cwd: projectRoot,
  env: {
    ...process.env,
    ALLOW_TEST_USER_HEADER: "true",
    NEXT_DIST_DIR: distDir
  },
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
child.on("exit", (code) => {
  process.exit(code ?? 0);
});
