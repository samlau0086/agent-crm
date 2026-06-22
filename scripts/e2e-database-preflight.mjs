import { canOpenTcpConnection, checkDockerComposeAvailability, formatDatabasePreflightFailure, getDatabaseConnectionTarget } from "./runtime-preflight.mjs";

export async function assertE2eDatabaseReachable(databaseUrl, options = {}) {
  if (process.env.E2E_SKIP_DATABASE_PREFLIGHT === "true") {
    return;
  }
  const label = options.label ?? "e2e";
  if (!databaseUrl?.trim()) {
    throw new Error(`[${label}] DATABASE_URL is required for browser E2E tests.`);
  }

  const target = getDatabaseConnectionTarget(databaseUrl, `[${label}]`);
  const timeoutMs = options.timeoutMs ?? Number(process.env.E2E_DATABASE_PREFLIGHT_TIMEOUT_MS ?? 5000);
  const ok = await canOpenTcpConnection(target.host, target.port, timeoutMs);
  if (!ok) {
    const dockerCompose = await checkDockerComposeAvailability();
    throw new Error(formatDatabasePreflightFailure({ label, target, purpose: "browser E2E tests", skipEnvName: "E2E_SKIP_DATABASE_PREFLIGHT", dockerCompose }));
  }
}
