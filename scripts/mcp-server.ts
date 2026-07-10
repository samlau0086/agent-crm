import { runCrmMcpServer } from "@/mcp/server";

runCrmMcpServer().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
