# MCP 本地代理

本 CRM 提供一个本地 stdio MCP server，方便 OpenClaw、Cherry Studio 等本地 AI agent 操作远程部署的 CRM。

MCP server 不直连数据库，也不新增远程 `/mcp` 端点。它通过 `CRM_BASE_URL` + `CRM_API_KEY` 调用远程 CRM 的现有 HTTPS REST API，所以现有 Bearer API key 权限、RBAC、审批流、审计日志、分页和 API 限制都会继续生效。

简要来说：AI agent 在本地运行，CRM 在远程服务器运行；本地 MCP 客户端从 `mcp-server` 子目录启动 `npm run start`，这个本地 MCP server 再用 CRM API key 远程调用你的 CRM 服务。

## 配置

先在 CRM 后台创建 API key，然后在本地 MCP 客户端启动 server 的环境里设置：

```bash
CRM_BASE_URL="https://crm.example.com"
CRM_API_KEY="crm_live_..."
MCP_CRM_DEFAULT_PAGE_SIZE="50"
MCP_CRM_TIMEOUT_MS="30000"
```

推荐 API key 权限：

- 只读 agent：`crm.read`，可选 `ai.use`。
- 受控读写 agent：`crm.read`、`crm.write`，可选 `ai.use`。

除非本地 agent 明确需要管理能力，否则不要授予 `crm.admin`、`workflow.admin` 或 `ai.admin`。

## 启动

在本仓库目录执行：

PowerShell 手动启动前，至少需要先设置 `CRM_BASE_URL` 和 `CRM_API_KEY`，否则会报 `CRM_BASE_URL is required` 或 `CRM_API_KEY is required`：

```powershell
$env:CRM_BASE_URL="https://你的-crm-域名"
$env:CRM_API_KEY="crm_live_你的apikey"
$env:MCP_CRM_DEFAULT_PAGE_SIZE="50"
$env:MCP_CRM_TIMEOUT_MS="30000"
```

推荐在专用子目录执行，这样 OpenClaw / Cherry Studio 不需要直接指向仓库根目录：

```bash
cd mcp-server
npm install
npm run start
```

## OpenClaw / Cherry Studio 对接

在 OpenClaw、Cherry Studio 或其他支持 MCP stdio 的客户端里添加一个 MCP server，类型选择 `stdio` 或 “Command”，工作目录指向本仓库。

通用配置示例：

```json
{
  "mcpServers": {
    "ai-agent-crm": {
      "command": "npm",
      "args": ["run", "start"],
      "cwd": "C:\\Users\\samla\\Documents\\ai-agent-crm\\mcp-server",
      "env": {
        "CRM_BASE_URL": "https://crm.example.com",
        "CRM_API_KEY": "crm_live_...",
        "MCP_CRM_DEFAULT_PAGE_SIZE": "50",
        "MCP_CRM_TIMEOUT_MS": "30000"
      }
    }
  }
}
```

Windows 注意事项：

- 如果客户端找不到 `npm`，把 `"command": "npm"` 改成 `"command": "npm.cmd"`。
- 如果客户端界面没有 `cwd` 字段，就使用它提供的“工作目录/启动目录”设置，并指向 `mcp-server` 子目录。
- `CRM_BASE_URL` 应填写远程 CRM 的 HTTPS 地址，例如 `https://crm.example.com`。
- `CRM_API_KEY` 应使用 CRM 后台创建的 API key，不要使用用户登录密码。

## 当前支持的 MCP 工具

- `crm_health`：检查远程 `/api/health`。
- `crm_list_objects`：列出当前 API key 可见的 CRM 对象定义。
- `crm_describe_object`：返回某个对象的定义、字段、关系和管道信息。
- `crm_search_records`：搜索或分页列出记录，支持 `q`、分页、filters、sort、fields 和 pool。
- `crm_get_record`：读取一条记录。
- `crm_create_record`：创建一条记录。
- `crm_update_record`：更新一条记录。如果 CRM 要求审批，会原样返回 `pendingApproval` 响应。
- `crm_list_activities`：列出活动，可按 `recordId` 过滤。
- `crm_create_activity`：创建备注、电话、会议、任务或邮件活动。
- `crm_update_activity`：更新活动标题、正文、到期时间、完成状态或归档状态。
- `crm_ai_query`：调用只读 `/api/ai/query`，需要 API key 具备 `ai.use`。
- `crm_list_email_threads`：只读列出可见邮件线程。
- `crm_get_email_thread`：只读读取一条邮件线程。
- `crm_list_email_messages`：只读列出某个邮件线程下的消息。

## 安全边界

v1 MCP server 有意不暴露以下高风险能力：

- 删除记录或活动。
- 发送外部邮件。
- 管理用户、角色、团队或 API key。
- 配置邮箱账号、OAuth 或 SMTP/IMAP 密钥。
- 启停、删除或管理工作流。
- 直接连接数据库或绕过 CRM REST API。

所有写操作都依赖远程 CRM 的 API key 权限。对于联系人、公司、交易等触发审批的记录变更，MCP 只返回审批状态，不会绕过现有审批流。
