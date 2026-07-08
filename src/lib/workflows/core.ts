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
  if (action.type === "run_ai_agent") return action.requiresApproval ?? action.config.autoExecuteTools === true;
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
    .filter((node) => node.type === "if" || node.type === "switch" || node.type === "loop" || node.type === "wait_reply")
    .map((node) => workflowNodeToCondition(node));
  const actions: WorkflowAction[] = graph.nodes
    .filter((node) => node.type === "ai_agent" || node.type === "send_email" || node.type === "create_email_draft" || node.type === "create_task" || node.type === "update_deal" || node.type === "notify")
    .map((node) => workflowNodeToAction(node));
  return { trigger, conditions, actions };
}

export function workflowNodeToCondition(node: WorkflowNode): WorkflowCondition {
  const configured = isRecord(node.config.condition) ? node.config.condition : {};
  const configuredType = isWorkflowConditionType(configured.type) ? configured.type : undefined;
  const isDateMatchNode = node.config.dateMatch === true || node.config.dateMatchMode === "annual";
  return {
    key: getString(configured.key) || node.id,
    type: node.type === "switch" ? "switch" : node.type === "loop" ? "loop" : node.type === "wait_reply" ? "email_behavior" : configuredType ?? "if",
    field: isDateMatchNode ? "dateMatch" : getString(node.config.field) || getString(configured.field) || (node.type === "wait_reply" ? "reply" : "recordId"),
    operator: isWorkflowOperator(node.config.operator) ? node.config.operator : isWorkflowOperator(configured.operator) ? configured.operator : "equals",
    value: isDateMatchNode ? true : node.type === "wait_reply" ? true : node.config.value ?? configured.value,
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
    node.type === "ai_agent" ? "run_ai_agent" :
    node.type === "send_email" || node.type === "create_email_draft" ? "send_email" :
    node.type === "update_deal" ? "update_stage" :
    node.type === "notify" ? "notify" :
    "create_activity";
  const config = node.type === "create_email_draft" ? { ...node.config, mode: "draft" } : node.config;
  return {
    key: node.id,
    type,
    name: getString(node.label) || fallbackName,
    requiresApproval: node.type === "create_email_draft" ? false : type === "send_email" || type === "update_stage" ? true : node.type === "ai_agent" ? Boolean(config.autoExecuteTools) : undefined,
    config
  };
}

function defaultWorkflowActionName(type: WorkflowNode["type"]): string {
  if (type === "ai_agent") return "AI Agent";
  if (type === "send_email") return "Send Email";
  if (type === "create_email_draft") return "Create Email Draft";
  if (type === "update_deal") return "Update Deal";
  if (type === "notify") return "Notify";
  return "Create Task";
}

export function buildWorkflowDraftFromGoal(input: WorkflowAiGenerationRequest): WorkflowAiGenerationResult {
  const goal = input.goal.trim();
  const lowerGoal = goal.toLowerCase();
  const recordTitle = input.recordTitle?.trim();
  return buildWorkflowDraftFromGoalV2(input, goal, recordTitle);
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

type WorkflowGenerationIntent = "cold_outreach_until_reply" | "birthday_greeting" | "no_reply_follow_up" | "email_intent" | "deal_close" | "dormant_reactivation" | "generic_follow_up";

function buildWorkflowDraftFromGoalV2(input: WorkflowAiGenerationRequest, goal: string, recordTitle?: string): WorkflowAiGenerationResult {
  const targetObjectKey = input.objectKey ?? inferGeneratedWorkflowObjectKey(goal);
  const delayDays = inferGeneratedWorkflowDelayDays(goal);
  const intent = inferGeneratedWorkflowIntent(goal, targetObjectKey);
  const trigger = buildGeneratedWorkflowTrigger(intent, targetObjectKey);
  const scope: WorkflowGraph["scope"] = {
    mode: input.recordId ? "record" : targetObjectKey ? "object" : "global",
    objectKey: targetObjectKey,
    recordId: input.recordId,
    recordTitle
  };
  const scopedTrigger = {
    ...trigger,
    config: {
      ...(trigger.config ?? {}),
      targetObjectKey,
      ...(input.recordId ? { targetRecordId: input.recordId, targetRecordTitle: recordTitle } : {})
    }
  };
  const graph = buildGeneratedWorkflowGraph({ goal, intent, trigger: scopedTrigger, scope, delayDays, recordTitle });
  const legacy = graphToLegacyWorkflow(graph);
  return {
    workflow: {
      name: recordTitle ? `${recordTitle} - ${goal.slice(0, 60)}` : goal.slice(0, 80) || "AI generated workflow",
      description: recordTitle ? `Workflow Designer Agent generated a record-scoped draft for ${recordTitle}. Review before enabling.` : "Workflow Designer Agent generated a draft. Review before enabling.",
      goal,
      status: "draft",
      trigger: legacy.trigger,
      conditions: legacy.conditions,
      actions: legacy.actions,
      graph,
      version: 1
    },
    explanation: {
      goal,
      triggerReason: describeGeneratedWorkflowTrigger(intent, scope, delayDays),
      expectedOutcome: describeGeneratedWorkflowOutcome(intent, delayDays),
      risks: describeGeneratedWorkflowRisks(intent)
    }
  };
}

function inferGeneratedWorkflowObjectKey(goal: string): string {
  const lowerGoal = goal.toLowerCase();
  if (lowerGoal.includes("deal") || lowerGoal.includes("close") || goal.includes("交易") || goal.includes("成交") || goal.includes("赢单")) return "deals";
  if (lowerGoal.includes("company") || goal.includes("公司")) return "companies";
  return "contacts";
}

function inferGeneratedWorkflowIntent(goal: string, objectKey: string): WorkflowGenerationIntent {
  const lowerGoal = goal.toLowerCase();
  const coldOutreach = /cold|outreach/.test(lowerGoal) || /冷邮件|冷启动|开发信|陌生|初次联系/.test(goal);
  const untilReply = /until.*(reply|respond|response)/.test(lowerGoal) || /直到.*(回复|回信|回应)|直到客户回复|回复为止/.test(goal);
  if (coldOutreach && untilReply) return "cold_outreach_until_reply";
  if (/birthday|birth day|anniversary/.test(lowerGoal) || /生日|纪念日|祝福/.test(goal)) return "birthday_greeting";
  const noReply = lowerGoal.includes("no reply") || lowerGoal.includes("not replied") || lowerGoal.includes("unreplied") || untilReply || goal.includes("未回复") || goal.includes("没回复") || goal.includes("未回");
  if (noReply) return "no_reply_follow_up";
  if (lowerGoal.includes("email") || goal.includes("邮件") || goal.includes("回信") || goal.includes("回复")) return "email_intent";
  if (objectKey === "deals" || lowerGoal.includes("close") || goal.includes("成交") || goal.includes("赢单") || goal.includes("推进")) return "deal_close";
  if (lowerGoal.includes("dormant") || lowerGoal.includes("inactive") || goal.includes("沉睡") || goal.includes("长期未跟进") || goal.includes("未跟进")) return "dormant_reactivation";
  return "generic_follow_up";
}

function inferGeneratedWorkflowDelayDays(goal: string): number {
  const match = goal.match(/(\d+)\s*(day|days|天|日)/i);
  if (!match) return 7;
  const days = Number(match[1]);
  return Number.isFinite(days) && days > 0 ? Math.min(days, 90) : 7;
}

function buildGeneratedWorkflowTrigger(intent: WorkflowGenerationIntent, objectKey: string): WorkflowDefinition["trigger"] {
  if (intent === "cold_outreach_until_reply") return { type: "crm_event", event: "record.created", objectKey };
  if (intent === "birthday_greeting") return { type: "schedule", event: "schedule.daily", objectKey: "contacts", config: { objectKey: "contacts", dateField: "birthday", dateMatchMode: "annual" }, schedule: { mode: "daily", dailyAt: "09:00" } };
  if (intent === "no_reply_follow_up") return { type: "email_event", event: "email.message.sent" };
  if (intent === "email_intent") return { type: "email_event", event: "email.message.received" };
  if (intent === "dormant_reactivation") return { type: "schedule", event: "schedule.daily", schedule: { mode: "daily", dailyAt: "09:00" } };
  return { type: "crm_event", event: "record.updated", objectKey };
}

function buildGeneratedWorkflowGraph(input: {
  goal: string;
  intent: WorkflowGenerationIntent;
  trigger: WorkflowDefinition["trigger"];
  scope: WorkflowGraph["scope"];
  delayDays: number;
  recordTitle?: string;
}): WorkflowGraph {
  if (input.intent === "cold_outreach_until_reply") return buildGeneratedColdOutreachUntilReplyGraph(input);
  if (input.intent === "birthday_greeting") return buildGeneratedBirthdayGreetingGraph(input);
  if (input.intent === "no_reply_follow_up") return buildGeneratedNoReplyGraph(input);
  if (input.intent === "email_intent") return buildGeneratedEmailIntentGraph(input);
  if (input.intent === "deal_close") return buildGeneratedDealCloseGraph(input);
  if (input.intent === "dormant_reactivation") return buildGeneratedDormantGraph(input);
  return buildGeneratedGenericGraph(input);
}

function generatedStartNode(trigger: WorkflowDefinition["trigger"], scope: WorkflowGraph["scope"], recordTitle?: string): WorkflowNode {
  return {
    id: "start",
    type: "start",
    label: scope.mode === "record" ? `Start: ${recordTitle || scope.recordTitle || "selected record"}` : "Start",
    position: { x: 40, y: 160 },
    config: { trigger }
  };
}

function generatedScopeNode(scope: WorkflowGraph["scope"], position: WorkflowNode["position"]): WorkflowNode | null {
  if (scope.mode !== "record" || !scope.recordId) return null;
  return {
    id: "scope-record",
    type: "if",
    label: "IF Selected Record",
    position,
    config: {
      condition: {
        key: "target-record",
        type: "if",
        field: "recordId",
        operator: "equals",
        value: scope.recordId,
        config: { targetRecordTitle: scope.recordTitle }
      }
    }
  };
}

function generatedTaskConfig(goal: string, dueInDays: number, priority: "normal" | "high"): Record<string, unknown> {
  return {
    activityType: "task",
    title: priority === "high" ? "High priority follow-up" : "Follow up customer",
    body: goal,
    dueInDays,
    assigneeMode: "record_owner",
    priority,
    preventDuplicate: true
  };
}

function generatedEmailBody(goal: string): string {
  const normalizedGoal = goal.toLowerCase();
  const isColdOutreach = /cold|冷|开发|陌生|初次/.test(normalizedGoal);
  const isNoReplyFollowUp = /no reply|未回复|没有回复|follow.?up|跟进/.test(normalizedGoal);
  const isQuoteFollowUp = /quote|proposal|报价|方案/.test(normalizedGoal);

  if (isColdOutreach) {
    return [
      "您好 {{record.title}}，",
      "",
      "想和您简要沟通一下贵司近期是否有相关采购、合作或业务增长需求。我们可以根据您的实际场景补充产品资料、报价方案或落地建议。",
      "",
      "如果方便，请回复您当前最关注的问题或合适的沟通时间，我会据此准备下一步资料。"
    ].join("\n");
  }

  if (isQuoteFollowUp) {
    return [
      "您好 {{record.title}}，",
      "",
      "想跟进一下之前发送的报价或方案。请问您这边是否已经有初步反馈，或者还需要我补充产品参数、交付周期、付款条款等信息？",
      "",
      "如果您方便，我可以根据目前的评估进展整理一版更贴近需求的下一步建议。"
    ].join("\n");
  }

  if (isNoReplyFollowUp) {
    return [
      "您好 {{record.title}}，",
      "",
      "想跟进一下之前沟通的事项。请问您这边是否仍在评估，或者目前是否有需要我们配合补充的信息？",
      "",
      "如果优先级有变化也没有关系，您可以简单回复当前状态，我会据此安排后续跟进。"
    ].join("\n");
  }

  return [
    "您好 {{record.title}}，",
    "",
    "想跟进一下我们之前沟通的事项，并确认您当前最需要推进的下一步。若您有新的问题或决策信息，也可以直接回复我。",
    "",
    "我会根据您的反馈整理后续资料或安排下一次沟通。"
  ].join("\n");
}

function generatedEmailAiInstructions(goal: string): string {
  return [
    `Workflow goal: ${goal}`,
    "Before sending, refine the draft with CRM context, recent communication, activity timeline, and knowledge base.",
    "Do not include a signature, source footer, or internal reasoning in the final email body."
  ].join("\n");
}

function generatedEmailDraftConfig(goal: string): Record<string, unknown> {
  return {
    mode: "draft",
    to: ["{{record.data.email}}"],
    subject: "Follow up {{record.title}}",
    bodyText: generatedEmailBody(goal),
    aiInstructions: generatedEmailAiInstructions(goal),
    aiAssisted: true
  };
}

function generatedEdge(sourceNodeId: string, sourceHandle: string, targetNodeId: string): WorkflowEdge {
  return {
    id: `edge:${sourceNodeId}:${sourceHandle}:${targetNodeId}`,
    sourceNodeId,
    sourceHandle,
    targetNodeId
  };
}

function compactNodes(nodes: Array<WorkflowNode | null>): WorkflowNode[] {
  return nodes.filter((node): node is WorkflowNode => Boolean(node));
}

function generatedFirstNodeAfterStart(scope: WorkflowGraph["scope"], fallbackNodeId: string): string {
  return scope.mode === "record" ? "scope-record" : fallbackNodeId;
}

function generatedScopeEdges(scope: WorkflowGraph["scope"], targetNodeId: string): WorkflowEdge[] {
  return scope.mode === "record" ? [generatedEdge("scope-record", "true", targetNodeId), generatedEdge("scope-record", "false", "end")] : [];
}

function buildGeneratedBirthdayGreetingGraph(input: { goal: string; trigger: WorkflowDefinition["trigger"]; scope: WorkflowGraph["scope"]; recordTitle?: string }): WorkflowGraph {
  const scope: WorkflowGraph["scope"] = {
    ...input.scope,
    mode: input.scope.mode === "record" ? "record" : "object",
    objectKey: "contacts"
  };
  const startTrigger: WorkflowDefinition["trigger"] = {
    ...input.trigger,
    objectKey: "contacts",
    config: { ...(input.trigger.config ?? {}), objectKey: "contacts", dateField: "birthday", dateMatchMode: "annual" }
  };
  const nodes = compactNodes([
    generatedStartNode(startTrigger, scope, input.recordTitle),
    generatedScopeNode(scope, { x: 300, y: 160 }),
    {
      id: "match-birthday",
      type: "if",
      label: "IF Birthday Today",
      position: { x: 560, y: 160 },
      config: { field: "birthday", dateMatch: true, dateMatchMode: "annual", condition: { key: "birthday-today", type: "field", field: "dateMatch", operator: "equals", value: true } }
    },
    {
      id: "draft-birthday-email",
      type: "create_email_draft",
      label: "Draft Birthday Greeting",
      position: { x: 820, y: 80 },
      config: {
        ...generatedEmailDraftConfig(input.goal),
        subject: "Birthday greetings",
        bodyText: [
          "Hi {{record.title}},",
          "",
          "Happy birthday. Wishing you a smooth year ahead and continued success.",
          "",
          "I hope today is a good chance to pause and celebrate."
        ].join("\n"),
        messageGoal: "Send a warm birthday greeting without a sales pitch."
      }
    },
    { id: "create-birthday-task", type: "create_task", label: "Create Birthday Follow-up Task", position: { x: 1080, y: 80 }, config: { ...generatedTaskConfig("Review and send the birthday greeting draft.", 0, "normal"), title: "Review birthday greeting draft" } },
    { id: "end", type: "end", label: "End", position: { x: 1340, y: 160 }, config: {} }
  ]);
  return {
    scope,
    nodes,
    edges: [
      generatedEdge("start", "main", generatedFirstNodeAfterStart(scope, "match-birthday")),
      ...generatedScopeEdges(scope, "match-birthday"),
      generatedEdge("match-birthday", "true", "draft-birthday-email"),
      generatedEdge("match-birthday", "false", "end"),
      generatedEdge("draft-birthday-email", "main", "create-birthday-task"),
      generatedEdge("create-birthday-task", "main", "end")
    ]
  };
}

function buildGeneratedNoReplyGraph(input: { goal: string; trigger: WorkflowDefinition["trigger"]; scope: WorkflowGraph["scope"]; delayDays: number; recordTitle?: string }): WorkflowGraph {
  const nodes = compactNodes([
    generatedStartNode(input.trigger, input.scope, input.recordTitle),
    generatedScopeNode(input.scope, { x: 300, y: 160 }),
    { id: "wait-delay", type: "wait_delay", label: `Wait ${input.delayDays} days`, position: { x: 560, y: 160 }, config: { delayAmount: input.delayDays, delayUnit: "days" } },
    { id: "wait-reply", type: "wait_reply", label: "Wait for Reply", position: { x: 820, y: 160 }, config: { lookbackDays: input.delayDays, replySource: "email" } },
    { id: "draft-follow-up-email", type: "create_email_draft", label: "Draft Follow-up Email", position: { x: 1080, y: 60 }, config: generatedEmailDraftConfig(input.goal) },
    { id: "create-follow-up-task", type: "create_task", label: "Create Follow-up Task", position: { x: 1080, y: 260 }, config: generatedTaskConfig(input.goal, 1, "high") },
    { id: "end", type: "end", label: "End", position: { x: 1360, y: 160 }, config: {} }
  ]);
  return {
    scope: input.scope,
    nodes,
    edges: [
      generatedEdge("start", "main", generatedFirstNodeAfterStart(input.scope, "wait-delay")),
      ...generatedScopeEdges(input.scope, "wait-delay"),
      generatedEdge("wait-delay", "after_delay", "wait-reply"),
      generatedEdge("wait-reply", "replied", "end"),
      generatedEdge("wait-reply", "not_replied", "draft-follow-up-email"),
      generatedEdge("draft-follow-up-email", "main", "create-follow-up-task"),
      generatedEdge("create-follow-up-task", "main", "end")
    ]
  };
}

function buildGeneratedColdOutreachUntilReplyGraph(input: { goal: string; trigger: WorkflowDefinition["trigger"]; scope: WorkflowGraph["scope"]; delayDays: number; recordTitle?: string }): WorkflowGraph {
  const firstDelay = Math.max(2, Math.min(input.delayDays, 7));
  const secondDelay = Math.max(firstDelay + 2, Math.min(input.delayDays + 3, 14));
  const nodes = compactNodes([
    generatedStartNode(input.trigger, input.scope, input.recordTitle),
    generatedScopeNode(input.scope, { x: 300, y: 220 }),
    { id: "draft-cold-email", type: "create_email_draft", label: "Draft Cold Email", position: { x: 560, y: 120 }, config: { ...generatedEmailDraftConfig(input.goal), subject: "Quick question for {{record.title}}" } },
    { id: "wait-first-delay", type: "wait_delay", label: `Wait ${firstDelay} days`, position: { x: 820, y: 220 }, config: { delayAmount: firstDelay, delayUnit: "days" } },
    { id: "wait-first-reply", type: "wait_reply", label: "Check Reply", position: { x: 1080, y: 220 }, config: { lookbackDays: firstDelay, replySource: "email" } },
    { id: "draft-follow-up-1", type: "create_email_draft", label: "Draft Follow-up 1", position: { x: 1340, y: 80 }, config: { ...generatedEmailDraftConfig(input.goal), subject: "Following up {{record.title}}" } },
    { id: "create-reply-task", type: "create_task", label: "Create Reply Handling Task", position: { x: 1340, y: 360 }, config: { ...generatedTaskConfig("客户已回复，检查邮件内容并安排下一步销售动作。", 0, "high"), title: "Handle customer reply" } },
    { id: "wait-second-delay", type: "wait_delay", label: `Wait ${secondDelay} days`, position: { x: 1600, y: 220 }, config: { delayAmount: secondDelay, delayUnit: "days" } },
    { id: "wait-second-reply", type: "wait_reply", label: "Check Reply Again", position: { x: 1860, y: 220 }, config: { lookbackDays: secondDelay, replySource: "email" } },
    { id: "draft-follow-up-2", type: "create_email_draft", label: "Draft Follow-up 2", position: { x: 2120, y: 80 }, config: { ...generatedEmailDraftConfig(input.goal), subject: "Last follow-up for {{record.title}}" } },
    { id: "create-review-task", type: "create_task", label: "Create Manual Review Task", position: { x: 2120, y: 360 }, config: { ...generatedTaskConfig("多轮冷邮件后仍未回复，请人工判断是否继续、换渠道或停止触达。", 1, "normal"), title: "Review cold outreach sequence" } },
    { id: "end", type: "end", label: "End", position: { x: 2380, y: 220 }, config: {} }
  ]);
  return {
    scope: input.scope,
    nodes,
    edges: [
      generatedEdge("start", "main", generatedFirstNodeAfterStart(input.scope, "draft-cold-email")),
      ...generatedScopeEdges(input.scope, "draft-cold-email"),
      generatedEdge("draft-cold-email", "main", "wait-first-delay"),
      generatedEdge("wait-first-delay", "after_delay", "wait-first-reply"),
      generatedEdge("wait-first-reply", "replied", "create-reply-task"),
      generatedEdge("wait-first-reply", "not_replied", "draft-follow-up-1"),
      generatedEdge("draft-follow-up-1", "main", "wait-second-delay"),
      generatedEdge("wait-second-delay", "after_delay", "wait-second-reply"),
      generatedEdge("wait-second-reply", "replied", "create-reply-task"),
      generatedEdge("wait-second-reply", "not_replied", "draft-follow-up-2"),
      generatedEdge("draft-follow-up-2", "main", "create-review-task"),
      generatedEdge("create-reply-task", "main", "end"),
      generatedEdge("create-review-task", "main", "end")
    ]
  };
}

function buildGeneratedEmailIntentGraph(input: { goal: string; trigger: WorkflowDefinition["trigger"]; scope: WorkflowGraph["scope"]; recordTitle?: string }): WorkflowGraph {
  const nodes = compactNodes([
    generatedStartNode(input.trigger, input.scope, input.recordTitle),
    generatedScopeNode(input.scope, { x: 300, y: 160 }),
    { id: "ai-high-intent", type: "if", label: "IF High Intent", position: { x: 560, y: 160 }, config: { condition: { key: "ai-high-intent", type: "ai", prompt: "Judge whether the email shows buying intent, urgency, pricing interest, quote intent, demo request, or close risk.", operator: "equals", value: true } } },
    { id: "create-sales-task", type: "create_task", label: "Create Sales Task", position: { x: 820, y: 60 }, config: generatedTaskConfig(input.goal, 1, "high") },
    { id: "draft-reply-email", type: "create_email_draft", label: "Draft Reply Email", position: { x: 1080, y: 60 }, config: generatedEmailDraftConfig(input.goal) },
    { id: "end", type: "end", label: "End", position: { x: 1360, y: 160 }, config: {} }
  ]);
  return {
    scope: input.scope,
    nodes,
    edges: [
      generatedEdge("start", "main", generatedFirstNodeAfterStart(input.scope, "ai-high-intent")),
      ...generatedScopeEdges(input.scope, "ai-high-intent"),
      generatedEdge("ai-high-intent", "true", "create-sales-task"),
      generatedEdge("ai-high-intent", "false", "end"),
      generatedEdge("create-sales-task", "main", "draft-reply-email"),
      generatedEdge("draft-reply-email", "main", "end")
    ]
  };
}

function buildGeneratedDealCloseGraph(input: { goal: string; trigger: WorkflowDefinition["trigger"]; scope: WorkflowGraph["scope"]; recordTitle?: string }): WorkflowGraph {
  const nodes = compactNodes([
    generatedStartNode(input.trigger, input.scope, input.recordTitle),
    generatedScopeNode(input.scope, { x: 300, y: 160 }),
    { id: "if-deal-stage", type: "if", label: "IF Deal Has Stage", position: { x: 560, y: 160 }, config: { condition: { key: "deal-stage-exists", type: "field", field: "stageKey", operator: "exists", value: true } } },
    { id: "create-close-task", type: "create_task", label: "Create Close Task", position: { x: 820, y: 80 }, config: generatedTaskConfig(input.goal, 1, "high") },
    { id: "notify-owner", type: "notify", label: "Notify Owner", position: { x: 1080, y: 80 }, config: { title: "Deal close follow-up", content: input.goal, channel: "in_app" } },
    { id: "end", type: "end", label: "End", position: { x: 1340, y: 160 }, config: {} }
  ]);
  return {
    scope: input.scope,
    nodes,
    edges: [
      generatedEdge("start", "main", generatedFirstNodeAfterStart(input.scope, "if-deal-stage")),
      ...generatedScopeEdges(input.scope, "if-deal-stage"),
      generatedEdge("if-deal-stage", "true", "create-close-task"),
      generatedEdge("if-deal-stage", "false", "end"),
      generatedEdge("create-close-task", "main", "notify-owner"),
      generatedEdge("notify-owner", "main", "end")
    ]
  };
}

function buildGeneratedDormantGraph(input: { goal: string; trigger: WorkflowDefinition["trigger"]; scope: WorkflowGraph["scope"]; recordTitle?: string }): WorkflowGraph {
  const nodes = compactNodes([
    generatedStartNode(input.trigger, input.scope, input.recordTitle),
    generatedScopeNode(input.scope, { x: 300, y: 160 }),
    { id: "if-owner-exists", type: "if", label: "IF Has Owner", position: { x: 560, y: 160 }, config: { condition: { key: "owner-exists", type: "field", field: "ownerId", operator: "exists", value: true } } },
    { id: "draft-reactivation-email", type: "create_email_draft", label: "Draft Reactivation Email", position: { x: 820, y: 60 }, config: generatedEmailDraftConfig(input.goal) },
    { id: "create-reactivation-task", type: "create_task", label: "Create Reactivation Task", position: { x: 820, y: 260 }, config: generatedTaskConfig(input.goal, 2, "normal") },
    { id: "end", type: "end", label: "End", position: { x: 1100, y: 160 }, config: {} }
  ]);
  return {
    scope: input.scope,
    nodes,
    edges: [
      generatedEdge("start", "main", generatedFirstNodeAfterStart(input.scope, "if-owner-exists")),
      ...generatedScopeEdges(input.scope, "if-owner-exists"),
      generatedEdge("if-owner-exists", "true", "draft-reactivation-email"),
      generatedEdge("if-owner-exists", "false", "end"),
      generatedEdge("draft-reactivation-email", "main", "create-reactivation-task"),
      generatedEdge("create-reactivation-task", "main", "end")
    ]
  };
}

function buildGeneratedGenericGraph(input: { goal: string; trigger: WorkflowDefinition["trigger"]; scope: WorkflowGraph["scope"]; recordTitle?: string }): WorkflowGraph {
  const nodes = compactNodes([
    generatedStartNode(input.trigger, input.scope, input.recordTitle),
    generatedScopeNode(input.scope, { x: 300, y: 160 }),
    { id: "if-owner-exists", type: "if", label: "IF Has Owner", position: { x: 560, y: 160 }, config: { condition: { key: "owner-exists", type: "field", field: "ownerId", operator: "exists", value: true } } },
    { id: "create-follow-up-task", type: "create_task", label: "Create Follow-up Task", position: { x: 820, y: 120 }, config: generatedTaskConfig(input.goal, 2, "normal") },
    { id: "end", type: "end", label: "End", position: { x: 1080, y: 160 }, config: {} }
  ]);
  return {
    scope: input.scope,
    nodes,
    edges: [
      generatedEdge("start", "main", generatedFirstNodeAfterStart(input.scope, "if-owner-exists")),
      ...generatedScopeEdges(input.scope, "if-owner-exists"),
      generatedEdge("if-owner-exists", "true", "create-follow-up-task"),
      generatedEdge("if-owner-exists", "false", "end"),
      generatedEdge("create-follow-up-task", "main", "end")
    ]
  };
}

function describeGeneratedWorkflowTrigger(intent: WorkflowGenerationIntent, scope: WorkflowGraph["scope"], delayDays: number): string {
  const scopeText = scope.mode === "record" ? `This workflow is scoped to only ${scope.recordTitle || "the selected record"}.` : scope.mode === "object" ? `This workflow applies to ${scope.objectKey}.` : "This workflow is global.";
  if (intent === "cold_outreach_until_reply") return `${scopeText} It starts from a new CRM record, drafts the first cold email, waits, checks replies, and continues staged follow-ups until a reply path is reached or manual review is needed.`;
  if (intent === "birthday_greeting") return `${scopeText} It runs daily, matches contacts whose birthday month/day is today, then creates a birthday greeting draft.`;
  if (intent === "no_reply_follow_up") return `${scopeText} It starts from sent email activity, waits ${delayDays} day(s), then checks whether a reply arrived before drafting follow-up.`;
  if (intent === "email_intent") return `${scopeText} It starts when an email is received and uses an AI condition to classify buying intent before creating actions.`;
  if (intent === "deal_close") return `${scopeText} It starts on deal updates and only continues when the deal has a stage, then creates close follow-up work.`;
  if (intent === "dormant_reactivation") return `${scopeText} It runs on a daily schedule to prepare reactivation follow-up work.`;
  return `${scopeText} It starts on CRM record updates and creates a guarded follow-up task.`;
}

function describeGeneratedWorkflowOutcome(intent: WorkflowGenerationIntent, delayDays: number): string {
  if (intent === "cold_outreach_until_reply") return "The workflow drafts an initial cold email, checks for replies after each wait, drafts staged follow-ups when there is no reply, and creates a handling task once the customer replies.";
  if (intent === "birthday_greeting") return "On matching birthdays, the workflow creates a warm email draft and a review task; it does not send automatically.";
  if (intent === "no_reply_follow_up") return `After ${delayDays} day(s), replied paths end quietly; not-replied paths create an AI-assisted email draft and a follow-up task.`;
  if (intent === "email_intent") return "High-intent inbound emails create a sales task and AI-assisted reply draft; low-intent paths stop.";
  if (intent === "deal_close") return "Qualified deal changes create a close task and notify the owner without automatically changing the deal stage.";
  if (intent === "dormant_reactivation") return "Dormant customer paths create a reactivation email draft and a task for the owner.";
  return "The workflow creates one deduplicated follow-up task for the record owner.";
}

function describeGeneratedWorkflowRisks(intent: WorkflowGenerationIntent): string[] {
  const common = "Generated workflow is saved as draft and must be reviewed before enabling.";
  if (intent === "cold_outreach_until_reply") {
    return [common, "Cold outreach emails are generated as drafts for review, not sent automatically.", "The sequence uses bounded staged follow-ups instead of an infinite loop to avoid accidental repeated outreach."];
  }
  if (intent === "birthday_greeting" || intent === "no_reply_follow_up" || intent === "email_intent" || intent === "dormant_reactivation") {
    return [common, "Email-related nodes create drafts by default; they do not send directly.", "Wait nodes describe the intended timing path; production delayed resume depends on the background scheduler."];
  }
  if (intent === "deal_close") return [common, "The workflow creates tasks and notifications only; it does not automatically mark deals won or lost."];
  return [common, "The workflow avoids direct critical CRM field updates."];
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
  if (condition.type === "email_behavior") {
    return data.replied === true ||
      data.hasReply === true ||
      data.direction === "inbound" ||
      data.event === "email.message.received" ||
      data.triggerEvent === "email.message.received";
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
    const triggerType = configuredTrigger.type === "email_event" || configuredTrigger.type === "task_event" || configuredTrigger.type === "schedule" || configuredTrigger.type === "manual" ? configuredTrigger.type : "crm_event";
    return {
      type: triggerType,
      event: getString(configuredTrigger.event) || (scope.mode === "global" ? "manual.run" : "record.updated"),
      objectKey: getString(configuredTrigger.objectKey) || (triggerType === "email_event" ? undefined : scope.objectKey),
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
  if (action.type === "run_ai_agent") return "ai_agent";
  if (action.type === "send_email") return action.config.mode === "draft" ? "create_email_draft" : "send_email";
  if (action.type === "update_stage" || action.type === "update_record") return "update_deal";
  if (action.type === "notify") return "notify";
  return "create_task";
}

function isWorkflowNodeType(value: unknown): value is WorkflowNode["type"] {
  return value === "start" || value === "if" || value === "switch" || value === "loop" || value === "wait_delay" || value === "wait_reply" || value === "ai_agent" || value === "send_email" || value === "create_email_draft" || value === "create_task" || value === "update_deal" || value === "notify" || value === "end";
}

function isWorkflowOperator(value: unknown): value is WorkflowCondition["operator"] {
  return value === "equals" || value === "not_equals" || value === "contains" || value === "not_contains" || value === "gt" || value === "gte" || value === "lt" || value === "lte" || value === "exists" || value === "not_exists";
}

function isWorkflowConditionType(value: unknown): value is WorkflowCondition["type"] {
  return value === "field" || value === "activity" || value === "email_behavior" || value === "ai" || value === "if" || value === "switch" || value === "loop";
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
