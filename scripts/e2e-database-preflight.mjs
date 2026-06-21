import { Socket } from "node:net";

export async function assertE2eDatabaseReachable(databaseUrl, options = {}) {
  if (process.env.E2E_SKIP_DATABASE_PREFLIGHT === "true") {
    return;
  }
  const label = options.label ?? "e2e";
  if (!databaseUrl?.trim()) {
    throw new Error(`[${label}] DATABASE_URL is required for browser E2E tests.`);
  }

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error(`[${label}] DATABASE_URL is not a valid URL.`);
  }

  const host = parsed.hostname;
  const port = Number(parsed.port || "5432");
  const timeoutMs = options.timeoutMs ?? Number(process.env.E2E_DATABASE_PREFLIGHT_TIMEOUT_MS ?? 5000);
  const ok = await canOpenTcpConnection(host, port, timeoutMs);
  if (!ok) {
    throw new Error(
      [
        `[${label}] Cannot reach PostgreSQL at ${host}:${port}.`,
        "[e2e] Start the local database before browser E2E tests.",
        "[e2e] With Docker Desktop available, run: docker compose up -d postgres",
        "[e2e] The compose file exposes Postgres on 127.0.0.1:54329 to match .env.local/.env.example."
      ].join("\n")
    );
  }
}

function canOpenTcpConnection(host, portNumber, timeoutMs) {
  return new Promise((resolveConnection) => {
    const socket = new Socket();
    let settled = false;
    const finish = (ok) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolveConnection(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(portNumber, host);
  });
}
