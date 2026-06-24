import type { EmailAssistantContext, EmailAssistantPurpose } from "@/lib/email/assistant";
import { normalizeAiProviderConfig } from "@/lib/ai/provider-config";
import type { AiProviderConfig } from "@/lib/crm/types";

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

type AiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const MAX_EMAIL_MODEL_PROMPT_CHARS = 24000;
export const MAX_EMAIL_AI_OUTPUT_CHARS = 12000;
export const MAX_EMAIL_AI_SUBJECT_CHARS = 200;

export async function generateEmailAiOutput(input: EmailAiGenerateInput, options?: { config?: Partial<AiProviderConfig>; fetchImpl?: AiFetch }): Promise<EmailAiGenerateResult> {
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
  if (!config.apiKey) {
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

async function completeEmailAi(input: EmailAiGenerateInput, config: AiProviderConfig, fetchImpl: AiFetch): Promise<EmailAiGeneratedContent> {
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
              "For draft emails, return customer-facing body content only. Do not include signatures, sign-off blocks, sender placeholders, contact blocks, citations, source labels, or source-reference footers in the body.",
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

function readEmailAiProviderConfig(overrides?: Partial<AiProviderConfig>): AiProviderConfig {
  return normalizeAiProviderConfig(overrides);
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
  const rawText = normalizeGeneratedTextForPurpose(purpose, content.text);
  const text = truncate(rawText, textLimit);
  const suggestedSubject = content.suggestedSubject?.trim().replace(/\s+/g, " ");
  const normalizedSubject = suggestedSubject ? truncate(suggestedSubject, MAX_EMAIL_AI_SUBJECT_CHARS) : undefined;
  return {
    text,
    ...(normalizedSubject ? { suggestedSubject: normalizedSubject } : {}),
    outputTruncated: text !== rawText || Boolean(suggestedSubject && normalizedSubject !== suggestedSubject)
  };
}

function normalizeGeneratedTextForPurpose(purpose: EmailAssistantPurpose, value: string): string {
  const text = value.trim();
  if (purpose !== "draft") {
    return text;
  }
  return stripDraftOnlyArtifacts(text);
}

function stripDraftOnlyArtifacts(value: string): string {
  const lines = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());
  const sourceStartIndex = lines.findIndex((line) => /^(来源|資料來源|资料来源|source|sources|source references?|references?|citations?)\s*[:：]/i.test(line.trim()));
  const withoutSources = sourceStartIndex >= 0 ? lines.slice(0, sourceStartIndex) : lines;
  const signatureStartIndex = findTrailingSignatureStart(withoutSources);
  const withoutSignature = signatureStartIndex >= 0 ? withoutSources.slice(0, signatureStartIndex) : withoutSources;
  return withoutSignature
    .filter((line) => !/^\[(您的名字|你的名字|姓名|名字|your name|name|您的职位|职位|title|position|您的公司|公司|company|您的联系方式|联系方式|contact|phone|email)\]$/i.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findTrailingSignatureStart(lines: string[]): number {
  const signatureLinePattern = /^(祝好|此致|敬礼|谢谢|感谢|顺祝商祺|best regards|kind regards|regards|sincerely|yours sincerely|thanks|thank you)[,，。！!]*$/i;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line) {
      continue;
    }
    if (signatureLinePattern.test(line)) {
      return index;
    }
    if (/^\[(您的名字|你的名字|姓名|名字|your name|name)\]$/i.test(line)) {
      let cursor = index - 1;
      while (cursor >= 0 && !lines[cursor]?.trim()) {
        cursor -= 1;
      }
      if (cursor >= 0 && signatureLinePattern.test(lines[cursor]?.trim() ?? "")) {
        return cursor;
      }
      return index;
    }
  }
  return -1;
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
        "I can share the relevant details and help align the next steps. Please let me know a suitable time for the next discussion."
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
      "AI 线程分析",
      "",
      `结论：${buildLocalAnalysisConclusion(context)}`,
      "",
      `客户与关联：${context.customerBrief && !context.customerBrief.includes("No linked CRM record") ? "已关联 CRM 记录，可结合客户资料继续判断。" : "当前没有关联 CRM 记录，先不要把这封邮件当作明确销售机会处理。"}`,
      `邮件重点：${buildLocalAnalysisEmailFocus(context, sourceText)}`,
      context.knowledgeBrief ? `知识库参考：已纳入相关知识库内容，但仅用于建议，不会修改 CRM 数据。` : "知识库参考：未发现明显相关知识库内容。",
      "",
      "建议下一步：",
      ...buildLocalAnalysisActions(context, prompt)
    ]
      .filter(Boolean)
      .join("\n")
  };
}

function buildLocalAnalysisConclusion(context: EmailAssistantContext): string {
  const text = `${context.communicationSummary}\n${context.customerBrief}`.toLowerCase();
  if (/unsubscribe|instagram|facebook|notification|通知|推广|促销|社交/.test(text)) {
    return "该线程更像自动通知、推广或社交类邮件，当前没有清晰采购意图。";
  }
  if (context.customerBrief && !context.customerBrief.includes("No linked CRM record")) {
    return "该线程已具备客户上下文，可以基于最近沟通确认下一步销售动作。";
  }
  return "该线程缺少明确客户背景，需要先完成联系人关联和意图判断。";
}

function buildLocalAnalysisEmailFocus(context: EmailAssistantContext, sourceText: string | undefined): string {
  const firstSource = sourceText?.trim() || context.communicationSummary.split("\n").find((line) => line.trim()) || "";
  if (!firstSource) {
    return "暂无足够邮件内容可判断。";
  }
  const normalized = firstSource.replace(/\s+/g, " ").trim();
  return truncate(normalized, 220);
}

function buildLocalAnalysisActions(context: EmailAssistantContext, prompt: string | undefined): string[] {
  const hasRecord = Boolean(context.customerBrief && !context.customerBrief.includes("No linked CRM record"));
  const text = `${context.communicationSummary}\n${prompt ?? ""}`.toLowerCase();
  if (/unsubscribe|instagram|facebook|notification|通知|推广|促销|社交/.test(text) && !hasRecord) {
    return [
      "1. 如果发件人不是客户或潜在客户，归档或标记为非销售邮件。",
      "2. 如果该邮箱属于真实客户，先关联到现有联系人或新建联系人，再重新运行分析。",
      "3. 不要自动修改交易阶段、金额、联系人等关键业务字段。"
    ];
  }
  return [
    "1. 确认该邮件对应的联系人或公司，并补齐关联关系。",
    "2. 针对最近一封邮件中的未解决问题准备回复或跟进任务。",
    "3. 在客户确认意图之前，不自动修改交易阶段、金额或联系人关键字段。"
  ];
}

function buildSuggestedSubject(context: EmailAssistantContext, prompt: string | undefined): string {
  const source = context.sources.find((item) => item.recordId)?.label ?? context.sources[0]?.label;
  if (prompt) {
    return `Follow up: ${prompt.slice(0, 70)}`;
  }
  return source ? `Follow up: ${source}` : "Follow up on next steps";
}
