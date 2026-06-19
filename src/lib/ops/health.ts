import { redisCommand } from "@/lib/jobs/redis-queue";

export type JobHealth = {
  ok: boolean;
  executor: string;
  queue: "inline" | "ok" | "error";
  redis?: "ok" | "missing_config" | "error";
  error?: string;
};

type CheckJobHealthOptions = {
  executor?: string;
  redisUrl?: string;
  ping?: (redisUrl: string) => Promise<unknown>;
};

export async function checkJobHealth(options: CheckJobHealthOptions = {}): Promise<JobHealth> {
  const executor = (options.executor ?? process.env.JOB_EXECUTOR ?? "inline").trim() || "inline";

  if (executor !== "redis") {
    return {
      ok: true,
      executor,
      queue: "inline"
    };
  }

  const redisUrl = (options.redisUrl ?? process.env.REDIS_URL ?? "").trim();
  if (!redisUrl) {
    return {
      ok: false,
      executor,
      queue: "error",
      redis: "missing_config",
      error: "REDIS_URL is required when JOB_EXECUTOR=redis"
    };
  }

  const ping = options.ping ?? ((url: string) => redisCommand(["PING"], url));

  try {
    const reply = await ping(redisUrl);
    if (reply !== "PONG") {
      return {
        ok: false,
        executor,
        queue: "error",
        redis: "error",
        error: "Redis PING returned an unexpected reply"
      };
    }

    return {
      ok: true,
      executor,
      queue: "ok",
      redis: "ok"
    };
  } catch (error) {
    return {
      ok: false,
      executor,
      queue: "error",
      redis: "error",
      error: toSafeHealthError(error, "Redis PING failed")
    };
  }
}

export function toSafeHealthError(error: unknown, fallback = "Health check failed"): string {
  const message = error instanceof Error ? error.message : String(error || fallback);
  return message
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/redis:\/\/\S+/gi, "redis://[redacted]");
}
