import { createWriteStream, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const output = resolve(args.output ?? `backups/ai-agent-crm-${timestamp()}.dump`);
const mode = normalizeMode(args.mode);
const candidates = buildCandidates(args, mode);

if (args["dry-run"]) {
  console.log(JSON.stringify({ output, mode, candidates }, null, 2));
  process.exit(0);
}

mkdirSync(dirname(output), { recursive: true });

let lastError;
for (const candidate of candidates) {
  console.error(`Creating database backup: ${output}`);
  console.error(`Source: ${candidate.description}`);

  try {
    const exitCode = await runBackup(candidate, output);
    if (exitCode === 0) {
      console.log(output);
      process.exit(0);
    }

    lastError = new Error(`Backup failed with exit code ${exitCode}.`);
    break;
  } catch (error) {
    lastError = error;
    rmSync(output, { force: true });
    if (mode === "auto" && candidate.kind === "direct" && isCommandMissing(error)) {
      console.error(`${formatProcessError(error)} Falling back to Docker Compose.`);
      continue;
    }
    break;
  }
}

rmSync(output, { force: true });
console.error(formatProcessError(lastError));
process.exit(1);

function buildCandidates(parsed, selectedMode) {
  if (selectedMode === "direct") return [buildDirectCandidate(parsed)];
  if (selectedMode === "compose") return [buildComposeCandidate(parsed)];

  const values = [];
  if (getDatabaseUrl(parsed)) values.push(buildDirectCandidate(parsed));
  values.push(buildComposeCandidate(parsed));
  return values;
}

function buildDirectCandidate(parsed) {
  const databaseUrl = getDatabaseUrl(parsed);
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for direct backup mode.");
  }
  return {
    kind: "direct",
    command: "pg_dump",
    args: ["--format=custom", "--no-owner", "--no-acl", databaseUrl],
    description: "direct pg_dump using DATABASE_URL"
  };
}

function buildComposeCandidate(parsed) {
  const service = parsed.service ?? process.env.POSTGRES_SERVICE ?? "postgres";
  const user = parsed.user ?? process.env.POSTGRES_USER ?? "crm";
  const database = parsed.database ?? process.env.POSTGRES_DB ?? "ai_agent_crm";
  return {
    kind: "compose",
    command: "docker",
    args: ["compose", "exec", "-T", service, "pg_dump", "-U", user, "-d", database, "--format=custom", "--no-owner", "--no-acl"],
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
    } else if (!parsed.output) {
      parsed.output = value;
    }
  }
  return parsed;
}

function normalizeMode(value) {
  const mode = value ?? process.env.DB_MAINTENANCE_MODE ?? "auto";
  if (!["auto", "direct", "compose"].includes(mode)) {
    throw new Error("Backup mode must be one of: auto, direct, compose.");
  }
  return mode;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function runBackup(candidate, target) {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(candidate.command, candidate.args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const file = createWriteStream(target, { flags: "wx" });

    child.stdout.pipe(file);
    child.stderr.pipe(process.stderr);
    file.on("error", reject);
    child.on("error", reject);
    child.on("close", (code) => {
      file.end(() => resolveProcess(code));
    });
  });
}

function isCommandMissing(error) {
  return error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function formatProcessError(error) {
  if (isCommandMissing(error)) {
    return "Database backup command was not found. Install PostgreSQL client tools, or Docker Desktop for compose mode.";
  }
  return error instanceof Error ? error.message : "Backup process failed.";
}
