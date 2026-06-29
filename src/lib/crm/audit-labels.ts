import type { AuditLog } from "@/lib/crm/types";

export function formatAuditAction(action: AuditLog["action"]): string {
  const labels: Record<AuditLog["action"], string> = {
    create: "创建",
    update: "更新",
    delete: "删除",
    import: "导入",
    api_error: "API 错误",
    "record.claimed": "领取记录",
    "record.released": "释放记录",
    "record.transferred": "转移记录",
    "record.auto_reclaimed": "自动回收"
  };
  return labels[action] ?? action;
}
