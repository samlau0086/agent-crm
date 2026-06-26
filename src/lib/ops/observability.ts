import type { PrismaClient } from "@prisma/client";

const defaultRecentApiMetricLimit = 200;
const defaultTopSlowQueryLimit = 20;

export interface ApiRequestMetric {
  route: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  recordedAt: string;
}

export interface DatabaseConnectionPoolSnapshot {
  total: number;
  active: number;
  idle: number;
  idleInTransaction: number;
  waiting: number;
  maxConnections?: number;
  usagePercent?: number;
  byState: Array<{ state: string; count: number }>;
}

export interface DatabaseSlowQueryStat {
  query: string;
  calls: number;
  totalExecTimeMs: number;
  meanExecTimeMs: number;
  maxExecTimeMs: number;
  rows: number;
}

export interface DatabaseObservabilitySnapshot {
  checkedAt: string;
  connectionPool: DatabaseConnectionPoolSnapshot;
  pgStatStatements: {
    enabled: boolean;
    error?: string;
    topSlowQueries: DatabaseSlowQueryStat[];
  };
  recentApiRequests: ApiRequestMetric[];
}

type GlobalWithApiMetrics = typeof globalThis & {
  __apiRequestMetrics?: ApiRequestMetric[];
};

function metricsStore(): ApiRequestMetric[] {
  const globalWithMetrics = globalThis as GlobalWithApiMetrics;
  globalWithMetrics.__apiRequestMetrics ??= [];
  return globalWithMetrics.__apiRequestMetrics;
}

export function recordApiRequestMetric(metric: ApiRequestMetric, limit = defaultRecentApiMetricLimit): void {
  const store = metricsStore();
  store.push(metric);
  if (store.length > limit) {
    store.splice(0, store.length - limit);
  }
}

export function listRecentApiRequestMetrics(limit = 50): ApiRequestMetric[] {
  return metricsStore()
    .slice(-Math.max(1, limit))
    .reverse();
}

export async function getDatabaseObservabilitySnapshot(
  prisma: PrismaClient,
  options: { apiMetricLimit?: number; slowQueryLimit?: number } = {}
): Promise<DatabaseObservabilitySnapshot> {
  const [connectionPool, pgStatStatements] = await Promise.all([
    getDatabaseConnectionPoolSnapshot(prisma),
    getPgStatStatementsSnapshot(prisma, options.slowQueryLimit ?? defaultTopSlowQueryLimit)
  ]);

  return {
    checkedAt: new Date().toISOString(),
    connectionPool,
    pgStatStatements,
    recentApiRequests: listRecentApiRequestMetrics(options.apiMetricLimit ?? 50)
  };
}

async function getDatabaseConnectionPoolSnapshot(prisma: PrismaClient): Promise<DatabaseConnectionPoolSnapshot> {
  const [stateRows, aggregateRows, maxConnectionRows] = await Promise.all([
    prisma.$queryRaw<Array<{ state: string | null; count: bigint | number }>>`
      SELECT COALESCE(state, 'unknown') AS state, count(*) AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
      GROUP BY COALESCE(state, 'unknown')
      ORDER BY count DESC
    `,
    prisma.$queryRaw<Array<{
      total: bigint | number;
      active: bigint | number;
      idle: bigint | number;
      idle_in_transaction: bigint | number;
      waiting: bigint | number;
    }>>`
      SELECT
        count(*) AS total,
        count(*) FILTER (WHERE state = 'active') AS active,
        count(*) FILTER (WHERE state = 'idle') AS idle,
        count(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_transaction,
        count(*) FILTER (WHERE wait_event IS NOT NULL) AS waiting
      FROM pg_stat_activity
      WHERE datname = current_database()
    `,
    prisma.$queryRaw<Array<{ setting: string }>>`SELECT setting FROM pg_settings WHERE name = 'max_connections'`
  ]);

  const aggregate = aggregateRows[0];
  const maxConnections = Number(maxConnectionRows[0]?.setting);
  const total = toNumber(aggregate?.total);

  return {
    total,
    active: toNumber(aggregate?.active),
    idle: toNumber(aggregate?.idle),
    idleInTransaction: toNumber(aggregate?.idle_in_transaction),
    waiting: toNumber(aggregate?.waiting),
    ...(Number.isFinite(maxConnections) ? { maxConnections, usagePercent: Math.round((total / maxConnections) * 1000) / 10 } : {}),
    byState: stateRows.map((row) => ({ state: row.state ?? "unknown", count: toNumber(row.count) }))
  };
}

async function getPgStatStatementsSnapshot(
  prisma: PrismaClient,
  limit: number
): Promise<DatabaseObservabilitySnapshot["pgStatStatements"]> {
  const extensionRows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') AS exists
  `;
  const enabled = Boolean(extensionRows[0]?.exists);
  if (!enabled) {
    return { enabled: false, topSlowQueries: [] };
  }

  try {
    const rows = await prisma.$queryRaw<Array<{
      query: string;
      calls: bigint | number;
      total_exec_time: number;
      mean_exec_time: number;
      max_exec_time: number;
      rows: bigint | number;
    }>>`
      SELECT query, calls, total_exec_time, mean_exec_time, max_exec_time, rows
      FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      ORDER BY mean_exec_time DESC
      LIMIT ${Math.max(1, Math.min(100, limit))}
    `;

    return {
      enabled: true,
      topSlowQueries: rows.map((row) => ({
        query: normalizeStatement(row.query),
        calls: toNumber(row.calls),
        totalExecTimeMs: roundMs(row.total_exec_time),
        meanExecTimeMs: roundMs(row.mean_exec_time),
        maxExecTimeMs: roundMs(row.max_exec_time),
        rows: toNumber(row.rows)
      }))
    };
  } catch (error) {
    return {
      enabled: true,
      error: error instanceof Error ? error.message : "Unable to read pg_stat_statements",
      topSlowQueries: []
    };
  }
}

function normalizeStatement(query: string): string {
  return query.replace(/\s+/g, " ").trim().slice(0, 2000);
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function toNumber(value: bigint | number | undefined): number {
  return typeof value === "bigint" ? Number(value) : value ?? 0;
}
