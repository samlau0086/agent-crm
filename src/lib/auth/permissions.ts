import type { Permission } from "@/lib/crm/types";

export interface PermissionCatalogItem {
  key: Permission;
  label: string;
  description: string;
  risk: "low" | "medium" | "high";
}

export const permissionCatalog = [
  {
    key: "crm.read",
    label: "读取 CRM",
    description: "查看对象、记录、活动、视图和仪表盘。",
    risk: "low"
  },
  {
    key: "crm.write",
    label: "写入 CRM",
    description: "创建和更新记录、任务、备注和销售阶段。",
    risk: "medium"
  },
  {
    key: "crm.import",
    label: "导入数据",
    description: "通过 CSV 批量导入联系人、公司和交易。",
    risk: "medium"
  },
  {
    key: "crm.pool.manage",
    label: "公海规则",
    description: "配置公海/私海规则，并强制释放或转移联系人、公司负责人。",
    risk: "high"
  },
  {
    key: "crm.admin",
    label: "管理员配置",
    description: "管理对象、字段、关系、管道、视图和审计日志。",
    risk: "high"
  },
  {
    key: "ai.use",
    label: "AI 助手",
    description: "使用只读摘要、下一步建议和自然语言查询。",
    risk: "low"
  },
  {
    key: "ai.admin",
    label: "AI Agent 管理",
    description: "管理 AI agent.md、模型、自动化 Agent 开关和 AI 策略。",
    risk: "high"
  }
] satisfies PermissionCatalogItem[];

export function describePermission(permission: Permission): PermissionCatalogItem {
  const item = permissionCatalog.find((candidate) => candidate.key === permission);
  if (!item) {
    return {
      key: permission,
      label: permission,
      description: "未登记的权限，请补充权限目录。",
      risk: "high"
    };
  }
  return item;
}
