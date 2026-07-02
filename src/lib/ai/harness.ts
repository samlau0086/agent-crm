import { normalizeAiProviderConfig } from "@/lib/ai/provider-config";
import type { AiAgentRunRequest, AiAgentRunResult, AiAgentSetting, AiProviderConfig, AiProviderProfile } from "@/lib/crm/types";

type AiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface RunAiAgentOptions {
  agent: AiAgentSetting;
  providerConfig?: Partial<AiProviderConfig>;
  providerProfiles?: AiProviderProfile[];
  fetchImpl?: AiFetch;
  sources?: AiAgentRunResult["sources"];
}

export async function runAiAgent(request: AiAgentRunRequest, options: RunAiAgentOptions): Promise<AiAgentRunResult> {
  const agent = options.agent;
  const providerProfile = agent.providerProfileKey ? options.providerProfiles?.find((profile) => profile.key === agent.providerProfileKey && profile.enabled) : undefined;
  const providerConfig = normalizeAiProviderConfig({
    ...options.providerConfig,
    ...providerProfile,
    provider: agent.provider ?? providerProfile?.provider ?? options.providerConfig?.provider,
    baseUrl: agent.baseUrl ?? providerProfile?.baseUrl ?? options.providerConfig?.baseUrl,
    apiKey: providerProfile?.apiKey ?? options.providerConfig?.apiKey,
    model: agent.model || providerProfile?.model || options.providerConfig?.model
  });
  const prompt = buildAgentPrompt(request, agent);
  const maxOutputChars = normalizeLimit(agent.maxOutputChars, 4000, 500, 12000);
  const localText = buildLocalAgentOutput(request, agent);
  if (!agent.enabled) {
    return buildAgentResult(request, agent, providerConfig, localText, "disabled", prompt, maxOutputChars, options.sources);
  }
  if (request.dryRun || !providerConfig.apiKey) {
    return buildAgentResult(request, agent, providerConfig, localText, "local", prompt, maxOutputChars, options.sources);
  }
  try {
    const text = await completeAgent(prompt, providerConfig, maxOutputChars, options.fetchImpl ?? fetch);
    return buildAgentResult(request, agent, providerConfig, text, "provider", prompt, maxOutputChars, options.sources);
  } catch (error) {
    return {
      ...buildAgentResult(request, agent, providerConfig, localText, "provider_fallback", prompt, maxOutputChars, options.sources),
      error: normalizeError(error)
    };
  }
}

export function buildAgentPrompt(request: AiAgentRunRequest, agent: AiAgentSetting): string {
  const policy = agent.contextPolicy ?? {};
  const budget = normalizeLimit(policy.maxContextChars, 8000, 1000, 30000);
  const blocks = [
    `Agent key: ${agent.key}`,
    `Agent name: ${agent.name}`,
    `Output schema: ${request.expectedOutput ?? agent.outputSchema ?? "text"}`,
    `Task:\n${request.task}`,
    request.userPrompt?.trim() ? `User prompt:\n${request.userPrompt.trim()}` : undefined,
    `Agent.md:\n${agent.agentMarkdown}`,
    request.context ? `Context JSON:\n${truncate(JSON.stringify(request.context), Math.max(1000, budget - agent.agentMarkdown.length - request.task.length))}` : undefined,
    `Tool policy:\n${JSON.stringify(agent.toolPolicy ?? {})}`,
    "Return only content that matches the requested output schema. Do not claim that CRM data was changed unless a trusted tool result in context says so."
  ].filter(Boolean);
  return truncate(blocks.join("\n\n"), budget + agent.agentMarkdown.length + 1000);
}

async function completeAgent(prompt: string, config: AiProviderConfig, maxOutputChars: number, fetchImpl: AiFetch): Promise<string> {
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
            content: "You are an AI agent harness in a private CRM. Follow the supplied Agent.md, context policy, tool policy, and output schema. Do not perform side effects."
          },
          { role: "user", content: prompt }
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
    return truncate(parseTextContent(content), maxOutputChars);
  } finally {
    clearTimeout(timeout);
  }
}

function buildAgentResult(
  request: AiAgentRunRequest,
  agent: AiAgentSetting,
  config: AiProviderConfig,
  text: string,
  generationMode: AiAgentRunResult["generationMode"],
  prompt: string,
  maxOutputChars: number,
  sources: AiAgentRunResult["sources"] = []
): AiAgentRunResult {
  const normalizedText = truncate(text.trim(), maxOutputChars);
  return {
    agentKey: agent.key,
    agentName: agent.name,
    enabled: agent.enabled,
    generationMode,
    provider: config.provider,
    model: config.model,
    text: normalizedText,
    structured: parseStructuredOutput(normalizedText),
    sources,
    budget: {
      promptChars: prompt.length,
      outputChars: normalizedText.length,
      maxOutputChars,
      truncated: normalizedText.length < text.trim().length || prompt.includes("[truncated]")
    }
  };
}

function buildLocalAgentOutput(request: AiAgentRunRequest, agent: AiAgentSetting): string {
  const contextKeys = request.context ? Object.keys(request.context).slice(0, 12).join(", ") : "none";
  return [
    `${agent.name} local fallback`,
    "",
    `Task: ${request.task}`,
    request.userPrompt ? `User prompt: ${request.userPrompt}` : "",
    `Context keys: ${contextKeys}`,
    "No provider API key is configured or this was a dry run. The harness did not modify CRM data."
  ]
    .filter(Boolean)
    .join("\n");
}

function parseTextContent(content: string): string {
  try {
    const parsed = JSON.parse(content) as { text?: unknown; answer?: unknown; result?: unknown };
    const value = parsed.text ?? parsed.answer ?? parsed.result;
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  } catch {
    // Provider may return plain text.
  }
  return content;
}

function parseStructuredOutput(text: string): Record<string, unknown> | undefined {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) return undefined;
  try {
    const parsed = JSON.parse(jsonText);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function normalizeLimit(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
}

function normalizeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 20))}\n[truncated]` : value;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
