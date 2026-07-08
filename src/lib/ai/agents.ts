import type { AiAgentDefinition, AiAgentKey, AiAgentSetting, EmailAiSettings } from "@/lib/crm/types";
import {
  emailClassificationAgentKey,
  emailContextAnalysisAgentKey,
  emailDraftAgentKey,
  emailThreadSummaryAgentKey,
  emailTranslationAgentKey,
  inboundEmailPreprocessAgentKey,
  normalizeAiAgentSettings,
  workflowDesignerAgentKey
} from "@/lib/email/assistant";

export const recordSummaryAgentKey = "record_summary";
export const nextActionSuggestionAgentKey = "next_action_suggestion";
export const aiQueryPlannerAgentKey = "ai_query_planner";
export const talkAboutThisAgentKey = "talk_about_this";
export const workflowAiAgentNodeKey = "workflow_ai_agent_node";
export const smartReminderPlannerAgentKey = "smart_reminder_planner";

const defaultModel = process.env.AI_MODEL || "gpt-4.1-mini";

export const aiAgentDefinitions: AiAgentDefinition[] = [
  {
    key: inboundEmailPreprocessAgentKey,
    name: "Inbound Email Preprocess Agent",
    scenario: "email",
    description: "Preprocess incoming email into compact CRM context.",
    defaultModel,
    defaultAgentMarkdown: [
      "# Inbound Email Preprocess Agent",
      "",
      "You preprocess newly received customer emails for a private sales CRM.",
      "Write internal summaries, signals, and recommendations in Simplified Chinese by default.",
      "Extract concise intent, risks, reply needs, and compact memory.",
      "Do not modify CRM data or mailbox state."
    ].join("\n"),
    outputSchema: "text",
    contextPolicy: { includeEmailThread: true, includeRecord: true, includeKnowledge: true, maxContextChars: 8000 },
    toolPolicy: { allowRead: true, allowWrite: false, allowedTools: [], highRiskRequiresApproval: true },
    maxOutputChars: 3000
  },
  {
    key: emailClassificationAgentKey,
    name: "Email Classification Agent",
    scenario: "email",
    description: "Classify email into primary, promotions, social, or updates.",
    defaultModel,
    defaultAgentMarkdown: [
      "# Email Classification Agent",
      "",
      "Classify incoming emails for a private sales CRM.",
      "When returning explanatory internal text, use Simplified Chinese by default.",
      "Return one category only: primary, promotions, social, or updates.",
      "Do not modify CRM data."
    ].join("\n"),
    outputSchema: "classification",
    contextPolicy: { includeEmailThread: true, includeRecord: true, includeKnowledge: true, maxContextChars: 5000 },
    toolPolicy: { allowRead: true, allowWrite: false, allowedTools: [], highRiskRequiresApproval: true },
    maxOutputChars: 1000
  },
  {
    key: emailDraftAgentKey,
    name: "Email Draft Agent",
    scenario: "email",
    description: "Draft customer-facing sales emails from CRM context.",
    defaultModel,
    defaultAgentMarkdown: [
      "# Email Draft Agent",
      "",
      "Draft sales emails using customer background, communication history, product catalog, and knowledge base facts.",
      "Use Simplified Chinese by default when no customer-facing language is requested.",
      "Treat the Product catalog context as authoritative for product names, SKU, pricing, descriptions, billing cycles, images, and attachments.",
      "Do not invent product names, features, prices, availability, or bundles when product context is absent or does not match.",
      "Return body content only unless a schema explicitly requests a subject.",
      "Do not include signatures, source footers, or sender placeholders."
    ].join("\n"),
    outputSchema: "email",
    contextPolicy: { includeEmailThread: true, includeRecord: true, includeActivities: true, includeKnowledge: true, includeProducts: true, maxContextChars: 12000 },
    toolPolicy: { allowRead: true, allowWrite: false, allowedTools: ["create_email_draft"], highRiskRequiresApproval: true },
    maxOutputChars: 4000
  },
  {
    key: emailTranslationAgentKey,
    name: "Email Translation Agent",
    scenario: "email",
    description: "Translate email content while preserving CRM facts.",
    defaultModel,
    defaultAgentMarkdown: [
      "# Email Translation Agent",
      "",
      "Translate email content while preserving names, numbers, dates, product names, URLs, and CRM facts.",
      "Use the requested target locale; for internal notes, use Simplified Chinese by default.",
      "Use context only to disambiguate meaning."
    ].join("\n"),
    outputSchema: "text",
    contextPolicy: { includeEmailThread: true, includeRecord: true, includeKnowledge: true, maxContextChars: 9000 },
    toolPolicy: { allowRead: true, allowWrite: false, allowedTools: [], highRiskRequiresApproval: true },
    maxOutputChars: 4000
  },
  {
    key: emailContextAnalysisAgentKey,
    name: "Email Context Analysis Agent",
    scenario: "email",
    description: "Analyze customer intent, risk, and next step from an email thread.",
    defaultModel,
    defaultAgentMarkdown: [
      "# Email Context Analysis Agent",
      "",
      "Analyze email context using customer background, communication history, and knowledge base facts.",
      "Write the analysis in Simplified Chinese by default.",
      "Return concise risks, intent, open questions, and next-step recommendations.",
      "Do not modify CRM data."
    ].join("\n"),
    outputSchema: "text",
    contextPolicy: { includeEmailThread: true, includeRecord: true, includeActivities: true, includeKnowledge: true, maxContextChars: 10000 },
    toolPolicy: { allowRead: true, allowWrite: false, allowedTools: ["create_task"], highRiskRequiresApproval: true },
    maxOutputChars: 4000
  },
  {
    key: emailThreadSummaryAgentKey,
    name: "Email Thread Summary Agent",
    scenario: "email",
    description: "Summarize email threads into compact memory.",
    defaultModel,
    defaultAgentMarkdown: [
      "# Email Thread Summary Agent",
      "",
      "Summarize email threads into compact CRM memory that reduces future prompt tokens.",
      "Write the compact memory in Simplified Chinese by default.",
      "Keep facts source-grounded and omit redundant greetings, signatures, and boilerplate."
    ].join("\n"),
    outputSchema: "text",
    contextPolicy: { includeEmailThread: true, includeRecord: true, includeKnowledge: true, maxContextChars: 10000 },
    toolPolicy: { allowRead: true, allowWrite: false, allowedTools: [], highRiskRequiresApproval: true },
    maxOutputChars: 4000
  },
  {
    key: recordSummaryAgentKey,
    name: "Record Summary Agent",
    scenario: "sales",
    description: "Summarize a CRM record and recent activity.",
    defaultModel,
    defaultAgentMarkdown: [
      "# Record Summary Agent",
      "",
      "Summarize the CRM record from supplied fields and activity timeline.",
      "Write summaries in Simplified Chinese by default.",
      "Do not invent facts and do not claim that data has been changed."
    ].join("\n"),
    outputSchema: "text",
    contextPolicy: { includeRecord: true, includeActivities: true, includeKnowledge: true, maxContextChars: 9000 },
    toolPolicy: { allowRead: true, allowWrite: false, allowedTools: [], highRiskRequiresApproval: true },
    maxOutputChars: 3000
  },
  {
    key: nextActionSuggestionAgentKey,
    name: "Next Action Suggestion Agent",
    scenario: "sales",
    description: "Suggest the next sales actions for a CRM record.",
    defaultModel,
    defaultAgentMarkdown: [
      "# Next Action Suggestion Agent",
      "",
      "Suggest one to three practical next sales actions based on CRM facts and recent activity.",
      "Write recommendations in Simplified Chinese by default.",
      "Do not modify deal stage, amount, owner, tasks, or contact data."
    ].join("\n"),
    outputSchema: "text",
    contextPolicy: { includeRecord: true, includeActivities: true, includeKnowledge: true, maxContextChars: 9000 },
    toolPolicy: { allowRead: true, allowWrite: false, allowedTools: ["create_task"], highRiskRequiresApproval: true },
    maxOutputChars: 3000
  },
  {
    key: aiQueryPlannerAgentKey,
    name: "AI Query Planner Agent",
    scenario: "sales",
    description: "Answer natural-language CRM questions from controlled query results.",
    defaultModel,
    defaultAgentMarkdown: [
      "# AI Query Planner Agent",
      "",
      "Answer read-only CRM questions using only supplied candidate records and field definitions.",
      "Write answers in Simplified Chinese by default.",
      "Do not output SQL and do not suggest write APIs."
    ].join("\n"),
    outputSchema: "query",
    contextPolicy: { includeRecord: true, maxContextChars: 12000 },
    toolPolicy: { allowRead: true, allowWrite: false, allowedTools: ["query_records"], highRiskRequiresApproval: true },
    maxOutputChars: 4000
  },
  {
    key: talkAboutThisAgentKey,
    name: "Talk About This Agent",
    scenario: "sales",
    description: "Discuss a CRM object or email thread with grounded context.",
    defaultModel,
    defaultAgentMarkdown: [
      "# Talk About This Agent",
      "",
      "Discuss the selected CRM record or email thread using supplied CRM context, product catalog, and knowledge snippets.",
      "Write internal discussion answers and smart suggestions in Simplified Chinese by default.",
      "When the user asks about products, plans, or quotes, use product catalog facts first and do not invent unavailable product details.",
      "Keep responses suitable for saving into RAG knowledge.",
      "Do not claim that CRM data was changed."
    ].join("\n"),
    outputSchema: "text",
    contextPolicy: { includeRecord: true, includeEmailThread: true, includeActivities: true, includeKnowledge: true, includeProducts: true, maxContextChars: 12000 },
    toolPolicy: { allowRead: true, allowWrite: false, allowedTools: ["save_to_rag"], highRiskRequiresApproval: true },
    maxOutputChars: 4000
  },
  {
    key: workflowDesignerAgentKey,
    name: "Workflow Designer Agent",
    scenario: "system",
    description: "Generate safe executable workflow graph drafts.",
    defaultModel,
    defaultAgentMarkdown: [
      "# Workflow Designer Agent",
      "",
      "Design safe graph workflow automation drafts for a private sales CRM.",
      "Write workflow summaries, explanations, and draft labels in Simplified Chinese by default.",
      "Return only supported workflow nodes and edges.",
      "Generated workflows must stay in draft until an administrator enables them."
    ].join("\n"),
    outputSchema: "workflow",
    contextPolicy: { includeRecord: true, includeKnowledge: true, maxContextChars: 14000 },
    toolPolicy: { allowRead: true, allowWrite: false, allowedTools: ["workflow_graph"], highRiskRequiresApproval: true },
    maxOutputChars: 6000
  },
  {
    key: workflowAiAgentNodeKey,
    name: "Workflow AI Agent Node",
    scenario: "system",
    description: "Plan a workflow step and select allowed tools inside a workflow run.",
    defaultModel,
    defaultAgentMarkdown: [
      "# Workflow AI Agent Node",
      "",
      "Reason inside a workflow run and choose only explicitly allowed tools.",
      "Write internal plans and recommendations in Simplified Chinese by default.",
      "When planning product-related messaging or actions, use product catalog facts and do not invent unavailable product details.",
      "Return a short plan and never execute high-risk actions without approval."
    ].join("\n"),
    outputSchema: "text",
    contextPolicy: { includeRecord: true, includeEmailThread: true, includeKnowledge: true, includeProducts: true, maxContextChars: 10000 },
    toolPolicy: { allowRead: true, allowWrite: false, allowedTools: [], highRiskRequiresApproval: true },
    maxOutputChars: 4000
  },
  {
    key: smartReminderPlannerAgentKey,
    name: "Smart Reminder Planner Agent",
    scenario: "sales",
    description: "Plan today-best actions and follow-up reminders from CRM context.",
    defaultModel,
    defaultAgentMarkdown: [
      "# Smart Reminder Planner Agent",
      "",
      "You plan personal sales operating actions for a private CRM. Your goal is to maximize overall sales output, not only to remind follow-ups.",
      "Write reminder title, body, actionLabel, and all internal explanations in Simplified Chinese by default.",
      "Use only supplied CRM context: portfolioMetrics, owned contacts, companies, deals, tasks, emails, activities, and knowledge snippets.",
      "Consider customer follow-up, customer-level distribution, data completeness, public/private pool health, high-value deals, overdue tasks, and recent email interaction.",
      "Return JSON only with this shape: {\"reminders\":[{\"kind\":\"today_best_action|follow_up|overdue|email_reply|deal_close|risk|portfolio_health|data_quality|customer_level|pipeline_optimization\",\"priority\":\"low|medium|high|urgent\",\"title\":\"简体中文标题\",\"body\":\"简体中文业务价值、原因和建议操作\",\"actionLabel\":\"简体中文动作标签\",\"objectKey\":\"contacts|companies|deals|tasks|emails|activities optional\",\"recordId\":\"optional; omit for portfolio-level actions\",\"dueAt\":\"ISO optional\",\"score\":0.0,\"sources\":[{\"label\":\"...\",\"objectKey\":\"...\",\"recordId\":\"...\"}]}]}.",
      "Portfolio-level reminders may omit recordId, but must include statistics or source records that explain the recommendation.",
      "Do not modify CRM data, do not send messages, do not change customer levels, do not release or transfer customers, and do not invent unavailable record IDs.",
      "Prefer concrete actions that can be completed today and explain the expected business benefit."
    ].join("\n"),
    outputSchema: "text",
    contextPolicy: { includeRecord: true, includeEmailThread: true, includeActivities: true, includeKnowledge: true, maxContextChars: 14000 },
    toolPolicy: { allowRead: true, allowWrite: false, allowedTools: ["create_task"], highRiskRequiresApproval: true },
    maxOutputChars: 6000
  }
];

export function listAiAgentDefinitions(): AiAgentDefinition[] {
  return aiAgentDefinitions.map((definition) => ({ ...definition, contextPolicy: { ...definition.contextPolicy }, toolPolicy: { ...definition.toolPolicy } }));
}

export function getAiAgentDefinition(key: string): AiAgentDefinition | undefined {
  return listAiAgentDefinitions().find((definition) => definition.key === key);
}

export function createDefaultGlobalAiAgentSettings(): AiAgentSetting[] {
  return listAiAgentDefinitions().map((definition) => ({
    key: definition.key,
    name: definition.name,
    scenario: definition.scenario,
    enabled: true,
    model: definition.defaultModel,
    agentMarkdown: definition.defaultAgentMarkdown,
    maxOutputChars: definition.maxOutputChars,
    contextPolicy: definition.contextPolicy,
    toolPolicy: definition.toolPolicy,
    outputSchema: definition.outputSchema
  }));
}

export function normalizeGlobalAiAgentSettings(agents: unknown): AiAgentSetting[] {
  const legacy = normalizeAiAgentSettings(agents);
  const byKey = new Map<string, AiAgentSetting>();
  for (const agent of createDefaultGlobalAiAgentSettings()) {
    byKey.set(agent.key, agent);
  }
  for (const agent of legacy) {
    byKey.set(agent.key, normalizeGlobalAiAgentSetting(agent, byKey.get(agent.key)));
  }
  if (Array.isArray(agents)) {
    for (const raw of agents) {
      if (!raw || typeof raw !== "object") continue;
      const normalized = normalizeGlobalAiAgentSetting(raw as Partial<AiAgentSetting>, byKey.get(String((raw as { key?: unknown }).key ?? "")));
      if (normalized.key) {
        byKey.set(normalized.key, normalized);
      }
    }
  }
  return Array.from(byKey.values());
}

export function getGlobalAiAgentSetting(settings: Pick<EmailAiSettings, "agents"> | undefined, key: string): AiAgentSetting | undefined {
  return normalizeGlobalAiAgentSettings(settings?.agents).find((agent) => agent.key === key);
}

export function normalizeGlobalAiAgentSetting(raw: Partial<AiAgentSetting>, fallback?: AiAgentSetting): AiAgentSetting {
  const key = normalizeAgentKey(raw.key) || fallback?.key || "";
  const definition = getAiAgentDefinition(key);
  return {
    key,
    name: normalizeText(raw.name, fallback?.name ?? definition?.name ?? key, 80),
    scenario: raw.scenario === "email" || raw.scenario === "sales" || raw.scenario === "system" ? raw.scenario : fallback?.scenario ?? definition?.scenario ?? "system",
    enabled: raw.enabled ?? fallback?.enabled ?? true,
    model: normalizeText(raw.model, fallback?.model ?? definition?.defaultModel ?? defaultModel, 120),
    agentMarkdown: normalizeText(raw.agentMarkdown, fallback?.agentMarkdown ?? definition?.defaultAgentMarkdown ?? "# Agent", 12000),
    maxOutputChars: normalizeNumber(raw.maxOutputChars, fallback?.maxOutputChars ?? definition?.maxOutputChars ?? 4000, 500, 12000),
    providerProfileKey: normalizeProviderProfileKey(raw.providerProfileKey) || fallback?.providerProfileKey,
    provider: raw.provider,
    baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl.trim().slice(0, 500) : fallback?.baseUrl,
    contextPolicy: normalizeContextPolicy(raw.contextPolicy, fallback?.contextPolicy ?? definition?.contextPolicy),
    toolPolicy: normalizeToolPolicy(raw.toolPolicy, fallback?.toolPolicy ?? definition?.toolPolicy),
    outputSchema: raw.outputSchema ?? fallback?.outputSchema ?? definition?.outputSchema ?? "text"
  };
}

function normalizeProviderProfileKey(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{1,60}$/.test(value.trim()) ? value.trim() : undefined;
}

function normalizeContextPolicy(value: unknown, fallback?: AiAgentSetting["contextPolicy"]): AiAgentSetting["contextPolicy"] {
  const input = value && typeof value === "object" ? (value as AiAgentSetting["contextPolicy"]) : {};
  return {
    includeRecord: input?.includeRecord ?? fallback?.includeRecord ?? false,
    includeActivities: input?.includeActivities ?? fallback?.includeActivities ?? false,
    includeEmailThread: input?.includeEmailThread ?? fallback?.includeEmailThread ?? false,
    includeKnowledge: input?.includeKnowledge ?? fallback?.includeKnowledge ?? false,
    includeProducts: input?.includeProducts ?? fallback?.includeProducts ?? false,
    maxContextChars: normalizeNumber(input?.maxContextChars, fallback?.maxContextChars ?? 8000, 1000, 30000),
    maxHistoryMessages: normalizeNumber(input?.maxHistoryMessages, fallback?.maxHistoryMessages ?? 8, 1, 50)
  };
}

function normalizeToolPolicy(value: unknown, fallback?: AiAgentSetting["toolPolicy"]): AiAgentSetting["toolPolicy"] {
  const input = value && typeof value === "object" ? (value as AiAgentSetting["toolPolicy"]) : {};
  return {
    allowRead: input?.allowRead ?? fallback?.allowRead ?? true,
    allowWrite: input?.allowWrite ?? fallback?.allowWrite ?? false,
    allowedTools: Array.isArray(input?.allowedTools) ? input.allowedTools.filter((tool): tool is string => typeof tool === "string").slice(0, 30) : fallback?.allowedTools ?? [],
    highRiskRequiresApproval: input?.highRiskRequiresApproval ?? fallback?.highRiskRequiresApproval ?? true
  };
}

function normalizeAgentKey(value: unknown): string {
  return typeof value === "string" && /^[a-z][a-z0-9_:-]{1,80}$/.test(value.trim()) ? value.trim() : "";
}

function normalizeText(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : fallback.slice(0, maxLength);
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
}
