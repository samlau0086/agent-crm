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

function buildLocalTalkResponse(input: AiTalkInput): AiTalkResponse {
  const recent = input.history?.slice(-4).map((message) => `${message.role}: ${message.content}`).join("\n") ?? "";
  const text = [
    `我会基于当前 ${input.targetType}「${input.targetLabel}」的 CRM 上下文回答。`,
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
              "You are a read-only CRM discussion assistant. Answer using only the supplied CRM context and knowledge snippets. Do not claim that CRM data was changed. Return concise Chinese unless the user asks otherwise."
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

function buildTalkPrompt(input: AiTalkInput): string {
  return [
    `Target type: ${input.targetType}`,
    `Target label: ${input.targetLabel}`,
    `CRM context:\n${truncateForTalk(input.contextText, 8000)}`,
    input.knowledgeText ? `Knowledge snippets:\n${truncateForTalk(input.knowledgeText, 3000)}` : "",
    input.history?.length ? `Conversation history:\n${input.history.slice(-10).map((message) => `${message.role}: ${message.content}`).join("\n")}` : "",
    `User question:\n${input.question}`,
    "Answer with practical analysis, next options, and explicit uncertainty where context is insufficient. Keep the response suitable for saving into CRM RAG knowledge."
  ]
    .filter(Boolean)
    .join("\n\n");
}

function normalizeTalkOutput(value: string): string {
  const text = value.trim();
  return truncateForTalk(text || "当前上下文不足，无法生成可靠回答。", 4000);
}

function truncateForTalk(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n[truncated]` : value;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
