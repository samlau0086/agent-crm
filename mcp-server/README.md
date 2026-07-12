# AI Agent CRM MCP Server

这个目录是给 OpenClaw、Cherry Studio 等本地 MCP 客户端使用的轻量启动目录，可以单独拷贝到其他位置使用。

它不会直连数据库，只会读取以下环境变量，然后通过 HTTPS 调用远程 CRM REST API：

```bash
CRM_BASE_URL="https://crm.example.com"
CRM_API_KEY="crm_live_..."
MCP_CRM_DEFAULT_PAGE_SIZE="50"
MCP_CRM_TIMEOUT_MS="30000"
```

启动：

PowerShell 手动启动前，至少需要先设置 `CRM_BASE_URL` 和 `CRM_API_KEY`，否则会报 `CRM_BASE_URL is required` 或 `CRM_API_KEY is required`：

```powershell
$env:CRM_BASE_URL="https://你的-crm-域名"
$env:CRM_API_KEY="crm_live_你的apikey"
$env:MCP_CRM_DEFAULT_PAGE_SIZE="50"
$env:MCP_CRM_TIMEOUT_MS="30000"
```

```bash
npm install
npm run start
```

MCP 客户端配置时可以把 `cwd` 指向本目录，而不是仓库根目录。如果把本目录单独拷走，也只需要在该目录内执行 `npm install` 后再启动。

销售单据 MCP 覆盖报价单、销售订单、形式发票和商业发票的 CRUD、转换、PDF、CSV 导入导出、PDF 模板和编号规则。PDF/CSV 文件以 Base64 返回，并继续受远程 CRM 的 API key 权限、RBAC、审批流和审计日志约束。
