# MCP Local Proxy

This CRM includes a local stdio MCP server for agents such as OpenClaw. The MCP server does not connect to the database. It calls the deployed CRM over HTTPS with a CRM Bearer API key, so the existing API key permissions, RBAC, approval flow, audit logs, and API limits still apply.

## Configuration

Create an API key in the CRM and expose these environment variables where the local agent starts the MCP server:

```bash
CRM_BASE_URL="https://crm.example.com"
CRM_API_KEY="crm_live_..."
MCP_CRM_DEFAULT_PAGE_SIZE="50"
MCP_CRM_TIMEOUT_MS="30000"
```

Minimum recommended API key scopes:

- Read-only agent: `crm.read`, optionally `ai.use`
- Controlled read/write agent: `crm.read`, `crm.write`, optionally `ai.use`

Do not give a local agent `crm.admin`, `workflow.admin`, or `ai.admin` unless it explicitly needs administration access.

## Run

```bash
npm run mcp:server
```

Example local agent configuration:

```json
{
  "mcpServers": {
    "ai-agent-crm": {
      "command": "npm",
      "args": ["run", "mcp:server"],
      "env": {
        "CRM_BASE_URL": "https://crm.example.com",
        "CRM_API_KEY": "crm_live_...",
        "MCP_CRM_DEFAULT_PAGE_SIZE": "50"
      }
    }
  }
}
```

## Tools

- `crm_health`: checks `/api/health`.
- `crm_list_objects`: lists CRM object definitions.
- `crm_describe_object`: returns one object's definition, fields, relations, and pipelines.
- `crm_search_records`: searches records with `q`, pagination, filters, sort, selected fields, and pool.
- `crm_get_record`: fetches one record.
- `crm_create_record`: creates one record.
- `crm_update_record`: updates one record. If the CRM requires approval, the approval response is returned unchanged.
- `crm_list_activities`: lists activities, optionally by record.
- `crm_create_activity`: creates a note, call, meeting, task, or email activity.
- `crm_update_activity`: updates activity title, body, due date, completion, or archive state.
- `crm_ai_query`: calls the read-only `/api/ai/query` endpoint and requires `ai.use`.
- `crm_list_email_threads`, `crm_get_email_thread`, `crm_list_email_messages`: read-only email thread/message access.

The v1 MCP server intentionally does not expose delete operations, outbound email sending, user/API-key management, mailbox configuration, or workflow administration.
