import { Prisma, PrismaClient } from "@prisma/client";
import { loadLocalEnvFiles } from "./load-env";

loadLocalEnvFiles();

const prisma = new PrismaClient();

type BenchArgs = {
  objectKey: string;
  workspaceId: string;
  q: string;
  pageSize: number;
  companyId: string;
};

function readArgs(): BenchArgs {
  const args = new Map<string, string>();
  for (const item of process.argv.slice(2)) {
    const [key, ...valueParts] = item.replace(/^--/, "").split("=");
    args.set(key, valueParts.join("="));
  }
  return {
    objectKey: args.get("objectKey") ?? "contacts",
    workspaceId: args.get("workspaceId") ?? process.env.BENCH_WORKSPACE_ID ?? "workspace-default",
    q: args.get("q") ?? "test",
    pageSize: Math.min(200, Math.max(1, Number(args.get("pageSize") ?? 50) || 50)),
    companyId: args.get("companyId") ?? ""
  };
}

async function explain(label: string, sql: Prisma.Sql): Promise<void> {
  console.log(`\n# ${label}`);
  const rows = await prisma.$queryRaw<Array<{ "QUERY PLAN": string }>>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`);
  for (const row of rows) {
    console.log(row["QUERY PLAN"]);
  }
}

async function main() {
  const args = readArgs();
  await explain(
    "keyset contacts search",
    Prisma.sql`
      SELECT "id", "updatedAt"
      FROM "CrmRecord"
      WHERE "workspaceId" = ${args.workspaceId}
        AND "objectKey" = ${args.objectKey}
        AND (
          lower("title") LIKE '%' || lower(${args.q}) || '%'
          OR lower("data"->>'email') LIKE '%' || lower(${args.q}) || '%'
          OR lower("data"->>'phone') LIKE '%' || lower(${args.q}) || '%'
          OR lower("data"->>'contactMethods') LIKE '%' || lower(${args.q}) || '%'
        )
      ORDER BY "updatedAt" DESC, "id" ASC
      LIMIT ${args.pageSize + 1}
    `
  );

  if (args.companyId) {
    await explain(
      "contacts by companyId",
      Prisma.sql`
        SELECT "id", "updatedAt"
        FROM "CrmRecord"
        WHERE "workspaceId" = ${args.workspaceId}
          AND "objectKey" = 'contacts'
          AND "data"->>'companyId' = ${args.companyId}
        ORDER BY "updatedAt" DESC, "id" ASC
        LIMIT ${args.pageSize + 1}
      `
    );
  }

  await explain(
    "company domain search",
    Prisma.sql`
      SELECT "id", "updatedAt"
      FROM "CrmRecord"
      WHERE "workspaceId" = ${args.workspaceId}
        AND "objectKey" = 'companies'
        AND (
          lower("title") LIKE '%' || lower(${args.q}) || '%'
          OR lower("data"->>'domain') LIKE '%' || lower(${args.q}) || '%'
          OR lower("data"->>'industry') LIKE '%' || lower(${args.q}) || '%'
        )
      ORDER BY "updatedAt" DESC, "id" ASC
      LIMIT ${args.pageSize + 1}
    `
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
