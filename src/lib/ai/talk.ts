import { normalizeAiProviderConfig } from "@/lib/ai/provider-config";
import type { AiProviderConfig } from "@/lib/crm/types";

export interface AiTalkMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiTalkSource {
  label: string;
  objectKey?: string;
  recordId?: string;
  messageId?: string;
  knowledgeArticleId?: string;
}

export interface AiTalkInput {
  question: string;
  history?: AiTalkMessage[];
  targetLabel: string;
  targetType: string;
  contextText: string;
  knowledgeText?: string;
  sources: AiTalkSource[];
}

export interface AiTalkResponse {
  text: string;
  sources: AiTalkSource[];
  generationMode: "local" | "provider" | "provider_fallback";
}

export interface AiTalkSuggestionInput extends AiTalkInput {
  questionPrefix: string;
}

export interface AiTalkSuggestionResponse {
  completion: string;
  generationMode: "local" | "provider" | "provider_fallback";
}

type AiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function generateAiTalkResponse(input: AiTalkInput, options?: { config?: Partial<AiProviderConfig>; fetchImpl?: AiFetch }): Promise<AiTalkResponse> {
  const config = normalizeAiProviderConfig(options?.config);
  const fallback = buildLocalTalkResponse(input);
  if (!config.apiKey) {
    return fallback;
  }
  try {
    const text = await completeAiTalk(input, config, options?.fetchImpl ?? fetch);
    return {
      text: normalizeTalkOutput(text),
      sources: input.sources,
      generationMode: "provider"
    };
  } catch {
    return {
      ...fallback,
      generationMode: "provider_fallback"
    };
  }
}

export async function generateAiTalkSuggestion(input: AiTalkSuggestionInput, options?: { config?: Partial<AiProviderConfig>; fetchImpl?: AiFetch }): Promise<AiTalkSuggestionResponse> {
  const config = normalizeAiProviderConfig(options?.config);
  const fallback = buildLocalTalkSuggestion(input);
  if (!config.apiKey) {
    return fallback;
  }
  try {
    const completion = await completeAiTalkSuggestion(input, config, options?.fetchImpl ?? fetch);
    return {
      completion: normalizeTalkSuggestionOutput(input.questionPrefix, completion || fallback.completion),
      generationMode: "provider"
    };
  } catch {
    return {
      ...fallback,
      generationMode: "provider_fallback"
    };
  }
}

function buildLocalTalkResponse(input: AiTalkInput): AiTalkResponse {
  const recent = input.history?.slice(-4).map((message) => `${message.role}: ${message.content}`).join("\n") ?? "";
  const text = [
    `我会基于当前 ${input.targetType}“${input.targetLabel}”的 CRM 上下文回答。`,
    input.contextText ? `关键上下文：${truncateForTalk(input.contextText.replace(/\s+/g, " "), 900)}` : "当前上下文较少，请补充目标、时间线或约束。",
    recent ? `最近讨论：${truncateForTalk(recent, 500)}` : "",
    `针对你的问题：${input.question}`,
    "建议先确认事实来源，再把可复用结论保存到 RAG 知识；我不会自动修改 CRM 数据。"
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    text,
    sources: input.sources,
    generationMode: "local"
  };
}

function buildLocalTalkSuggestion(input: AiTalkSuggestionInput): AiTalkSuggestionResponse {
  const prefix = input.questionPrefix.trim();
  const label = input.targetLabel;
  const suggested =
    input.targetType === "email_thread"
      ? `分析这封邮件“${label}”的客户意图、风险等级和建议下一步行动。`
      : `总结“${label}”当前背景、关键风险和下一步建议。`;
  return {
    completion: normalizeTalkSuggestionOutput(prefix, prefix ? `${prefix}，并结合当前 CRM 上下文给出可执行建议。` : suggested),
    generationMode: "local"
  };
}

async function completeAiTalk(input: AiTalkInput, config: AiProviderConfig, fetchImpl: AiFetch): Promise<string> {
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
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You are a read-only CRM discussion assistant. Answer using only the supplied CRM context and knowledge snippets. Do not claim that CRM data was changed. Return concise Simplified Chinese unless the user asks otherwise."
          },
          { role: "user", content: buildTalkPrompt(input) }
        ]
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`AI provider returned HTTP ${response.status}`);
    }
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return payload.choices?.[0]?.message?.content?.trim() || "";
  } finally {
    clearTimeout(timeout);
  }
}

async function completeAiTalkSuggestion(input: AiTalkSuggestionInput, config: AiProviderConfig, fetchImpl: AiFetch): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 8000));
  try {
    const response = await fetchImpl(`${trimTrailingSlash(config.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content:
              "You generate Gmail-style smart compose suggestions for a CRM discussion box. Return only one concise Simplified Chinese completion. If the user has typed text, the returned completion must start with that exact text and continue it naturally. Do not answer the question."
          },
          { role: "user", content: buildTalkSuggestionPrompt(input) }
        ]
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`AI provider returned HTTP ${response.status}`);
    }
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return payload.choices?.[0]?.message?.content?.trim() || "";
  } finally {
    clearTimeout(timeout);
  }
}

function buildTalkPrompt(input: AiTalkInput): string {
  return [
    `Target type: ${input.targetType}`,
    `Target label: ${input.targetLabel}`,
    `CRM context:\n${truncateForTalk(input.contextText, 8000)}`,
    input.knowledgeText ? `Knowledge snippets:\n${truncateForTalk(input.knowledgeText, 3000)}` : "",
    input.history?.length ? `Conversation history:\n${input.history.slice(-10).map((message) => `${message.role}: ${message.content}`).join("\n")}` : "",
    `User question:\n${input.question}`,
    "Answer in Simplified Chinese with practical analysis, next options, and explicit uncertainty where context is insufficient. Keep the response suitable for saving into CRM RAG knowledge."
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildTalkSuggestionPrompt(input: AiTalkSuggestionInput): string {
  return [
    `Target type: ${input.targetType}`,
    `Target label: ${input.targetLabel}`,
    `Current draft prefix:\n${input.questionPrefix}`,
    `CRM context:\n${truncateForTalk(input.contextText, 3000)}`,
    input.knowledgeText ? `Knowledge snippets:\n${truncateForTalk(input.knowledgeText, 1200)}` : "",
    input.history?.length ? `Conversation history:\n${input.history.slice(-6).map((message) => `${message.role}: ${message.content}`).join("\n")}` : "",
    "Return a single useful Simplified Chinese question or instruction the user can send to the Talk about this assistant. Keep it under 160 Chinese characters."
  ]
    .filter(Boolean)
    .join("\n\n");
}

function normalizeTalkOutput(value: string): string {
  const text = value.trim();
  return truncateForTalk(text || "当前上下文不足，无法生成可靠回答。", 4000);
}

function normalizeTalkSuggestionOutput(prefix: string, value: string): string {
  const cleaned = value.replace(/^["'“”]+|["'“”]+$/g, "").replace(/\s+/g, " ").trim();
  const trimmedPrefix = prefix.trim();
  if (!trimmedPrefix) {
    return truncateForTalk(cleaned, 220);
  }
  if (cleaned.toLowerCase().startsWith(trimmedPrefix.toLowerCase())) {
    return truncateForTalk(cleaned, 260);
  }
  const separator = /[，。,.!?！？；;\s]$/.test(trimmedPrefix) ? "" : "，";
  return truncateForTalk(`${trimmedPrefix}${separator}${cleaned}`, 260);
}

function truncateForTalk(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n[truncated]` : value;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
