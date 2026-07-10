import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createCrmMcpClientFromEnv, type CrmMcpClient } from "@/mcp/client";
import { crmMcpToolDefinitions, executeCrmMcpTool } from "@/mcp/tools";

export function createCrmMcpServer(client: CrmMcpClient = createCrmMcpClientFromEnv()): McpServer {
  const server = new McpServer({
    name: "ai-agent-crm",
    version: "0.1.0"
  });

  const registerTool = server.registerTool.bind(server) as (
    name: string,
    config: { title: string; description: string; inputSchema: unknown },
    handler: (args: unknown) => Promise<unknown>
  ) => unknown;

  for (const definition of crmMcpToolDefinitions) {
    registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema
      },
      (args: unknown) => executeCrmMcpTool(definition.name, args, client)
    );
  }

  return server;
}

export async function runCrmMcpServer(): Promise<void> {
  const server = createCrmMcpServer();
  await server.connect(new StdioServerTransport());
}
