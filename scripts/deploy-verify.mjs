const args = parseArgs(process.argv.slice(2));
const healthUrl = args["health-url"] ?? process.env.DEPLOY_VERIFY_HEALTH_URL ?? "http://127.0.0.1:3000/api/health";
const timeoutMs = Number(args.timeout ?? process.env.DEPLOY_VERIFY_TIMEOUT_MS ?? 120000);
const backupOutput = args["backup-output"] ?? `/app/backups/deploy-verify-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`;
const steps = buildSteps(args, { healthUrl, timeoutMs, backupOutput });

try {
  if (args["dry-run"]) {
    console.log(JSON.stringify({ healthUrl, timeoutMs, backupOutput, steps }, null, 2));
    process.exit(0);
  }

  for (const step of steps) {
    console.error(`\n[deploy-verify] ${step.name}`);
    await runStep(step, { healthUrl, timeoutMs });
  }

  console.log("Deployment verification passed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Deployment verification failed.");
  process.exit(1);
}

function buildSteps(parsed, options) {
  const steps = [
    commandStep("Check Docker Compose", "docker", ["compose", "version"]),
    commandStep("Validate Docker Compose config", "docker", ["compose", "config"])
  ];

  if (!parsed["skip-build"]) {
    steps.push(commandStep("Build application images", "docker", ["compose", "build"]));
  }

  if (!parsed["skip-up"]) {
    steps.push(commandStep("Start application stack", "docker", ["compose", "up", "-d"]));
  }

  if (!parsed["skip-health"]) {
    steps.push({ type: "health", name: "Check application health", url: options.healthUrl, timeoutMs: options.timeoutMs });
  }

  if (!parsed["skip-backup"]) {
    steps.push(
      commandStep("Validate web container environment", "docker", ["compose", "exec", "-T", "web", "node", "scripts/validate-env.mjs"]),
      commandStep("Verify PostgreSQL client inside web container", "docker", ["compose", "exec", "-T", "web", "pg_dump", "--version"]),
      commandStep("Verify container backup plan", "docker", [
        "compose",
        "exec",
        "-T",
        "web",
        "node",
        "scripts/db-backup.mjs",
        "--dry-run",
        "--mode=direct",
        "--output",
        options.backupOutput
      ])
    );
  }

  if (!parsed["skip-email"]) {
    steps.push(
      commandStep("Validate email subsystem diagnostics", "docker", [
        "compose",
        "exec",
        "-T",
        "web",
        "node",
        "--experimental-strip-types",
        "--import",
        "./scripts/register-alias.mjs",
        "scripts/email-verify.ts",
        ...(parsed["run-email-connections"] && !parsed["require-live-email"] ? ["--test-connections"] : []),
        ...(parsed["run-email-ai-provider"] && !parsed["require-live-email"] ? ["--test-ai-provider"] : []),
        ...(parsed["run-email-smoke"] && !parsed["require-live-email"] ? ["--smoke"] : []),
        ...(parsed["require-live-email"] ? ["--require-live-readiness"] : [])
      ])
    );
  }

  if (parsed["run-backup"]) {
    steps.push(
      commandStep("Create verification backup", "docker", [
        "compose",
        "exec",
        "-T",
        "web",
        "node",
        "scripts/db-backup.mjs",
        "--mode=direct",
        "--output",
        options.backupOutput
      ])
    );
  }

  if (parsed["run-e2e"]) {
    steps.push(commandStep("Run full E2E suite", process.platform === "win32" ? "npm.cmd" : "npm", ["run", "test:e2e"]));
  }

  return steps;
}

function commandStep(name, command, commandArgs) {
  return { type: "command", name, command, args: commandArgs };
}

async function runStep(step, options) {
  if (step.type === "health") {
    await waitForHealth(options.healthUrl, options.timeoutMs);
    return;
  }

  const { spawn } = await import("node:child_process");
  await new Promise((resolveStep, reject) => {
    const child = spawn(step.command, step.args, { stdio: "inherit", windowsHide: true });
    child.on("error", (error) => reject(new Error(formatSpawnError(step.command, error))));
    child.on("close", (code) => {
      if (code === 0) {
        resolveStep();
        return;
      }
      reject(new Error(`${step.command} ${step.args.join(" ")} failed with exit code ${code ?? "unknown"}`));
    });
  });
}

async function waitForHealth(url, timeout) {
  const startedAt = Date.now();
  let lastError = "Health check did not run.";

  while (Date.now() - startedAt < timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.ok === true && payload.database === "ok") {
        console.error(`Health check passed: ${url} ${formatHealthSummary(payload)}`);
        return;
      }
      lastError = `HTTP ${response.status} ${formatHealthSummary(payload)} ${JSON.stringify(payload)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Health check failed.";
    } finally {
      clearTimeout(timer);
    }

    await sleep(3000);
  }

  throw new Error(`Health check failed before timeout: ${lastError}`);
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value.startsWith("--")) {
      const [key, inline] = value.slice(2).split("=", 2);
      if (inline !== undefined) {
        parsed[key] = inline;
        continue;
      }
      const next = values[index + 1];
      if (!next || next.startsWith("--")) {
        parsed[key] = true;
        continue;
      }
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function formatSpawnError(command, error) {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
    return `${command} was not found. Install Docker Desktop and make sure Docker is available in PATH.`;
  }
  return error instanceof Error ? error.message : `${command} failed.`;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function formatHealthSummary(payload) {
  return [
    `database=${payload?.database ?? "unknown"}`,
    `jobs=${payload?.jobs?.ok === true ? "ok" : payload?.jobs?.queue ?? "unknown"}`,
    `email=${payload?.emailReadiness?.status ?? payload?.email?.status ?? "unknown"}`,
    `emailSecrets=${payload?.emailReadiness?.encryption ?? payload?.email?.encryption?.status ?? "unknown"}`,
    `emailOAuthState=${payload?.emailReadiness?.oauthState ?? payload?.email?.oauthState?.status ?? "unknown"}`,
    `emailOAuthCallback=${payload?.emailReadiness?.oauthCallback ?? payload?.email?.oauthCallback?.status ?? "unknown"}`,
    `emailDelivery=${payload?.emailReadiness?.deliveryMode ?? payload?.email?.deliveryMode?.status ?? "unknown"}`,
    `emailAi=${payload?.emailReadiness?.aiProvider ?? payload?.email?.aiProvider?.status ?? "unknown"}`,
    `emailAiContext=${payload?.emailReadiness?.aiContextPolicy?.status ?? payload?.email?.aiContextPolicy?.status ?? "unknown"}`,
    `emailAiAutomations=${payload?.emailReadiness?.aiContextPolicy?.enabledAutomationCount ?? payload?.email?.aiContextPolicy?.enabledAutomationCount ?? "unknown"}`,
    `emailAiFallbacks=${payload?.emailReadiness?.aiProviderFallbacks?.recentFallbackCount ?? payload?.email?.aiProviderFallbacks?.recentFallbackCount ?? "unknown"}`,
    `emailAutoSummary=${payload?.emailReadiness?.autoSummaryPolicy?.status ?? payload?.email?.autoSummaryPolicy?.status ?? "unknown"}`,
    `emailSync=${payload?.emailReadiness?.syncScheduler?.status ?? payload?.email?.syncScheduler?.status ?? "unknown"}`,
    `emailSyncUserSource=${payload?.emailReadiness?.syncScheduler?.userIdSource ?? payload?.email?.syncScheduler?.userIdSource ?? "unknown"}`,
    `emailSyncFallback=${payload?.emailReadiness?.syncScheduler?.fallbackToAdmin ?? payload?.email?.syncScheduler?.fallbackToAdmin ?? "unknown"}`,
    `emailSendClaims=${payload?.emailReadiness?.sendClaims?.staleCount ?? payload?.email?.sendClaims?.staleCount ?? "unknown"}`
  ].join(" ");
}
