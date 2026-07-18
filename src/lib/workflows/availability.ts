export function isWorkflowAutomationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.WORKFLOW_AUTOMATION_ENABLED?.trim().toLowerCase() === "true";
}

export function isWorkflowAutomationApiPath(pathname: string): boolean {
  return (
    pathname === "/api/workflows" ||
    pathname.startsWith("/api/workflows/") ||
    pathname === "/api/workflow-approvals" ||
    pathname.startsWith("/api/workflow-approvals/")
  );
}
