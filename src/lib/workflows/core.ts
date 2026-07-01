import type {
  CrmRecord,
  WorkflowAction,
  WorkflowAiGenerationRequest,
  WorkflowAiGenerationResult,
  WorkflowCondition,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
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
  const graph = workflow.graph ?? legacyWorkflowToGraph(workflow);
  if (!workflowScopeMatchesEvent(graph, data)) {
    return false;
  }
  return true;
}

export function workflowScopeMatchesEvent(graph: WorkflowGraph, data: Record<string, unknown>): boolean {
  if (graph.scope.mode === "global") return true;
  if (graph.scope.objectKey && getString(data.objectKey) !== graph.scope.objectKey) return false;
  if (graph.scope.mode === "record" && graph.scope.recordId && getString(data.recordId) !== graph.scope.recordId) return false;
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

export function buildWorkflowTestIdempotencyKey(workflow: WorkflowDefinition, event: string): string {
  return [workflow.id, event, "test", Date.now().toString(36), Math.random().toString(36).slice(2, 10)].join(":");
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

export function evaluateWorkflowCondition(condition: WorkflowCondition, data: Record<string, unknown>, record?: CrmRecord): { passed: boolean; actualValue: unknown } {
  const actualValue = readConditionValue(condition, data, record);
  return { passed: evaluateConditionValue(condition, actualValue), actualValue };
}

export function didWorkflowConditionsPass(results: WorkflowRun["conditionResults"]): boolean {
  return results.every((result) => result.passed);
}

export function normalizeWorkflowGraph(value: unknown, fallback: Pick<WorkflowDefinition, "trigger" | "conditions" | "actions">): WorkflowGraph {
  if (!isRecord(value)) {
    return legacyWorkflowToGraph(fallback);
  }
  const nodes = Array.isArray(value.nodes) ? value.nodes.filter(isRecord).map(normalizeWorkflowNode).filter((node): node is WorkflowNode => Boolean(node)) : [];
  const edges = Array.isArray(value.edges) ? value.edges.filter(isRecord).map(normalizeWorkflowEdge).filter((edge): edge is WorkflowEdge => Boolean(edge)) : [];
  const scope = normalizeWorkflowScope(value.scope, fallback.trigger);
  if (!nodes.some((node) => node.type === "start")) {
    return legacyWorkflowToGraph(fallback);
  }
  if (!nodes.some((node) => node.type === "end")) {
    nodes.push({ id: "end", type: "end", label: "End", position: { x: 900, y: 120 }, config: {} });
  }
  return { scope, nodes, edges };
}

export function legacyWorkflowToGraph(workflow: Pick<WorkflowDefinition, "trigger" | "conditions" | "actions">): WorkflowGraph {
  const scope = normalizeWorkflowScope(workflow.trigger.config, workflow.trigger);
  const start: WorkflowNode = {
    id: "start",
    type: "start",
    label: scope.mode === "record" && scope.recordTitle ? `Start: ${scope.recordTitle}` : "Start",
    position: { x: 40, y: 160 },
    config: { trigger: workflow.trigger }
  };
  const conditionNodes = workflow.conditions.map((condition, index): WorkflowNode => ({
    id: `condition:${condition.key}`,
    type: condition.type === "switch" ? "switch" : condition.type === "loop" ? "loop" : "if",
    label: conditionLabel(condition),
    position: { x: 300 + index * 220, y: 160 },
    config: { condition }
  }));
  const actionNodes = workflow.actions.map((action, index): WorkflowNode => ({
    id: `action:${action.key}`,
    type: workflowActionToNodeType(action),
    label: action.name,
    position: { x: 300 + (conditionNodes.length + index) * 220, y: 160 },
    config: { action }
  }));
  const end: WorkflowNode = {
    id: "end",
    type: "end",
    label: "End",
    position: { x: 300 + (conditionNodes.length + actionNodes.length) * 220, y: 160 },
    config: {}
  };
  const nodes = [start, ...conditionNodes, ...actionNodes, end];
  const edges: WorkflowEdge[] = [];
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const source = nodes[index];
    const target = nodes[index + 1];
    const sourceHandle = source.type === "if" || source.type === "loop" ? "true" : source.type === "switch" ? "default" : "main";
    edges.push({ id: `edge:${source.id}:${sourceHandle}:${target.id}`, sourceNodeId: source.id, sourceHandle, targetNodeId: target.id });
    if (source.type === "if") {
      edges.push({ id: `edge:${source.id}:false:end`, sourceNodeId: source.id, sourceHandle: "false", targetNodeId: "end" });
    }
    if (source.type === "loop") {
      edges.push({ id: `edge:${source.id}:break:end`, sourceNodeId: source.id, sourceHandle: "break", targetNodeId: "end" });
    }
  }
  return { scope, nodes, edges };
}

export function graphToLegacyWorkflow(graph: WorkflowGraph): Pick<WorkflowDefinition, "trigger" | "conditions" | "actions"> {
  const start = graph.nodes.find((node) => node.type === "start");
  const trigger = normalizeTriggerFromStart(start, graph.scope);
  const conditions: WorkflowCondition[] = graph.nodes
    .filter((node) => node.type === "if" || node.type === "switch" || node.type === "loop")
    .map((node) => workflowNodeToCondition(node));
  const actions: WorkflowAction[] = graph.nodes
    .filter((node) => node.type === "send_email" || node.type === "create_task" || node.type === "update_deal" || node.type === "notify")
    .map((node) => workflowNodeToAction(node));
  return { trigger, conditions, actions };
}

export function workflowNodeToCondition(node: WorkflowNode): WorkflowCondition {
  const configured = isRecord(node.config.condition) ? node.config.condition : {};
  return {
    key: getString(configured.key) || node.id,
    type: node.type === "switch" ? "switch" : node.type === "loop" ? "loop" : "if",
    field: getString(node.config.field) || getString(configured.field) || "recordId",
    operator: isWorkflowOperator(node.config.operator) ? node.config.operator : isWorkflowOperator(configured.operator) ? configured.operator : "equals",
    value: node.config.value ?? configured.value,
    prompt: getString(node.config.prompt) || getString(configured.prompt) || undefined,
    config: { ...(isRecord(configured.config) ? configured.config : {}), ...node.config }
  };
}

export function workflowNodeToAction(node: WorkflowNode): WorkflowAction {
  const fallbackName = defaultWorkflowActionName(node.type);
  if (isRecord(node.config.action)) {
    const configured = node.config.action as unknown as WorkflowAction;
    const { action: _action, ...directConfig } = node.config;
    const actionName = getString(node.label) || getString(configured.name) || fallbackName;
    const configuredConfig = isRecord(configured.config) ? configured.config : {};
    const nextConfig = {
      ...configuredConfig,
      ...directConfig
    };
    if ((configured.type === "create_activity" || node.type === "create_task") && !getString(nextConfig.title)) {
      nextConfig.title = actionName;
    }
    return {
      ...configured,
      name: actionName,
      requiresApproval: typeof directConfig.requiresApproval === "boolean" ? directConfig.requiresApproval : configured.requiresApproval,
      config: nextConfig
    };
  }
  const type =
    node.type === "send_email" ? "send_email" :
    node.type === "update_deal" ? "update_stage" :
    node.type === "notify" ? "notify" :
    "create_activity";
  return {
    key: node.id,
    type,
    name: getString(node.label) || fallbackName,
    requiresApproval: type === "send_email" || type === "update_stage" ? true : undefined,
    config: node.config
  };
}

function defaultWorkflowActionName(type: WorkflowNode["type"]): string {
  if (type === "send_email") return "Send Email";
  if (type === "update_deal") return "Update Deal";
  if (type === "notify") return "Notify";
  return "Create Task";
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
    graph: buildDefaultWorkflowGraph(scopedTrigger, conditions, actions, {
      mode: input.recordId ? "record" : targetObjectKey ? "object" : "global",
      objectKey: targetObjectKey,
      recordId: input.recordId,
      recordTitle
    }),
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

export function buildDefaultWorkflowGraph(trigger: WorkflowDefinition["trigger"], conditions: WorkflowCondition[], actions: WorkflowAction[], scope?: WorkflowGraph["scope"]): WorkflowGraph {
  const graph = legacyWorkflowToGraph({ trigger: { ...trigger, config: { ...(trigger.config ?? {}), ...(scope ?? {}) } }, conditions, actions });
  return scope ? { ...graph, scope } : graph;
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

function normalizeWorkflowNode(value: Record<string, unknown>): WorkflowNode | undefined {
  const type = value.type;
  if (!isWorkflowNodeType(type)) return undefined;
  const id = getString(value.id);
  if (!id) return undefined;
  const position = isRecord(value.position) ? value.position : {};
  return {
    id,
    type,
    label: getString(value.label) || id,
    position: {
      x: typeof position.x === "number" ? position.x : 0,
      y: typeof position.y === "number" ? position.y : 0
    },
    config: isRecord(value.config) ? value.config : {}
  };
}

function normalizeWorkflowEdge(value: Record<string, unknown>): WorkflowEdge | undefined {
  const id = getString(value.id);
  const sourceNodeId = getString(value.sourceNodeId);
  const sourceHandle = getString(value.sourceHandle);
  const targetNodeId = getString(value.targetNodeId);
  if (!id || !sourceNodeId || !sourceHandle || !targetNodeId) return undefined;
  return { id, sourceNodeId, sourceHandle, targetNodeId };
}

function normalizeWorkflowScope(value: unknown, trigger: WorkflowDefinition["trigger"]): WorkflowGraph["scope"] {
  const source = isRecord(value) ? value : {};
  const recordId = getString(source.recordId) || getString(source.targetRecordId);
  const objectKey = getString(source.objectKey) || getString(source.targetObjectKey) || trigger.objectKey;
  const recordTitle = getString(source.recordTitle) || getString(source.targetRecordTitle) || undefined;
  if (recordId) return { mode: "record", objectKey, recordId, recordTitle };
  if (objectKey) return { mode: "object", objectKey };
  return { mode: "global" };
}

function normalizeTriggerFromStart(start: WorkflowNode | undefined, scope: WorkflowGraph["scope"]): WorkflowDefinition["trigger"] {
  const configuredTrigger = isRecord(start?.config.trigger) ? start?.config.trigger : undefined;
  if (configuredTrigger) {
    return {
      type: configuredTrigger.type === "email_event" || configuredTrigger.type === "task_event" || configuredTrigger.type === "schedule" || configuredTrigger.type === "manual" ? configuredTrigger.type : "crm_event",
      event: getString(configuredTrigger.event) || (scope.mode === "global" ? "manual.run" : "record.updated"),
      objectKey: getString(configuredTrigger.objectKey) || scope.objectKey,
      config: { ...(isRecord(configuredTrigger.config) ? configuredTrigger.config : {}), ...scope },
      schedule: isRecord(configuredTrigger.schedule) ? configuredTrigger.schedule as WorkflowDefinition["trigger"]["schedule"] : undefined
    };
  }
  return {
    type: scope.mode === "global" ? "manual" : "crm_event",
    event: scope.mode === "global" ? "manual.run" : "record.updated",
    objectKey: scope.objectKey,
    config: { ...scope }
  };
}

function workflowActionToNodeType(action: WorkflowAction): WorkflowNode["type"] {
  if (action.type === "send_email") return "send_email";
  if (action.type === "update_stage" || action.type === "update_record") return "update_deal";
  if (action.type === "notify") return "notify";
  return "create_task";
}

function isWorkflowNodeType(value: unknown): value is WorkflowNode["type"] {
  return value === "start" || value === "if" || value === "switch" || value === "loop" || value === "send_email" || value === "create_task" || value === "update_deal" || value === "notify" || value === "end";
}

function isWorkflowOperator(value: unknown): value is WorkflowCondition["operator"] {
  return value === "equals" || value === "not_equals" || value === "contains" || value === "not_contains" || value === "gt" || value === "gte" || value === "lt" || value === "lte" || value === "exists" || value === "not_exists";
}

function conditionLabel(condition: WorkflowCondition): string {
  if (condition.type === "switch") return "Switch";
  if (condition.type === "loop") return "Loop";
  if (condition.type === "ai") return "AI Condition";
  return "IF";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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
