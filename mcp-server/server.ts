import { runCrmMcpServer } from "./src/server.ts";

runCrmMcpServer().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
