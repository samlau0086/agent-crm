import type {
  Activity,
  CrmRecord,
  EmailAiFeature,
  EmailAiSettings,
  EmailMessage,
  EmailThread,
  FieldDefinition,
  KnowledgeArticle,
  RequestContext
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
  sourceMessage?: EmailMessage;
  knowledgeArticles?: KnowledgeArticle[];
  targetLocale?: string;
}

export interface EmailAssistantContext {
  enabled: boolean;
  purpose: EmailAssistantPurpose;
  recordId?: string;
  threadId?: string;
  sourceMessageId?: string;
  enabledFeatures: Record<EmailAiFeature, boolean>;
  maxContextChars: number;
  contextCharCount: number;
  truncated: boolean;
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

export function getEmailAiPurposeFeature(purpose: EmailAssistantPurpose): EmailAiFeature {
  return purposeFeature[purpose];
}

export function isEmailAiPurposeEnabled(features: Partial<Record<EmailAiFeature, boolean>> | undefined, purpose: EmailAssistantPurpose): boolean {
  return normalizeEmailAiFeatures(features)[getEmailAiPurposeFeature(purpose)];
}

export function canRunEmailAiAutomation(
  context: Pick<RequestContext, "role">,
  settings: EmailAiSettings,
  automation: "auto_translate" | "auto_context_analysis" | "auto_summarize"
): boolean {
  if (!context.role.permissions.includes("ai.use")) {
    return false;
  }
  const features = normalizeEmailAiFeatures(settings.features);
  if (automation === "auto_translate") {
    return features.translate && features.auto_translate;
  }
  if (automation === "auto_context_analysis") {
    return features.context_analysis && features.auto_context_analysis;
  }
  return features.auto_summarize;
}

export function buildEmailAssistantContext(input: EmailAssistantContextInput): EmailAssistantContext {
  const enabledFeatures = normalizeEmailAiFeatures(input.settings.features);
  const purpose = input.purpose;
  const featureEnabled = enabledFeatures[getEmailAiPurposeFeature(purpose)];
  const maxContextChars = normalizeLimit(input.settings.maxContextChars, 8000, 1000, 20000);
  const maxHistoryMessages = normalizeLimit(input.settings.maxHistoryMessages, 8, 1, 20);
  const shouldUseCompactSummary = purpose !== "summarize" && enabledFeatures.auto_summarize;
  const messages = selectMessagesForContext(input.messages ?? [], input.thread, shouldUseCompactSummary, maxHistoryMessages, input.sourceMessage);
  const activities = [...(input.activities ?? [])]
    .filter((activity) => activity.type !== "email")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 8);
  const rawCustomerBrief = buildCustomerBrief(input.record, input.fields ?? []);
  const knowledgeArticles = rankKnowledgeArticles(
    input.knowledgeArticles ?? [],
    buildKnowledgeQuery(input, rawCustomerBrief, messages, activities)
  ).slice(0, normalizeLimit(input.settings.maxKnowledgeArticles, 5, 0, 20));

  const customerBrief = truncate(rawCustomerBrief, maxContextChars * 0.25);
  const communicationSummary = truncate(buildCommunicationSummary(input.thread, messages, activities), maxContextChars * 0.45);
  const knowledgeBrief = truncate(buildKnowledgeBrief(knowledgeArticles), maxContextChars * 0.25);
  const contextCharCount = customerBrief.length + communicationSummary.length + knowledgeBrief.length;
  const truncated = [customerBrief, communicationSummary, knowledgeBrief].some((value) => value.includes("[truncated]"));
  const sourceMessageSource =
    input.sourceMessage && !messages.some((message) => message.id === input.sourceMessage?.id)
      ? [{ label: input.sourceMessage.subject, messageId: input.sourceMessage.id }]
      : [];
  const sources = [
    ...(input.record ? [{ label: input.record.title, recordId: input.record.id }] : []),
    ...activities.slice(0, 3).map((activity) => ({ label: activity.title, activityId: activity.id })),
    ...sourceMessageSource,
    ...messages.slice(0, 5).map((message) => ({ label: message.subject, messageId: message.id })),
    ...knowledgeArticles.map((article) => ({ label: article.title, knowledgeArticleId: article.id }))
  ];
  const missingRequiredSources = input.settings.requireSourceLinks && sources.length === 0;
  const enabled = featureEnabled && !missingRequiredSources;

  return {
    enabled,
    purpose,
    recordId: input.record?.id,
    threadId: input.thread?.id,
    sourceMessageId: input.sourceMessage?.id,
    enabledFeatures,
    maxContextChars,
    contextCharCount,
    truncated,
    customerBrief,
    communicationSummary,
    knowledgeBrief,
    instruction: buildInstruction(input, enabled, featureEnabled ? (missingRequiredSources ? "missing_sources" : undefined) : "feature_disabled"),
    sources
  };
}

export function normalizeEmailAiFeatures(features: Partial<Record<EmailAiFeature, boolean>> | undefined): Record<EmailAiFeature, boolean> {
  const translate = features?.translate ?? false;
  const contextAnalysis = features?.context_analysis ?? false;
  return {
    draft: features?.draft ?? false,
    translate,
    auto_translate: translate && (features?.auto_translate ?? false),
    context_analysis: contextAnalysis,
    auto_context_analysis: contextAnalysis && (features?.auto_context_analysis ?? false),
    auto_summarize: features?.auto_summarize ?? false
  };
}

export function createDefaultEmailAiSettings(workspaceId: string, now: string): EmailAiSettings {
  return {
    workspaceId,
    features: {
      draft: false,
      translate: false,
      auto_translate: false,
      context_analysis: false,
      auto_context_analysis: false,
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

function filterMessagesForContext(messages: EmailMessage[], thread: EmailThread | undefined, autoSummarize: boolean): EmailMessage[] {
  const committedMessages = messages.filter(isEmailMessageUsableForContext);
  if (!autoSummarize || !thread?.summary || !thread.summaryUpdatedAt) {
    return committedMessages;
  }
  const summaryTime = Date.parse(thread.summaryUpdatedAt);
  if (!Number.isFinite(summaryTime)) {
    return committedMessages;
  }
  return committedMessages.filter((message) => {
    const time = Date.parse(messageTime(message));
    return Number.isFinite(time) && time > summaryTime;
  });
}

function isEmailMessageUsableForContext(message: EmailMessage): boolean {
  return message.direction === "inbound" ? message.status === "received" : message.status === "sent";
}

function selectMessagesForContext(
  messages: EmailMessage[],
  thread: EmailThread | undefined,
  autoSummarize: boolean,
  maxHistoryMessages: number,
  sourceMessage?: EmailMessage
): EmailMessage[] {
  const filtered = filterMessagesForContext(messages, thread, autoSummarize)
    .filter((message) => message.id !== sourceMessage?.id)
    .sort((left, right) => messageTime(right).localeCompare(messageTime(left)));
  if (!sourceMessage) {
    return filtered.slice(0, maxHistoryMessages);
  }
  return [sourceMessage, ...filtered.slice(0, Math.max(0, maxHistoryMessages - 1))].sort((left, right) => messageTime(right).localeCompare(messageTime(left)));
}

function buildKnowledgeBrief(articles: KnowledgeArticle[]): string {
  return articles.map((article) => `${article.title} [${article.tags.join(", ")}]\n${truncate(article.body, 700)}`).join("\n\n");
}

function rankKnowledgeArticles(articles: KnowledgeArticle[], queryText: string): KnowledgeArticle[] {
  const terms = tokenizeKnowledgeQuery(queryText);
  return articles
    .filter((article) => article.active)
    .map((article, index) => ({
      article,
      index,
      score: scoreKnowledgeArticle(article, terms)
    }))
    .sort((left, right) => right.score - left.score || right.article.updatedAt.localeCompare(left.article.updatedAt) || left.index - right.index)
    .map((item) => item.article);
}

function buildKnowledgeQuery(input: EmailAssistantContextInput, customerBrief: string, messages: EmailMessage[], activities: Activity[]): string {
  return [
    input.purpose,
    input.thread?.subject,
    customerBrief,
    input.sourceMessage?.subject,
    input.sourceMessage?.bodyText,
    ...messages.flatMap((message) => [message.subject, message.bodyText]),
    ...activities.flatMap((activity) => [activity.title, activity.body])
  ]
    .filter(Boolean)
    .join("\n");
}

function scoreKnowledgeArticle(article: KnowledgeArticle, terms: string[]): number {
  if (!terms.length) {
    return 0;
  }
  const title = normalizeKnowledgeText(article.title);
  const body = normalizeKnowledgeText(article.body);
  const tags = article.tags.map(normalizeKnowledgeText);
  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) {
      score += 6;
    }
    if (tags.some((tag) => tag.includes(term) || term.includes(tag))) {
      score += 8;
    }
    if (body.includes(term)) {
      score += 2;
    }
  }
  return score;
}

function tokenizeKnowledgeQuery(value: string): string[] {
  const normalized = normalizeKnowledgeText(value);
  const matches = normalized.match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? [];
  return Array.from(new Set(matches.filter((term) => term.length >= 2))).slice(0, 80);
}

function normalizeKnowledgeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function buildInstruction(input: EmailAssistantContextInput, enabled: boolean, disabledReason?: "feature_disabled" | "missing_sources"): string {
  if (!enabled) {
    if (disabledReason === "missing_sources") {
      return `AI email feature "${input.purpose}" requires at least one CRM record, email message, activity, or knowledge article source. Link a record, select a thread/message, or add active knowledge before generating content.`;
    }
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
