import { normalizeAiProviderConfig } from "@/lib/ai/provider-config";
import type { AiProviderConfig } from "@/lib/crm/types";

type AiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function createEmbedding(input: { config: Partial<AiProviderConfig>; text: string; model: string; dimensions?: number; fetchImpl?: AiFetch }): Promise<number[]> {
  const config = normalizeAiProviderConfig({ ...input.config, model: input.model });
  if (!config.apiKey) {
    throw new Error("Embedding provider API key is missing");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await (input.fetchImpl ?? fetch)(`${trimTrailingSlash(config.baseUrl)}/embeddings`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: input.model,
        input: input.text,
        ...(input.dimensions ? { dimensions: input.dimensions } : {})
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Embedding provider returned HTTP ${response.status}`);
    }
    const payload = (await response.json()) as { data?: Array<{ embedding?: unknown }> };
    const embedding = payload.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.some((value) => typeof value !== "number")) {
      throw new Error("Embedding provider returned an invalid embedding");
    }
    return embedding as number[];
  } finally {
    clearTimeout(timeout);
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
