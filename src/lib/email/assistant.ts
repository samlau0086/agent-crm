import type {
  Activity,
  AiAgentSetting,
  CrmRecord,
  EmailAiFeature,
  EmailAiSettings,
  EmailMessage,
  EmailThread,
  FieldDefinition,
  KnowledgeArticle,
  RequestContext
} from "@/lib/crm/types";
import { repairEmailMojibake } from "@/lib/email/mojibake";

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
  agentKey?: string;
  agentName?: string;
  agentModel?: string;
  agentMarkdown?: string;
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

export const inboundEmailPreprocessAgentKey = "inbound_email_preprocess";
export const emailClassificationAgentKey = "email_classification";
export const emailDraftAgentKey = "email_draft";
export const emailTranslationAgentKey = "email_translation";
export const emailContextAnalysisAgentKey = "email_context_analysis";
export const emailThreadSummaryAgentKey = "email_thread_summary";

const defaultInboundEmailAgentMarkdown = [
  "# Inbound Email Preprocess Agent",
  "",
  "You preprocess newly received customer emails for a private sales CRM.",
  "Use customer background, communication history, and the system knowledge base.",
  "Produce concise, source-grounded summaries and next-context signals.",
  "Do not modify CRM records, deal stages, amounts, contacts, tasks, or mailbox state.",
  "Prefer compact memory that reduces future prompt tokens."
].join("\n");

const defaultEmailClassificationAgentMarkdown = [
  "# Email Classification Agent",
  "",
  "Classify newly received emails for a private sales CRM.",
  "Use sender, subject, body, customer background, communication history, and knowledge base context.",
  "Return one category only: primary, promotions, social, or updates.",
  "Do not modify CRM records, deal stages, amounts, contacts, tasks, or mailbox state."
].join("\n");

const defaultEmailDraftAgentMarkdown = [
  "# Email Draft Agent",
  "",
  "Draft sales emails using customer background, communication history, and the system knowledge base.",
  "Keep output source-grounded and suitable for human review.",
  "Do not modify CRM records or send mail automatically."
].join("\n");

const defaultEmailTranslationAgentMarkdown = [
  "# Email Translation Agent",
  "",
  "Translate email content while preserving names, numbers, dates, product names, URLs, and CRM facts.",
  "Use customer context and knowledge only to disambiguate meaning.",
  "Do not add new business claims."
].join("\n");

const defaultEmailContextAnalysisAgentMarkdown = [
  "# Email Context Analysis Agent",
  "",
  "Analyze email context using customer background, communication history, and knowledge base facts.",
  "Return concise risks, intent, open questions, and next-step recommendations.",
  "Do not modify CRM data."
].join("\n");

const defaultEmailThreadSummaryAgentMarkdown = [
  "# Email Thread Summary Agent",
  "",
  "Summarize email threads into compact CRM memory that reduces future prompt tokens.",
  "Keep facts source-grounded and omit redundant greetings, signatures, and boilerplate.",
  "Do not modify CRM data."
].join("\n");

export function createDefaultAiAgentSettings(): AiAgentSetting[] {
  const model = process.env.AI_MODEL || "gpt-4.1-mini";
  return [
    {
      key: emailClassificationAgentKey,
      name: "入站邮件预处理 Agent",
      scenario: "email",
      enabled: true,
      model,
      agentMarkdown: defaultEmailClassificationAgentMarkdown,
      maxOutputChars: 1000
    },
    {
      key: emailDraftAgentKey,
      name: "写邮件 Agent",
      scenario: "email",
      enabled: true,
      model,
      agentMarkdown: defaultEmailDraftAgentMarkdown,
      maxOutputChars: 4000
    },
    {
      key: emailTranslationAgentKey,
      name: "翻译 Agent",
      scenario: "email",
      enabled: true,
      model,
      agentMarkdown: defaultEmailTranslationAgentMarkdown,
      maxOutputChars: 4000
    },
    {
      key: emailContextAnalysisAgentKey,
      name: "上下文分析 Agent",
      scenario: "email",
      enabled: true,
      model,
      agentMarkdown: defaultEmailContextAnalysisAgentMarkdown,
      maxOutputChars: 4000
    },
    {
      key: emailThreadSummaryAgentKey,
      name: "线程总结 Agent",
      scenario: "email",
      enabled: true,
      model,
      agentMarkdown: defaultEmailThreadSummaryAgentMarkdown,
      maxOutputChars: 4000
    }
  ];
}

export function getEmailAssistantAgentKey(purpose: EmailAssistantPurpose): string {
  if (purpose === "draft") return emailDraftAgentKey;
  if (purpose === "translate") return emailTranslationAgentKey;
  if (purpose === "context_analysis") return emailContextAnalysisAgentKey;
  return emailThreadSummaryAgentKey;
}

export function getEmailAutomationAgentKey(automation: "auto_translate" | "auto_context_analysis" | "auto_summarize"): string {
  if (automation === "auto_translate") return emailTranslationAgentKey;
  if (automation === "auto_context_analysis") return emailContextAnalysisAgentKey;
  return emailThreadSummaryAgentKey;
}

export function normalizeAiAgentSettings(agents: unknown): AiAgentSetting[] {
  const defaults = createDefaultAiAgentSettings();
  const inputAgents = Array.isArray(agents) ? agents : [];
  const byKey = new Map(defaults.map((agent) => [agent.key, agent]));
  for (const value of inputAgents) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const raw = value as Partial<AiAgentSetting>;
    const rawKey = normalizeAgentKey(raw.key);
    const key = rawKey === inboundEmailPreprocessAgentKey ? emailClassificationAgentKey : rawKey;
    if (!key) {
      continue;
    }
    const fallback = byKey.get(key);
    byKey.set(key, {
      key,
      name: normalizeText(raw.name, fallback?.name ?? key, 80),
      scenario: raw.scenario === "sales" || raw.scenario === "system" ? raw.scenario : "email",
      enabled: raw.enabled ?? fallback?.enabled ?? false,
      model: normalizeText(raw.model, fallback?.model ?? process.env.AI_MODEL ?? "gpt-4.1-mini", 120),
      agentMarkdown: normalizeText(raw.agentMarkdown, fallback?.agentMarkdown ?? "", 8000),
      maxOutputChars: normalizeLimit(Number(raw.maxOutputChars ?? fallback?.maxOutputChars ?? 4000), 500, 500, 12000)
    });
  }
  return Array.from(byKey.values());
}

export function getAiAgentSetting(settings: Pick<EmailAiSettings, "agents"> | undefined, key: string): AiAgentSetting | undefined {
  return normalizeAiAgentSettings(settings?.agents).find((agent) => agent.key === key);
}

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
  const agent = getAiAgentSetting(settings, getEmailAutomationAgentKey(automation));
  if (!agent?.enabled) {
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

export function canRunEmailClassification(context: Pick<RequestContext, "role">, settings: EmailAiSettings): boolean {
  if (!context.role.permissions.includes("ai.use")) {
    return false;
  }
  return Boolean(getAiAgentSetting(settings, emailClassificationAgentKey)?.enabled);
}

export function buildEmailAssistantContext(input: EmailAssistantContextInput): EmailAssistantContext {
  const enabledFeatures = normalizeEmailAiFeatures(input.settings.features);
  const agent = getAiAgentSetting(input.settings, getEmailAssistantAgentKey(input.purpose));
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
  const agentEnabled = agent?.enabled ?? true;
  const enabled = featureEnabled && agentEnabled && !missingRequiredSources;

  return {
    enabled,
    purpose,
    agentKey: agent?.key,
    agentName: agent?.name,
    agentModel: agent?.model,
    agentMarkdown: agent?.agentMarkdown,
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
    instruction: buildInstruction(
      input,
      enabled,
      !featureEnabled ? "feature_disabled" : !agentEnabled ? "agent_disabled" : missingRequiredSources ? "missing_sources" : undefined,
      agent
    ),
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
    agents: createDefaultAiAgentSettings(),
    providerConfig: {
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
      timeoutMs: 10000,
      hasApiKey: Boolean(process.env.AI_API_KEY)
    },
    defaultLocale: "zh-CN",
    requireSourceLinks: true,
    maxHistoryMessages: 8,
    maxKnowledgeArticles: 5,
    maxContextChars: 8000,
    updatedAt: now
  };
}

function normalizeAgentKey(value: unknown): string {
  return typeof value === "string" && /^[a-z][a-z0-9_:-]{1,80}$/.test(value.trim()) ? value.trim() : "";
}

function normalizeText(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : fallback.slice(0, maxLength);
}

function buildCustomerBrief(record: CrmRecord | undefined, fields: FieldDefinition[]): string {
  if (!record) {
    return "No linked CRM record.";
  }

  const fieldText = fields
    .map((field) => `${cleanEmailContextText(field.label || field.key)}: ${cleanEmailContextText(formatValue(record.data[field.key]))}`)
    .filter((line) => !line.endsWith(": "))
    .join("\n");

  return [`Record: ${cleanEmailContextText(record.title)}`, `Object: ${record.objectKey}`, record.stageKey ? `Stage: ${record.stageKey}` : undefined, fieldText].filter(Boolean).join("\n");
}

function buildCommunicationSummary(thread: EmailThread | undefined, messages: EmailMessage[], activities: Activity[]): string {
  const threadSummary = thread?.summary ? `Existing thread summary: ${cleanEmailContextText(thread.summary)}` : undefined;
  const messageSummary = messages
    .map((message) => {
      const subject = cleanEmailContextText(message.subject);
      const bodyText = truncate(cleanEmailContextText(message.bodyText), 500);
      return `${message.direction} ${message.status} ${subject} from ${cleanEmailContextText(message.from)} to ${message.to.map(cleanEmailContextText).join(", ")}: ${bodyText}`;
    })
    .join("\n");
  const activitySummary = activities
    .map((activity) => `${activity.type}: ${cleanEmailContextText(activity.title)}${activity.body ? ` - ${truncate(cleanEmailContextText(activity.body), 300)}` : ""}`)
    .join("\n");

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
  return articles
    .map((article) => `${cleanEmailContextText(article.title)} [${article.tags.map(cleanEmailContextText).join(", ")}]\n${truncate(cleanEmailContextText(article.body), 700)}`)
    .join("\n\n");
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
    input.thread?.subject ? cleanEmailContextText(input.thread.subject) : undefined,
    customerBrief,
    input.sourceMessage?.subject ? cleanEmailContextText(input.sourceMessage.subject) : undefined,
    input.sourceMessage?.bodyText ? cleanEmailContextText(input.sourceMessage.bodyText) : undefined,
    ...messages.flatMap((message) => [cleanEmailContextText(message.subject), cleanEmailContextText(message.bodyText)]),
    ...activities.flatMap((activity) => [cleanEmailContextText(activity.title), activity.body ? cleanEmailContextText(activity.body) : undefined])
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

function buildInstruction(
  input: EmailAssistantContextInput,
  enabled: boolean,
  disabledReason?: "feature_disabled" | "missing_sources" | "agent_disabled",
  agent?: AiAgentSetting
): string {
  if (!enabled) {
    if (disabledReason === "missing_sources") {
      return `AI email feature "${input.purpose}" requires at least one CRM record, email message, activity, or knowledge article source. Link a record, select a thread/message, or add active knowledge before generating content.`;
    }
    if (disabledReason === "agent_disabled") {
      return `AI agent "${agent?.name ?? getEmailAssistantAgentKey(input.purpose)}" is disabled. Do not generate content for this action.`;
    }
    return `AI email feature "${input.purpose}" is disabled. Do not generate content for this action.`;
  }

  const locale = input.targetLocale ?? input.settings.defaultLocale;
  const sourceRequirement = input.settings.requireSourceLinks ? "Include source references to CRM records, email messages, activities, or knowledge articles." : "Source references are optional.";
  const agentInstruction = agent?.agentMarkdown ? `\n\nAgent.md:\n${truncate(agent.agentMarkdown, 4000)}` : "";

  if (input.purpose === "draft") {
    return `Draft a sales email in ${locale}. Use customer background, communication history, and knowledge base facts. ${sourceRequirement}${agentInstruction}`;
  }
  if (input.purpose === "translate") {
    return `Translate the email content to ${locale}. Preserve names, amounts, dates, and CRM facts. ${sourceRequirement}${agentInstruction}`;
  }
  if (input.purpose === "summarize") {
    return `Summarize the thread into a compact CRM-safe memory that can replace long history in future prompts. ${sourceRequirement}${agentInstruction}`;
  }
  return `Analyze the thread context and recommend next steps without modifying CRM data. ${sourceRequirement}${agentInstruction}`;
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

function cleanEmailContextText(value: string): string {
  return repairEmailMojibake(value)
    .replace(/&#0*64;/gi, "@")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
