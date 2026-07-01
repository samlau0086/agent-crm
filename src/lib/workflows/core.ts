import type {
  CrmRecord,
  WorkflowAction,
  WorkflowAiGenerationRequest,
  WorkflowAiGenerationResult,
  WorkflowCondition,
  WorkflowDefinition,
  WorkflowRun
} from "@/lib/crm/types";

export const supportedWorkflowTriggerEvents = [
  "record.created",
  "record.updated",
  "record.deleted",
  "activity.created",
  "email.message.received",
  "email.message.queued",
  "email.message.sent",
  "email.message.failed",
  "email.thread.updated",
  "task.completed",
  "task.overdue",
  "schedule.daily",
  "schedule.weekly",
  "schedule.interval",
  "manual.run"
] as const;

const highRiskWorkflowActions = new Set<WorkflowAction["type"]>(["send_email", "update_stage", "update_record"]);

export function isHighRiskWorkflowAction(action: WorkflowAction): boolean {
  return action.requiresApproval ?? highRiskWorkflowActions.has(action.type);
}

export function workflowMatchesEvent(workflow: WorkflowDefinition, event: string, data: Record<string, unknown>): boolean {
  if (workflow.status !== "active" && event !== "manual.run") {
    return false;
  }
  if (workflow.trigger.event !== event) {
    return false;
  }
  const objectKey = workflow.trigger.objectKey;
  if (objectKey && getString(data.objectKey) !== objectKey) {
    return false;
  }
  const targetRecordId = getString(workflow.trigger.config?.targetRecordId);
  if (targetRecordId && getString(data.recordId) !== targetRecordId) {
    return false;
  }
  return true;
}

export function buildWorkflowIdempotencyKey(workflow: WorkflowDefinition, event: string, data: Record<string, unknown>): string {
  const sourceId =
    getString(data.recordId) ||
    getString(data.threadId) ||
    getString(data.messageId) ||
    getString(data.activityId) ||
    getString(data.taskId) ||
    getString(data.id) ||
    "source";
  const eventVersion = getString(data.updatedAt) || getString(data.createdAt) || getString(data.lastMessageAt) || "";
  return [workflow.id, event, sourceId, eventVersion].filter(Boolean).join(":");
}

export function evaluateWorkflowConditions(workflow: WorkflowDefinition, data: Record<string, unknown>, record?: CrmRecord): WorkflowRun["conditionResults"] {
  return workflow.conditions.map((condition) => {
    const actualValue = readConditionValue(condition, data, record);
    const passed = evaluateConditionValue(condition, actualValue);
    return {
      key: condition.key,
      passed,
      actualValue
    };
  });
}

export function didWorkflowConditionsPass(results: WorkflowRun["conditionResults"]): boolean {
  return results.every((result) => result.passed);
}

export function buildWorkflowDraftFromGoal(input: WorkflowAiGenerationRequest): WorkflowAiGenerationResult {
  const goal = input.goal.trim();
  const lowerGoal = goal.toLowerCase();
  const recordTitle = input.recordTitle?.trim();
  const targetObjectKey = input.objectKey ?? (lowerGoal.includes("deal") || lowerGoal.includes("close") || goal.includes("交易") || goal.includes("成交") ? "deals" : "contacts");
  const isEmailGoal = lowerGoal.includes("email") || goal.includes("邮件") || goal.includes("回复") || goal.includes("未回复");
  const isDealGoal = targetObjectKey === "deals" || lowerGoal.includes("close") || goal.includes("成交") || goal.includes("推进");
  const isDormantGoal = goal.includes("天") || lowerGoal.includes("day") || lowerGoal.includes("dormant") || goal.includes("沉睡") || goal.includes("长期");
  const trigger = isEmailGoal
    ? { type: "email_event" as const, event: "email.message.received" as const, objectKey: targetObjectKey }
    : isDormantGoal
      ? { type: "schedule" as const, event: "schedule.daily" as const, schedule: { mode: "daily" as const, dailyAt: "09:00" } }
      : { type: "crm_event" as const, event: "record.updated" as const, objectKey: targetObjectKey };
  const scopedTrigger = input.recordId
    ? {
        ...trigger,
        config: {
          targetRecordId: input.recordId,
          targetRecordTitle: recordTitle,
          targetObjectKey
        }
      }
    : trigger;

  const conditions: WorkflowCondition[] = input.recordId
    ? [
        {
          key: "target-record",
          type: "if",
          field: "recordId",
          operator: "equals",
          value: input.recordId,
          config: {
            label: recordTitle ? `仅当触发记录是 ${recordTitle}` : "仅当触发记录是指定记录",
            branch: "matched"
          }
        }
      ]
    : isDealGoal
    ? [
        {
          key: "deal-stage-exists",
          type: "field",
          field: "stageKey",
          operator: "exists",
          value: true
        }
      ]
    : [
        {
          key: "record-owner-exists",
          type: "field",
          field: "ownerId",
          operator: "exists",
          value: true
        }
      ];

  const actions: WorkflowAction[] = [
    {
      key: "create-follow-up-task",
      type: "create_activity",
      name: "创建跟进任务",
      requiresApproval: false,
      config: {
        activityType: "task",
        title: isDealGoal ? "推进交易 Close" : "客户跟进",
        body: goal,
        dueInDays: isEmailGoal ? 1 : 2
      }
    }
  ];

  if (isEmailGoal) {
    actions.push({
      key: "draft-follow-up-email",
      type: "send_email",
      name: "生成待审核跟进邮件",
      requiresApproval: true,
      config: {
        mode: "draft",
        subject: "跟进：{{record.title}}",
        bodyText: "请基于客户背景、邮件摘要和最近活动生成一封简洁跟进邮件。"
      }
    });
  }

  const workflow: Omit<WorkflowDefinition, "id" | "workspaceId" | "createdById" | "createdAt" | "updatedAt"> = {
    name: recordTitle ? `${recordTitle} · ${goal.slice(0, 60)}` : goal.slice(0, 80) || "AI 生成工作流",
    description: recordTitle ? `由 Workflow Designer Agent 基于“${recordTitle}”生成的定向草稿，需要管理员确认后启用。` : "由 Workflow Designer Agent 生成的草稿，需要管理员确认后启用。",
    goal,
    status: "draft",
    trigger: scopedTrigger,
    conditions,
    actions,
    version: 1
  };

  return {
    workflow,
    explanation: {
      goal,
      triggerReason: input.recordId
        ? `目标绑定到指定记录${recordTitle ? `“${recordTitle}”` : ""}，因此先用 IF 节点限制触发范围。`
        : isEmailGoal ? "目标提到邮件或回复，因此使用邮件事件触发。" : isDormantGoal ? "目标包含时间窗口，因此使用定时触发。" : "目标面向 CRM 状态变化，因此使用记录更新触发。",
      expectedOutcome: "自动创建跟进任务，并在涉及邮件发送时进入审批队列。",
      risks: isEmailGoal ? ["邮件发送属于高风险动作，默认只生成待审核草稿。"] : ["自动化只创建任务，不直接修改关键 CRM 字段。"]
    }
  };
}

export function renderWorkflowTextTemplate(template: unknown, data: Record<string, unknown>, record?: CrmRecord): string {
  const raw = typeof template === "string" ? template : "";
  return raw.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    if (key === "record.title") return record?.title ?? "";
    if (key.startsWith("record.data.")) {
      const value = record?.data?.[key.slice("record.data.".length)];
      return value == null ? "" : String(value);
    }
    const value = data[key];
    return value == null ? "" : String(value);
  });
}

function readConditionValue(condition: WorkflowCondition, data: Record<string, unknown>, record?: CrmRecord): unknown {
  if (condition.type === "loop") {
    return true;
  }
  if (condition.type === "switch") {
    const field = condition.field ?? "objectKey";
    return field in data ? data[field] : record?.data?.[field] ?? (record as unknown as Record<string, unknown> | undefined)?.[field];
  }
  if (condition.type === "ai") {
    const text = [data.subject, data.bodyText, data.summary, record?.title].filter(Boolean).join(" ").toLowerCase();
    const prompt = String(condition.prompt ?? condition.value ?? "").toLowerCase();
    if (prompt.includes("高意向") || prompt.includes("high intent")) {
      return /报价|价格|采购|demo|pricing|quote|buy|purchase/.test(text);
    }
    return text.length > 0;
  }

  const field = condition.field ?? condition.key;
  if (field.startsWith("data.")) {
    return record?.data?.[field.slice("data.".length)] ?? data[field];
  }
  if (field in data) {
    return data[field];
  }
  if (record && field in record) {
    return (record as unknown as Record<string, unknown>)[field];
  }
  return record?.data?.[field];
}

function evaluateConditionValue(condition: WorkflowCondition, actualValue: unknown): boolean {
  const operator = condition.operator ?? "equals";
  if (operator === "exists") {
    return actualValue !== undefined && actualValue !== null && actualValue !== "";
  }
  if (operator === "not_exists") {
    return actualValue === undefined || actualValue === null || actualValue === "";
  }

  const expected = condition.value;
  if (operator === "equals") return normalizeComparable(actualValue) === normalizeComparable(expected);
  if (operator === "not_equals") return normalizeComparable(actualValue) !== normalizeComparable(expected);
  if (operator === "contains") return String(actualValue ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
  if (operator === "not_contains") return !String(actualValue ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());

  const actualNumber = Number(actualValue);
  const expectedNumber = Number(expected);
  if (Number.isNaN(actualNumber) || Number.isNaN(expectedNumber)) return false;
  if (operator === "gt") return actualNumber > expectedNumber;
  if (operator === "gte") return actualNumber >= expectedNumber;
  if (operator === "lt") return actualNumber < expectedNumber;
  if (operator === "lte") return actualNumber <= expectedNumber;
  return false;
}

function normalizeComparable(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : JSON.stringify(value ?? null);
}

function getString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
