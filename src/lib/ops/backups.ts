import { mkdir, readdir, stat } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { spawn } from "node:child_process";

export interface BackupFile {
  name: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
}

export interface BackupRunResult {
  backup?: BackupFile;
  command: string;
  stdout: string;
  stderr: string;
}

export class BackupRunError extends Error {
  readonly command: string;
  readonly stdout: string;
  readonly stderr: string;

  constructor(message: string, input: { command: string; stdout: string; stderr: string }) {
    super(message);
    this.name = "BackupRunError";
    this.command = input.command;
    this.stdout = input.stdout;
    this.stderr = input.stderr;
  }
}

const BACKUP_EXTENSIONS = new Set([".dump", ".sql", ".backup"]);

export function getBackupDirectory(): string {
  return resolve(process.env.BACKUP_DIR ?? "backups");
}

export async function listBackupFiles(directory = getBackupDirectory()): Promise<BackupFile[]> {
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && isBackupFile(entry.name))
      .map(async (entry) => {
        const path = resolve(directory, entry.name);
        const info = await stat(path);
        return {
          name: entry.name,
          path,
          sizeBytes: info.size,
          createdAt: info.birthtime.toISOString()
        } satisfies BackupFile;
      })
  );

  return files.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function getBackupFile(name: string, directory = getBackupDirectory()): Promise<BackupFile | null> {
  const path = resolveBackupFilePath(name, directory);
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    return {
      name: basename(path),
      path,
      sizeBytes: info.size,
      createdAt: info.birthtime.toISOString()
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function resolveBackupFilePath(name: string, directory = getBackupDirectory()): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed !== basename(trimmed) || trimmed.includes("/") || trimmed.includes("\\") || !isBackupFile(trimmed)) {
    throw new Error("Invalid backup file name");
  }

  const root = resolve(directory);
  const path = resolve(root, trimmed);
  const relativePath = relative(root, path);
  if (relativePath.startsWith("..") || relativePath === "" || resolve(relativePath) === relativePath) {
    throw new Error("Invalid backup file name");
  }
  return path;
}

export async function createDatabaseBackup(directory = getBackupDirectory()): Promise<BackupRunResult> {
  await mkdir(directory, { recursive: true });
  const output = resolve(directory, `ai-agent-crm-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`);
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const args = ["run", "db:backup", "--", "--output", output];
  const command = `${npmCommand} ${args.join(" ")}`;
  const result = await runCommand(npmCommand, args);
  const backups = await listBackupFiles(directory);
  const backup = backups.find((file) => file.path === output);
  return { ...result, command, backup };
}

function isBackupFile(name: string): boolean {
  const lower = name.toLowerCase();
  return [...BACKUP_EXTENSIONS].some((extension) => lower.endsWith(extension));
}

function runCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      reject(new BackupRunError(formatSpawnError(error), { command: `${command} ${args.join(" ")}`, stdout, stderr }));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolveRun({ stdout, stderr });
        return;
      }
      reject(
        new BackupRunError(`Backup command failed with exit code ${code ?? "unknown"}`, {
          command: `${command} ${args.join(" ")}`,
          stdout,
          stderr
        })
      );
    });
  });
}

function formatSpawnError(error: NodeJS.ErrnoException): string {
  if (error.code === "ENOENT") {
    return "Backup command was not found. Make sure npm and Docker are available to the application runtime.";
  }
  return error.message;
}
