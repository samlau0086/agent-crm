import { PrismaClient } from "@prisma/client";

type GlobalWithPrisma = typeof globalThis & {
  __prisma?: PrismaClient;
};

function getPrismaClient(): PrismaClient {
  const globalWithPrisma = globalThis as GlobalWithPrisma;
  if (!globalWithPrisma.__prisma) {
    const client = new PrismaClient({
      log: [
        { emit: "event", level: "query" },
        { emit: "stdout", level: "error" },
        ...(process.env.NODE_ENV === "development" ? [{ emit: "stdout" as const, level: "warn" as const }] : [])
      ]
    });
    client.$on("query", (event) => {
      const thresholdMs = getSlowQueryThresholdMs();
      if (event.duration < thresholdMs) {
        return;
      }
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "db_slow_query",
          durationMs: event.duration,
          thresholdMs,
          query: normalizeQueryForLog(event.query)
        })
      );
    });
    globalWithPrisma.__prisma = client;
  }
  return globalWithPrisma.__prisma;
}

function getSlowQueryThresholdMs(): number {
  const parsed = Number(process.env.DB_SLOW_QUERY_MS ?? "500");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 500;
}

function normalizeQueryForLog(query: string): string {
  return query.replace(/\s+/g, " ").trim().slice(0, 2000);
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  }
});
