import type { AuditLog } from "@/lib/crm/types";

export function formatAuditAction(action: AuditLog["action"]): string {
  const labels: Record<AuditLog["action"], string> = {
    create: "创建",
    update: "更新",
    delete: "删除",
    import: "导入",
    api_error: "API 错误"
  };
  return labels[action] ?? action;
}
