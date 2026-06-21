import { setTimeout as sleep } from "node:timers/promises";
import { getRequestContextByUserId } from "@/lib/crm/repository";
import { scheduleEmailSyncForActiveAccounts } from "@/lib/email/sync-scheduler";
import { assertDatabaseReachable } from "./database-preflight.ts";
import { loadLocalEnvFiles } from "./load-env.ts";

loadLocalEnvFiles();

const args = parseArgs(process.argv.slice(2));
const userId = String(args["user-id"] || process.env.EMAIL_SYNC_USER_ID || process.env.JOB_USER_ID || "user-admin");
const loop = Boolean(args.loop);
const intervalMs = normalizePositiveInteger(args["interval-ms"], process.env.EMAIL_SYNC_INTERVAL_MS, 300000);
const limit = normalizeSyncLimit(args.limit, process.env.EMAIL_SYNC_LIMIT);
let stopping = false;

try {
  if (args["dry-run"]) {
    console.log(
      JSON.stringify(
        {
          event: "email_sync_plan",
          userId,
          loop,
          intervalMs,
          limit,
          requiredPermission: "crm.admin",
          action: "schedule active sync-enabled mailbox accounts"
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  await assertDatabaseReachable({ label: "email-sync" });
  const context = await getRequestContextByUserId(userId);

  if (loop) {
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    while (!stopping) {
      await runSync(context);
      if (!stopping) {
        await sleep(intervalMs);
      }
    }
  } else {
    await runSync(context);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Email sync scheduling failed.");
  process.exit(1);
}

async function runSync(context: Awaited<ReturnType<typeof getRequestContextByUserId>>): Promise<void> {
  try {
    const summary = await scheduleEmailSyncForActiveAccounts(context, { limit });
    console.log(
      JSON.stringify(
        {
          event: "email_sync_scheduled",
          workspaceId: context.workspaceId,
          userId: context.user.id,
          loop,
          intervalMs: loop ? intervalMs : undefined,
          limit: summary.limit,
          scheduledCount: summary.scheduledCount,
          skippedCount: summary.skippedCount,
          accounts: summary.accounts
        },
        null,
        2
      )
    );
  } catch (error) {
    if (!loop) {
      throw error;
    }
    console.error(error instanceof Error ? error.message : "Email sync scheduling failed.");
  }
}

function stop(): void {
  stopping = true;
}

function parseArgs(values: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      continue;
    }
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
  return parsed;
}

function normalizePositiveInteger(argValue: string | boolean | undefined, envValue: string | undefined, fallback: number): number {
  const value = Number(argValue || envValue || fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function normalizeSyncLimit(argValue: string | boolean | undefined, envValue: string | undefined): number | undefined {
  const rawValue = argValue || envValue;
  if (!rawValue || rawValue === true) {
    return undefined;
  }
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error("EMAIL_SYNC_LIMIT or --limit must be an integer between 1 and 100.");
  }
  return value;
}
