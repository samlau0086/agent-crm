import { spawn } from "node:child_process";
import { Socket } from "node:net";

const LOCAL_DATABASE_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function getDatabaseConnectionTarget(databaseUrl, messagePrefix) {
  if (!databaseUrl?.trim()) {
    throw new Error(`${messagePrefix} DATABASE_URL is required.`);
  }
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error(`${messagePrefix} DATABASE_URL is not a valid URL.`);
  }
  return {
    host: parsed.hostname,
    port: Number(parsed.port || "5432")
  };
}

export function canOpenTcpConnection(host, portNumber, timeoutMs) {
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

export async function checkDockerComposeAvailability(options = {}) {
  const timeoutMs = options.timeoutMs ?? 1500;
  return new Promise((resolveCheck) => {
    const child = spawn("docker", ["compose", "version"], {
      stdio: "ignore",
      windowsHide: true
    });
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolveCheck(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ available: false, reason: "docker compose version timed out" });
    }, timeoutMs);
    child.once("error", (error) => {
      finish({
        available: false,
        reason: error && typeof error === "object" && "code" in error && error.code === "ENOENT" ? "docker was not found in PATH" : formatErrorMessage(error)
      });
    });
    child.once("close", (code) => {
      finish(code === 0 ? { available: true } : { available: false, reason: `docker compose version exited with code ${code ?? "unknown"}` });
    });
  });
}

export function formatDatabasePreflightFailure({ label, target, purpose, skipEnvName, dockerCompose }) {
  const prefix = `[${label}]`;
  const lines = [
    `${prefix} Cannot reach PostgreSQL at ${target.host}:${target.port}.`,
    `${prefix} Check DATABASE_URL and start the database before ${purpose}.`
  ];

  if (isLocalDatabaseHost(target.host)) {
    if (dockerCompose?.available === false) {
      lines.push(`${prefix} Docker CLI or Docker Compose is not available (${dockerCompose.reason ?? "unknown reason"}). Install or start Docker Desktop and make sure docker is in PATH.`);
      lines.push(`${prefix} After Docker is available, run: docker compose up -d postgres redis`);
    } else {
      lines.push(`${prefix} With Docker Desktop available, run: docker compose up -d postgres redis`);
    }
    lines.push(`${prefix} This project's compose file exposes Postgres on 127.0.0.1:54329 to match .env.local/.env.example.`);
  } else {
    lines.push(`${prefix} This DATABASE_URL points to a non-local host; verify DNS, firewall rules, credentials, and the database service status.`);
  }

  lines.push(`${prefix} To bypass only this preflight during investigation, set ${skipEnvName}=true.`);
  return lines.join("\n");
}

function isLocalDatabaseHost(host) {
  return LOCAL_DATABASE_HOSTS.has(host.toLowerCase());
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : "docker compose check failed";
}
