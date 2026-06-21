import { Socket } from "node:net";

export interface DatabaseTarget {
  host: string;
  port: number;
}

export interface DatabasePreflightOptions {
  databaseUrl?: string;
  label: string;
  skip?: boolean;
  timeoutMs?: number;
}

export async function assertDatabaseReachable(options: DatabasePreflightOptions): Promise<void> {
  if (options.skip || process.env.EMAIL_SKIP_DATABASE_PREFLIGHT === "true") {
    return;
  }
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  const target = getDatabaseConnectionTarget(databaseUrl);
  const ok = await canOpenTcpConnection(target.host, target.port, options.timeoutMs ?? Number(process.env.EMAIL_DATABASE_PREFLIGHT_TIMEOUT_MS ?? 5000));
  if (!ok) {
    throw new Error(
      [
        `[${options.label}] Cannot reach PostgreSQL at ${target.host}:${target.port}.`,
        "[email] Start the local database before running email verification, sync, or worker jobs.",
        "[email] With Docker Desktop available, run: docker compose up -d postgres",
        "[email] The compose file exposes Postgres on 127.0.0.1:54329 to match .env.local/.env.example."
      ].join("\n")
    );
  }
}

export function getDatabaseConnectionTarget(databaseUrl: string | undefined): DatabaseTarget {
  if (!databaseUrl?.trim()) {
    throw new Error("[email] DATABASE_URL is required for email verification and sync.");
  }
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("[email] DATABASE_URL is not a valid URL.");
  }
  return {
    host: parsed.hostname,
    port: Number(parsed.port || "5432")
  };
}

function canOpenTcpConnection(host: string, portNumber: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolveConnection) => {
    const socket = new Socket();
    let settled = false;
    const finish = (ok: boolean) => {
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
