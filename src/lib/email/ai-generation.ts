import type { EmailAssistantContext, EmailAssistantPurpose } from "@/lib/email/assistant";

export interface EmailAiGenerateInput {
  context: EmailAssistantContext;
  userPrompt?: string;
  sourceText?: string;
}

export type EmailAiGenerationMode = "disabled" | "local" | "provider" | "provider_fallback" | "queued";

export interface EmailAiGenerateResult {
  enabled: boolean;
  purpose: EmailAssistantPurpose;
  recordId?: string;
  threadId?: string;
  sourceMessageId?: string;
  generationMode: EmailAiGenerationMode;
  providerError?: string;
  text: string;
  suggestedSubject?: string;
  sources: EmailAssistantContext["sources"];
  budget: {
    maxContextChars: number;
    contextCharCount: number;
    modelPromptChars: number;
    truncated: boolean;
    outputTruncated: boolean;
  };
}

interface EmailAiProviderConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

type AiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_AI_MODEL = "gpt-4.1-mini";
const DEFAULT_AI_TIMEOUT_MS = 10000;
export const MAX_EMAIL_MODEL_PROMPT_CHARS = 24000;
export const MAX_EMAIL_AI_OUTPUT_CHARS = 12000;
export const MAX_EMAIL_AI_SUBJECT_CHARS = 200;

export async function generateEmailAiOutput(input: EmailAiGenerateInput, options?: { config?: Partial<EmailAiProviderConfig>; fetchImpl?: AiFetch }): Promise<EmailAiGenerateResult> {
  const { context } = input;
  if (!context.enabled) {
    return {
      enabled: false,
      purpose: context.purpose,
      recordId: context.recordId,
      threadId: context.threadId,
      sourceMessageId: context.sourceMessageId,
      generationMode: "disabled",
      text: context.instruction,
      sources: context.sources,
      budget: buildEmailAiBudget(input, false)
    };
  }

  const local = buildEmailAiResult(input, buildLocalOutput(input));
  const config = readEmailAiProviderConfig({ ...options?.config, model: options?.config?.model ?? context.agentModel });
  if (config.provider !== "openai-compatible" || !config.apiKey) {
    return { ...local, generationMode: "local" };
  }

  try {
    const content = await completeEmailAi(input, config, options?.fetchImpl ?? fetch);
    return buildEmailAiResult(input, content, "provider");
  } catch (error) {
    return { ...local, generationMode: "provider_fallback", providerError: normalizeProviderError(error) };
  }
}

interface EmailAiGeneratedContent {
  text: string;
  suggestedSubject?: string;
}

interface NormalizedEmailAiGeneratedContent extends EmailAiGeneratedContent {
  outputTruncated: boolean;
}

function buildEmailAiResult(input: EmailAiGenerateInput, content: EmailAiGeneratedContent, generationMode: EmailAiGenerationMode = "local"): EmailAiGenerateResult {
  const normalized = normalizeGeneratedContent(input.context.purpose, input.context.maxContextChars, content);
  return {
    enabled: true,
    purpose: input.context.purpose,
    recordId: input.context.recordId,
    threadId: input.context.threadId,
    sourceMessageId: input.context.sourceMessageId,
    generationMode,
    text: normalized.text,
    suggestedSubject: normalized.suggestedSubject,
    sources: input.context.sources,
    budget: buildEmailAiBudget(input, normalized.outputTruncated)
  };
}

function buildEmailAiBudget(input: EmailAiGenerateInput, outputTruncated: boolean): EmailAiGenerateResult["budget"] {
  const prompt = buildEmailModelPrompt(input);
  return {
    maxContextChars: input.context.maxContextChars,
    contextCharCount: input.context.contextCharCount,
    modelPromptChars: prompt.length,
    truncated: input.context.truncated || prompt.includes("[truncated]"),
    outputTruncated
  };
}

async function completeEmailAi(input: EmailAiGenerateInput, config: EmailAiProviderConfig, fetchImpl: AiFetch): Promise<EmailAiGeneratedContent> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(`${trimTrailingSlash(config.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        temperature: input.context.purpose === "draft" ? 0.4 : 0.1,
        messages: [
          {
            role: "system",
            content: [
              "You are a private-deployment sales CRM email assistant.",
              "Use only the supplied CRM record, communication history, and knowledge base context.",
              "Do not claim that CRM data has been changed. Do not modify deal stage, amount, contacts, tasks, or other business records.",
              "When facts are uncertain, state that clearly.",
              "Return only JSON in the shape {\"text\":\"...\",\"suggestedSubject\":\"...\"}; suggestedSubject is only needed for draft emails."
            ].join(" ")
          },
          { role: "user", content: buildEmailModelPrompt(input) }
        ]
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`AI provider returned HTTP ${response.status}`);
    }
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("AI provider returned an empty message");
    }
    return parseModelContent(content);
  } finally {
    clearTimeout(timeout);
  }
}

export function buildEmailModelPrompt(input: EmailAiGenerateInput): string {
  const context = input.context;
  const budget = normalizeModelPromptBudget(context.maxContextChars);
  const sourceTextBudget = Math.max(300, Math.floor(budget * 0.35));
  const userPromptBudget = Math.max(200, Math.floor(budget * 0.1));
  const blocks = [
    `Purpose: ${context.purpose}`,
    context.agentKey ? `Agent: ${context.agentName ?? context.agentKey} (${context.agentKey})` : undefined,
    context.agentModel ? `Agent model: ${context.agentModel}` : undefined,
    `Instruction: ${context.instruction}`,
    input.userPrompt?.trim() ? `User request: ${truncate(input.userPrompt.trim(), userPromptBudget)}` : undefined,
    input.sourceText?.trim() ? `Source text: ${truncate(input.sourceText.trim(), sourceTextBudget)}` : undefined,
    `Customer background:\n${context.customerBrief || "None"}`,
    `Communication history:\n${context.communicationSummary || "None"}`,
    `Knowledge base:\n${context.knowledgeBrief || "None"}`,
    `Sources:\n${truncate(JSON.stringify(context.sources), Math.min(2000, Math.floor(budget * 0.15)))}`
  ].filter(Boolean);
  return truncate(blocks.join("\n\n"), budget);
}

function readEmailAiProviderConfig(overrides?: Partial<EmailAiProviderConfig>): EmailAiProviderConfig {
  return {
    provider: overrides?.provider ?? process.env.AI_PROVIDER ?? "openai-compatible",
    baseUrl: overrides?.baseUrl ?? process.env.AI_BASE_URL ?? DEFAULT_AI_BASE_URL,
    apiKey: overrides?.apiKey ?? process.env.AI_API_KEY ?? "",
    model: overrides?.model ?? process.env.AI_MODEL ?? DEFAULT_AI_MODEL,
    timeoutMs: normalizeTimeout(overrides?.timeoutMs ?? Number(process.env.AI_TIMEOUT_MS))
  };
}

function normalizeTimeout(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(value, 60000) : DEFAULT_AI_TIMEOUT_MS;
}

function normalizeProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 500) || "AI provider failed";
}

function normalizeModelPromptBudget(value: number): number {
  return Number.isFinite(value) ? Math.max(2000, Math.min(MAX_EMAIL_MODEL_PROMPT_CHARS, Math.floor(value + 1000))) : 9000;
}

function parseModelContent(content: string): EmailAiGeneratedContent {
  const jsonText = content.match(/\{[\s\S]*\}/)?.[0] ?? content;
  try {
    const parsed = JSON.parse(jsonText) as { text?: unknown; suggestedSubject?: unknown; subject?: unknown };
    if (typeof parsed.text === "string" && parsed.text.trim()) {
      const suggestedSubject = typeof parsed.suggestedSubject === "string" ? parsed.suggestedSubject : typeof parsed.subject === "string" ? parsed.subject : undefined;
      return {
        text: parsed.text.trim(),
        ...(suggestedSubject?.trim() ? { suggestedSubject: suggestedSubject.trim() } : {})
      };
    }
  } catch {
    // Compatible providers sometimes ignore JSON-only instructions.
  }
  return { text: content };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 20))}\n[truncated]` : value;
}

function normalizeGeneratedContent(purpose: EmailAssistantPurpose, maxContextChars: number, content: EmailAiGeneratedContent): NormalizedEmailAiGeneratedContent {
  const textLimit = getGeneratedTextLimit(purpose, maxContextChars);
  const rawText = content.text.trim();
  const text = truncate(rawText, textLimit);
  const suggestedSubject = content.suggestedSubject?.trim().replace(/\s+/g, " ");
  const normalizedSubject = suggestedSubject ? truncate(suggestedSubject, MAX_EMAIL_AI_SUBJECT_CHARS) : undefined;
  return {
    text,
    ...(normalizedSubject ? { suggestedSubject: normalizedSubject } : {}),
    outputTruncated: text !== rawText || Boolean(suggestedSubject && normalizedSubject !== suggestedSubject)
  };
}

function getGeneratedTextLimit(purpose: EmailAssistantPurpose, maxContextChars: number): number {
  const contextBound = Number.isFinite(maxContextChars) ? Math.max(1000, Math.floor(maxContextChars)) : 8000;
  if (purpose === "summarize") {
    return Math.min(MAX_EMAIL_AI_OUTPUT_CHARS, Math.max(1000, Math.floor(contextBound * 0.75)));
  }
  return Math.min(MAX_EMAIL_AI_OUTPUT_CHARS, contextBound);
}

function buildLocalOutput(input: EmailAiGenerateInput): EmailAiGeneratedContent {
  const prompt = input.userPrompt?.trim();
  const sourceText = input.sourceText?.trim();
  const context = input.context;

  if (context.purpose === "draft") {
    return {
      suggestedSubject: buildSuggestedSubject(context, prompt),
      text: [
        "Hello,",
        "",
        "Thank you for the recent conversation. Based on your current priorities and the latest CRM history, the recommended next step is to confirm deployment constraints, open questions, and a clear follow-up date.",
        "",
        "I can share the relevant details and help align the next steps. Please let me know a suitable time for the next discussion.",
        "",
        "Best regards,"
      ].join("\n")
    };
  }

  if (context.purpose === "translate") {
    return {
      text: [
        `Target locale: ${context.instruction.match(/to ([^.]+)\./)?.[1] ?? "configured locale"}`,
        sourceText ? `Content to translate:\n${sourceText}` : "No source text was provided.",
        "Preserve CRM names, dates, amounts, and source references when using a model provider."
      ].join("\n\n")
    };
  }

  if (context.purpose === "summarize") {
    return {
      text: [
        "Compact thread memory:",
        context.communicationSummary || "No recent email history is available.",
        context.customerBrief ? `\nCustomer context:\n${context.customerBrief}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    };
  }

  return {
    text: [
      "Context analysis:",
      context.customerBrief || "No linked customer record.",
      context.communicationSummary ? `\nRecent communication:\n${context.communicationSummary}` : "",
      context.knowledgeBrief ? `\nKnowledge base:\n${context.knowledgeBrief}` : "",
      prompt ? `\nUser request:\n${prompt}` : "",
      "\nRecommendation: confirm the customer's current objective, address the most recent unresolved item, and create a follow-up task before changing any CRM fields."
    ]
      .filter(Boolean)
      .join("\n")
  };
}

function buildSuggestedSubject(context: EmailAssistantContext, prompt: string | undefined): string {
  const source = context.sources.find((item) => item.recordId)?.label ?? context.sources[0]?.label;
  if (prompt) {
    return `Follow up: ${prompt.slice(0, 70)}`;
  }
  return source ? `Follow up: ${source}` : "Follow up on next steps";
}
