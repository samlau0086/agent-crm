import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const args = parseArgs(process.argv.slice(2));

if (!args.input) {
  console.error("Usage: npm run db:restore -- backups/file.dump yes");
  process.exit(1);
}

const input = resolve(args.input);
if (!existsSync(input)) {
  console.error(`Backup file does not exist: ${input}`);
  process.exit(1);
}

const mode = normalizeMode(args.mode);
const candidates = buildCandidates(args, mode, input);

if (args["dry-run"]) {
  console.log(JSON.stringify({ input, mode, candidates }, null, 2));
  process.exit(0);
}

if (args.yes !== true && args.yes !== "true") {
  console.error("Restore is destructive. Re-run with --yes after confirming the target database can be overwritten.");
  process.exit(1);
}

let lastError;
for (const candidate of candidates) {
  console.error(`Restoring database from: ${input}`);
  console.error(`Target: ${candidate.description}`);

  try {
    const exitCode = await runRestore(candidate);
    if (exitCode === 0) {
      console.log("Restore completed.");
      process.exit(0);
    }

    lastError = new Error(`Restore failed with exit code ${exitCode}.`);
    break;
  } catch (error) {
    lastError = error;
    if (mode === "auto" && candidate.kind === "direct" && isCommandMissing(error)) {
      console.error(`${formatProcessError(error)} Falling back to Docker Compose.`);
      continue;
    }
    break;
  }
}

console.error(formatProcessError(lastError));
process.exit(1);

function buildCandidates(parsed, selectedMode, filePath) {
  if (selectedMode === "direct") return [buildDirectCandidate(parsed, filePath)];
  if (selectedMode === "compose") return [buildComposeCandidate(parsed, filePath)];

  const values = [];
  if (getDatabaseUrl(parsed)) values.push(buildDirectCandidate(parsed, filePath));
  values.push(buildComposeCandidate(parsed, filePath));
  return values;
}

function buildDirectCandidate(parsed, filePath) {
  const databaseUrl = getDatabaseUrl(parsed);
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for direct restore mode.");
  }

  const isPlainSql = filePath.toLowerCase().endsWith(".sql");
  return isPlainSql
    ? {
        kind: "direct",
        command: "psql",
        args: [databaseUrl, "--set", "ON_ERROR_STOP=on", "--file", filePath],
        description: "direct psql restore using DATABASE_URL"
      }
    : {
        kind: "direct",
        command: "pg_restore",
        args: ["--dbname", databaseUrl, "--clean", "--if-exists", "--no-owner", "--no-acl", filePath],
        description: "direct pg_restore using DATABASE_URL"
      };
}

function buildComposeCandidate(parsed, filePath) {
  const service = parsed.service ?? process.env.POSTGRES_SERVICE ?? "postgres";
  const user = parsed.user ?? process.env.POSTGRES_USER ?? "crm";
  const database = parsed.database ?? process.env.POSTGRES_DB ?? "ai_agent_crm";
  const isPlainSql = filePath.toLowerCase().endsWith(".sql");
  const restoreCommand = isPlainSql
    ? ["psql", "-U", user, "-d", database, "--set", "ON_ERROR_STOP=on"]
    : ["pg_restore", "-U", user, "-d", database, "--clean", "--if-exists", "--no-owner", "--no-acl"];
  return {
    kind: "compose",
    command: "docker",
    args: ["compose", "exec", "-T", service, ...restoreCommand],
    stdinFile: filePath,
    description: `docker compose service=${service} database=${database} user=${user}`
  };
}

function getDatabaseUrl(parsed) {
  return parsed["database-url"] ?? parsed.url ?? process.env.DATABASE_URL;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--yes" || value === "yes" || value === "confirm") {
      parsed.yes = true;
      continue;
    }
    if (value === "--dry-run") {
      parsed["dry-run"] = true;
      continue;
    }
    if (value.startsWith("--")) {
      const [key, inline] = value.slice(2).split("=", 2);
      parsed[key] = inline ?? values[index + 1];
      if (inline === undefined) {
        index += 1;
      }
    } else if (!parsed.input) {
      parsed.input = value;
    }
  }
  return parsed;
}

function normalizeMode(value) {
  const mode = value ?? process.env.DB_MAINTENANCE_MODE ?? "auto";
  if (!["auto", "direct", "compose"].includes(mode)) {
    throw new Error("Restore mode must be one of: auto, direct, compose.");
  }
  return mode;
}

function runRestore(candidate) {
  return new Promise((resolveProcess, reject) => {
    const stdio = candidate.stdinFile ? ["pipe", "inherit", "inherit"] : ["ignore", "inherit", "inherit"];
    const child = spawn(candidate.command, candidate.args, { stdio, windowsHide: true });

    if (candidate.stdinFile) {
      import("node:fs").then(({ createReadStream }) => {
        createReadStream(candidate.stdinFile).pipe(child.stdin);
      }, reject);
    }

    child.on("error", reject);
    child.on("close", (code) => resolveProcess(code));
  });
}

function isCommandMissing(error) {
  return error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function formatProcessError(error) {
  if (isCommandMissing(error)) {
    return "Database restore command was not found. Install PostgreSQL client tools, or Docker Desktop for compose mode.";
  }
  return error instanceof Error ? error.message : "Restore process failed.";
}
