import type {
  Activity,
  CrmRecord,
  EmailAiFeature,
  EmailAiSettings,
  EmailMessage,
  EmailThread,
  FieldDefinition,
  KnowledgeArticle
} from "@/lib/crm/types";

export type EmailAssistantPurpose = "draft" | "translate" | "context_analysis" | "summarize";

export interface EmailAssistantContextInput {
  settings: EmailAiSettings;
  purpose: EmailAssistantPurpose;
  record?: CrmRecord;
  fields?: FieldDefinition[];
  activities?: Activity[];
  thread?: EmailThread;
  messages?: EmailMessage[];
  knowledgeArticles?: KnowledgeArticle[];
  targetLocale?: string;
}

export interface EmailAssistantContext {
  enabled: boolean;
  purpose: EmailAssistantPurpose;
  enabledFeatures: Record<EmailAiFeature, boolean>;
  customerBrief: string;
  communicationSummary: string;
  knowledgeBrief: string;
  instruction: string;
  sources: Array<{ label: string; recordId?: string; activityId?: string; messageId?: string; knowledgeArticleId?: string }>;
}

const purposeFeature: Record<EmailAssistantPurpose, EmailAiFeature> = {
  draft: "draft",
  translate: "translate",
  context_analysis: "context_analysis",
  summarize: "auto_summarize"
};

export function buildEmailAssistantContext(input: EmailAssistantContextInput): EmailAssistantContext {
  const enabledFeatures = normalizeEmailAiFeatures(input.settings.features);
  const purpose = input.purpose;
  const enabled = enabledFeatures[purposeFeature[purpose]];
  const maxContextChars = normalizeLimit(input.settings.maxContextChars, 8000, 1000, 20000);
  const messages = [...(input.messages ?? [])]
    .sort((left, right) => messageTime(right).localeCompare(messageTime(left)))
    .slice(0, normalizeLimit(input.settings.maxHistoryMessages, 8, 1, 20));
  const activities = [...(input.activities ?? [])]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 8);
  const knowledgeArticles = (input.knowledgeArticles ?? [])
    .filter((article) => article.active)
    .slice(0, normalizeLimit(input.settings.maxKnowledgeArticles, 5, 0, 20));

  const customerBrief = truncate(buildCustomerBrief(input.record, input.fields ?? []), maxContextChars * 0.25);
  const communicationSummary = truncate(buildCommunicationSummary(input.thread, messages, activities), maxContextChars * 0.45);
  const knowledgeBrief = truncate(buildKnowledgeBrief(knowledgeArticles), maxContextChars * 0.25);

  return {
    enabled,
    purpose,
    enabledFeatures,
    customerBrief,
    communicationSummary,
    knowledgeBrief,
    instruction: buildInstruction(input, enabled),
    sources: [
      ...(input.record ? [{ label: input.record.title, recordId: input.record.id }] : []),
      ...activities.slice(0, 3).map((activity) => ({ label: activity.title, activityId: activity.id })),
      ...messages.slice(0, 5).map((message) => ({ label: message.subject, messageId: message.id })),
      ...knowledgeArticles.map((article) => ({ label: article.title, knowledgeArticleId: article.id }))
    ]
  };
}

export function normalizeEmailAiFeatures(features: Partial<Record<EmailAiFeature, boolean>> | undefined): Record<EmailAiFeature, boolean> {
  return {
    draft: features?.draft ?? false,
    translate: features?.translate ?? false,
    context_analysis: features?.context_analysis ?? false,
    auto_summarize: features?.auto_summarize ?? false
  };
}

export function createDefaultEmailAiSettings(workspaceId: string, now: string): EmailAiSettings {
  return {
    workspaceId,
    features: {
      draft: false,
      translate: false,
      context_analysis: false,
      auto_summarize: true
    },
    defaultLocale: "zh-CN",
    requireSourceLinks: true,
    maxHistoryMessages: 8,
    maxKnowledgeArticles: 5,
    maxContextChars: 8000,
    updatedAt: now
  };
}

function buildCustomerBrief(record: CrmRecord | undefined, fields: FieldDefinition[]): string {
  if (!record) {
    return "No linked CRM record.";
  }

  const fieldText = fields
    .map((field) => `${field.label || field.key}: ${formatValue(record.data[field.key])}`)
    .filter((line) => !line.endsWith(": "))
    .join("\n");

  return [`Record: ${record.title}`, `Object: ${record.objectKey}`, record.stageKey ? `Stage: ${record.stageKey}` : undefined, fieldText].filter(Boolean).join("\n");
}

function buildCommunicationSummary(thread: EmailThread | undefined, messages: EmailMessage[], activities: Activity[]): string {
  const threadSummary = thread?.summary ? `Existing thread summary: ${thread.summary}` : undefined;
  const messageSummary = messages
    .map((message) => `${message.direction} ${message.status} ${message.subject} from ${message.from} to ${message.to.join(", ")}: ${truncate(message.bodyText, 500)}`)
    .join("\n");
  const activitySummary = activities.map((activity) => `${activity.type}: ${activity.title}${activity.body ? ` - ${truncate(activity.body, 300)}` : ""}`).join("\n");

  return [threadSummary, messageSummary ? `Recent email history:\n${messageSummary}` : undefined, activitySummary ? `CRM activity history:\n${activitySummary}` : undefined]
    .filter(Boolean)
    .join("\n\n");
}

function buildKnowledgeBrief(articles: KnowledgeArticle[]): string {
  return articles.map((article) => `${article.title} [${article.tags.join(", ")}]\n${truncate(article.body, 700)}`).join("\n\n");
}

function buildInstruction(input: EmailAssistantContextInput, enabled: boolean): string {
  if (!enabled) {
    return `AI email feature "${input.purpose}" is disabled. Do not generate content for this action.`;
  }

  const locale = input.targetLocale ?? input.settings.defaultLocale;
  const sourceRequirement = input.settings.requireSourceLinks ? "Include source references to CRM records, email messages, activities, or knowledge articles." : "Source references are optional.";

  if (input.purpose === "draft") {
    return `Draft a sales email in ${locale}. Use customer background, communication history, and knowledge base facts. ${sourceRequirement}`;
  }
  if (input.purpose === "translate") {
    return `Translate the email content to ${locale}. Preserve names, amounts, dates, and CRM facts. ${sourceRequirement}`;
  }
  if (input.purpose === "summarize") {
    return `Summarize the thread into a compact CRM-safe memory that can replace long history in future prompts. ${sourceRequirement}`;
  }
  return `Analyze the thread context and recommend next steps without modifying CRM data. ${sourceRequirement}`;
}

function normalizeLimit(value: number, fallback: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}

function messageTime(message: EmailMessage): string {
  return message.sentAt ?? message.receivedAt ?? message.createdAt;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 20))}\n[truncated]` : value;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
