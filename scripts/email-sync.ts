import { setTimeout as sleep } from "node:timers/promises";
import { getCrmRepository, getRequestContextByUserId } from "@/lib/crm/repository";
import { scheduleEmailSyncForActiveAccounts } from "@/lib/email/sync-scheduler";
import type { CrmPoolSettings, EmailSyncSettings } from "@/lib/crm/types";
import { assertDatabaseReachable } from "./database-preflight.ts";
import { loadLocalEnvFiles } from "./load-env.ts";
import { configuredOperationalUserId, resolveOperationalUser, type OperationalUserResolution } from "./operational-user.ts";

loadLocalEnvFiles();

const args = parseArgs(process.argv.slice(2));
const userSelection = configuredOperationalUserId(args, ["EMAIL_SYNC_USER_ID", "JOB_USER_ID"]);
const loop = Boolean(args.loop);
const fallbackIntervalMs = normalizePositiveInteger(args["interval-ms"], process.env.EMAIL_SYNC_INTERVAL_MS, 300000);
const fallbackLimit = normalizeSyncLimit(args.limit, process.env.EMAIL_SYNC_LIMIT);
let stopping = false;

try {
  if (args["dry-run"]) {
    console.log(
      JSON.stringify(
        {
          event: "email_sync_plan",
          userId: userSelection.userId,
          userResolution: userSelection.strict
            ? "Use the explicit --user-id value and fail if it is unavailable or lacks crm.admin."
            : "Try the configured user id first, then fall back to the first active user with crm.admin.",
          loop,
          intervalMs: fallbackIntervalMs,
          limit: fallbackLimit,
          scheduleSource: "database EmailSyncSettings when available; environment fallback otherwise",
          requiredPermission: "crm.admin",
          action: "schedule active sync-enabled mailbox accounts"
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  if (loop) {
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    while (!stopping) {
      const nextDelayMs = await runSyncCycle();
      if (!stopping && nextDelayMs > 0) {
        await sleep(nextDelayMs);
      }
    }
  } else {
    await assertDatabaseReachable({ label: "email-sync" });
    const userResolution = await resolveOperationalUser({
      userId: userSelection.userId,
      strict: userSelection.strict,
      purpose: "email sync scheduling"
    });
    const context = userResolution.context;
    await runSync(context, userResolution);
    await runSmartReminderGenerationIfDue(context);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Email sync scheduling failed.");
  process.exit(1);
}

async function runSyncCycle(): Promise<number> {
  try {
    await assertDatabaseReachable({ label: "email-sync" });
    const userResolution = await resolveOperationalUser({
      userId: userSelection.userId,
      strict: userSelection.strict,
      purpose: "email sync scheduling"
    });
    const settings = await getCrmRepository().getEmailSyncSettings(userResolution.context);
    if (!settings.enabled) {
      console.log(JSON.stringify({ event: "email_sync_skipped", reason: "disabled", workspaceId: userResolution.context.workspaceId, userId: userResolution.context.user.id }));
      return 60_000;
    }
    const delayBeforeRun = settings.mode === "daily" ? msUntilDailyTime(settings.dailyAt) : 0;
    if (delayBeforeRun > 0) {
      console.log(JSON.stringify({ event: "email_sync_waiting", mode: settings.mode, dailyAt: settings.dailyAt, nextRunInMs: delayBeforeRun }));
      await sleep(delayBeforeRun);
      if (stopping) {
        return 0;
      }
    }
    await runSync(userResolution.context, userResolution, settings);
    await runPoolAutoReclaimIfDue(userResolution.context);
    await runSmartReminderGenerationIfDue(userResolution.context);
    return settings.mode === "interval" ? settings.intervalMinutes * 60_000 : 60_000;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Email sync scheduling failed.");
    return fallbackIntervalMs;
  }
}

async function runSync(context: Awaited<ReturnType<typeof getRequestContextByUserId>>, userResolution: OperationalUserResolution, settings?: EmailSyncSettings): Promise<void> {
  try {
    const effectiveLimit = settings?.limit ?? fallbackLimit;
    const summary = await scheduleEmailSyncForActiveAccounts(context, { limit: effectiveLimit });
    console.log(
      JSON.stringify(
        {
          event: "email_sync_scheduled",
          workspaceId: context.workspaceId,
          userId: context.user.id,
          operationalUser: {
            requestedUserId: userResolution.requestedUserId,
            resolvedUserId: userResolution.resolvedUserId,
            strict: userResolution.strict,
            fallbackUsed: userResolution.fallbackUsed,
            requiredPermission: userResolution.requiredPermission
          },
          loop,
          schedule: settings
            ? { enabled: settings.enabled, mode: settings.mode, intervalMinutes: settings.intervalMinutes, dailyAt: settings.dailyAt, limit: settings.limit }
            : { enabled: true, mode: "interval", intervalMinutes: Math.max(1, Math.floor(fallbackIntervalMs / 60_000)), limit: fallbackLimit },
          intervalMs: loop ? (settings?.intervalMinutes ? settings.intervalMinutes * 60_000 : fallbackIntervalMs) : undefined,
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

async function runPoolAutoReclaimIfDue(context: Awaited<ReturnType<typeof getRequestContextByUserId>>): Promise<void> {
  try {
    const repository = getCrmRepository();
    const settings = await repository.getPoolSettings(context);
    if (!shouldRunPoolAutoReclaim(settings)) {
      return;
    }
    const result = await repository.runPoolAutoReclaim(context);
    console.log(JSON.stringify({ event: "crm_pool_auto_reclaim", workspaceId: context.workspaceId, userId: context.user.id, ...result }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "CRM pool auto reclaim failed.");
  }
}

async function runSmartReminderGenerationIfDue(context: Awaited<ReturnType<typeof getRequestContextByUserId>>): Promise<void> {
  try {
    const repository = getCrmRepository();
    const users = await repository.getUsers(context);
    for (const user of users) {
      if (!user.active) {
        continue;
      }
      try {
        const userContext = await getRequestContextByUserId(user.id);
        if (!userContext.role.permissions.includes("ai.use")) {
          continue;
        }
        const result = await repository.runDailySmartReminderGenerationIfDue(userContext);
        if (result.ran) {
          console.log(
            JSON.stringify(
              {
                event: "ai_smart_reminders_daily",
                workspaceId: userContext.workspaceId,
                userId: userContext.user.id,
                ...result
              },
              null,
              2
            )
          );
        }
      } catch (error) {
        console.error(error instanceof Error ? `AI smart reminders failed for ${user.id}: ${error.message}` : `AI smart reminders failed for ${user.id}.`);
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "AI smart reminder scheduling failed.");
  }
}

function shouldRunPoolAutoReclaim(settings: CrmPoolSettings): boolean {
  if (!settings.enabled || !settings.autoReclaimEnabled) {
    return false;
  }
  if (!settings.lastAutoReclaimAt) {
    return true;
  }
  const lastRun = new Date(settings.lastAutoReclaimAt);
  const now = new Date();
  return lastRun.toDateString() !== now.toDateString();
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

function msUntilDailyTime(value: string): number {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  const hours = match ? Number(match[1]) : 3;
  const minutes = match ? Number(match[2]) : 0;
  const now = new Date();
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return Math.max(1000, next.getTime() - now.getTime());
}
