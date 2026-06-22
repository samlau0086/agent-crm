import { canOpenTcpConnection, checkDockerComposeAvailability, formatDatabasePreflightFailure, getDatabaseConnectionTarget as parseDatabaseConnectionTarget } from "./runtime-preflight.mjs";

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
    const dockerCompose = await checkDockerComposeAvailability();
    throw new Error(
      formatDatabasePreflightFailure({
        label: options.label,
        target,
        purpose: "running email verification, sync, or worker jobs",
        skipEnvName: "EMAIL_SKIP_DATABASE_PREFLIGHT",
        dockerCompose
      })
    );
  }
}

export function getDatabaseConnectionTarget(databaseUrl: string | undefined): DatabaseTarget {
  return parseDatabaseConnectionTarget(databaseUrl, "[email]") as DatabaseTarget;
}
