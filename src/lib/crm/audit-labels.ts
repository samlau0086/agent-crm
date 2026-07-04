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
    "record.change_requested": "记录变更待审核",
    "record.change_approved": "记录变更已通过",
    "record.change_rejected": "记录变更已拒绝",
    "record.change_cancelled": "记录变更已取消",
    "customer_level.suggested": "客户等级建议",
    "customer_level.change_requested": "客户等级修改申请",
    "customer_level.changed": "客户等级已修改",
    "workflow.created": "创建工作流",
    "workflow.updated": "更新工作流",
    "workflow.deleted": "删除工作流",
    "workflow.enabled": "启用工作流",
    "workflow.disabled": "停用工作流",
    "workflow.run_started": "工作流开始",
    "workflow.run_completed": "工作流完成",
    "workflow.run_failed": "工作流失败",
    "workflow.action_approval_requested": "工作流动作待审批",
    "workflow.action_approved": "工作流动作已通过",
    "workflow.action_rejected": "工作流动作已拒绝"
  };
  return labels[action] ?? action;
}
