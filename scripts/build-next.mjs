import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { checkBuildArtifacts } from "./check-build-artifacts.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const nextBin = resolve(projectRoot, "node_modules", "next", "dist", "bin", "next");
const graceMs = Number(process.env.NEXT_BUILD_EXIT_GRACE_MS ?? 300000);

const child = spawn(process.execPath, [nextBin, "build"], {
  cwd: projectRoot,
  env: process.env,
  stdio: "inherit",
  windowsHide: true
});

let settled = false;

const timer = setTimeout(() => {
  if (settled) {
    return;
  }
  const artifacts = checkBuildArtifacts();
  if (!artifacts.ok) {
    settled = true;
    killBuildProcessTree();
    console.error("[build-next] Next build did not exit before the grace timeout and required artifacts are missing.");
    console.error(JSON.stringify(artifacts, null, 2));
    process.exit(1);
  }

  settled = true;
  killBuildProcessTree();
  console.warn("[build-next] Next build did not exit before the grace timeout, but required production artifacts are present.");
  console.warn(JSON.stringify(artifacts, null, 2));
  process.exit(0);
}, graceMs);

child.on("error", (error) => {
  if (settled) {
    return;
  }
  settled = true;
  clearTimeout(timer);
  console.error(`[build-next] Failed to start Next build: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code) => {
  if (settled) {
    return;
  }
  settled = true;
  clearTimeout(timer);
  if (code === 0) {
    const artifacts = checkBuildArtifacts();
    if (!artifacts.ok) {
      console.error("[build-next] Next build exited successfully but required production artifacts are missing.");
      console.error(JSON.stringify(artifacts, null, 2));
      process.exit(1);
    }
    process.exit(0);
  }
  process.exit(code ?? 1);
});

function killBuildProcessTree() {
  if (!child.pid) {
    return;
  }
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
}
