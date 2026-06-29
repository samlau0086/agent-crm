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
    "record.auto_reclaimed": "自动回收",
    "record.change_requested": "记录变更待审批",
    "record.change_approved": "记录变更已批准",
    "record.change_rejected": "记录变更已拒绝",
    "record.change_cancelled": "记录变更已取消"
  };
  return labels[action] ?? action;
}
