import type { KnowledgeArticle, KnowledgeEmbeddingChunk, KnowledgeVectorSettings, KnowledgeVectorStatus } from "@/lib/crm/types";

export const defaultKnowledgeVectorSettings = {
  enabled: false,
  providerProfileKey: "openai",
  embeddingModel: "text-embedding-3-small",
  dimensions: 1536,
  chunkSizeChars: 1200,
  chunkOverlapChars: 200,
  topK: 5,
  similarityThreshold: 0.25
} as const;

export function normalizeKnowledgeVectorSettings(
  workspaceId: string,
  input?: Partial<Omit<KnowledgeVectorSettings, "workspaceId" | "updatedAt">> & { updatedAt?: string }
): KnowledgeVectorSettings {
  const chunkSizeChars = normalizeInt(input?.chunkSizeChars, defaultKnowledgeVectorSettings.chunkSizeChars, 200, 8000);
  const chunkOverlapChars = Math.min(normalizeInt(input?.chunkOverlapChars, defaultKnowledgeVectorSettings.chunkOverlapChars, 0, 2000), chunkSizeChars - 1);
  return {
    workspaceId,
    enabled: input?.enabled ?? defaultKnowledgeVectorSettings.enabled,
    providerProfileKey: normalizeText(input?.providerProfileKey, defaultKnowledgeVectorSettings.providerProfileKey, 80),
    embeddingModel: normalizeText(input?.embeddingModel, defaultKnowledgeVectorSettings.embeddingModel, 160),
    dimensions: normalizeInt(input?.dimensions, defaultKnowledgeVectorSettings.dimensions, 128, 8192),
    chunkSizeChars,
    chunkOverlapChars,
    topK: normalizeInt(input?.topK, defaultKnowledgeVectorSettings.topK, 1, 20),
    similarityThreshold: normalizeNumber(input?.similarityThreshold, defaultKnowledgeVectorSettings.similarityThreshold, 0, 1),
    updatedAt: input?.updatedAt ?? new Date(0).toISOString()
  };
}

export function chunkKnowledgeArticle(article: Pick<KnowledgeArticle, "title" | "body" | "tags">, settings: Pick<KnowledgeVectorSettings, "chunkSizeChars" | "chunkOverlapChars">): string[] {
  const prefix = [article.title, article.tags.length ? `Tags: ${article.tags.join(", ")}` : ""].filter(Boolean).join("\n");
  const source = [prefix, article.body].filter(Boolean).join("\n\n").trim();
  if (!source) return [];
  const size = Math.max(200, settings.chunkSizeChars);
  const overlap = Math.max(0, Math.min(settings.chunkOverlapChars, size - 1));
  const chunks: string[] = [];
  let start = 0;
  while (start < source.length) {
    const end = Math.min(source.length, start + size);
    chunks.push(source.slice(start, end).trim());
    if (end >= source.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks.filter(Boolean);
}

export function summarizeKnowledgeVectorStatus(chunks: Array<Pick<KnowledgeEmbeddingChunk, "status" | "errorMessage" | "indexedAt" | "embeddingModel" | "dimensions" | "updatedAt">>): KnowledgeVectorStatus {
  if (chunks.length === 0) {
    return { state: "not_indexed", chunkCount: 0 };
  }
  const failed = chunks.find((chunk) => chunk.status === "failed");
  const stale = chunks.find((chunk) => chunk.status === "stale");
  const latestIndexedAt = chunks
    .map((chunk) => chunk.indexedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const latestChunk = chunks.find((chunk) => chunk.indexedAt === latestIndexedAt) ?? chunks[0];
  if (failed) {
    return {
      state: "failed",
      chunkCount: chunks.length,
      indexedAt: failed.indexedAt,
      embeddingModel: failed.embeddingModel,
      dimensions: failed.dimensions,
      errorMessage: failed.errorMessage
    };
  }
  if (stale) {
    return {
      state: "stale",
      chunkCount: chunks.length,
      indexedAt: latestIndexedAt,
      embeddingModel: latestChunk?.embeddingModel,
      dimensions: latestChunk?.dimensions
    };
  }
  return {
    state: "indexed",
    chunkCount: chunks.length,
    indexedAt: latestIndexedAt,
    embeddingModel: latestChunk?.embeddingModel,
    dimensions: latestChunk?.dimensions
  };
}

export function scoreKnowledgeArticle(article: Pick<KnowledgeArticle, "title" | "body" | "tags">, query: string): number {
  const rawTerms = query
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff@._-]+/)
    .filter((term) => term.length > 1)
    .slice(0, 80);
  const terms = Array.from(
    new Map(rawTerms.flatMap((term) => [[term, 1] as const, ...buildCjkNgrams(term).map((gram) => [gram, 0.2] as const)]))
  ).slice(0, 240);
  if (!terms.length) return 0;
  const title = article.title.toLowerCase();
  const tags = article.tags.join(" ").toLowerCase();
  const body = article.body.toLowerCase();
  return terms.reduce((total, [term, weight]) => total + ((title.includes(term) ? 8 : 0) + (tags.includes(term) ? 5 : 0) + (body.includes(term) ? 1 : 0)) * weight, 0);
}

function buildCjkNgrams(term: string): string[] {
  const chars = Array.from(term).filter((char) => /[\u4e00-\u9fff]/.test(char));
  if (chars.length < 3) return [];
  const grams: string[] = [];
  for (const size of [2, 3, 4]) {
    for (let index = 0; index <= chars.length - size; index += 1) {
      grams.push(chars.slice(index, index + size).join(""));
    }
  }
  return grams;
}

export function toPgVectorLiteral(vector: number[]): string {
  return `[${vector.map((value) => (Number.isFinite(value) ? Number(value).toFixed(8) : "0")).join(",")}]`;
}

export function normalizeVectorError(error: unknown): string {
  return error instanceof Error && error.message ? error.message.slice(0, 500) : "Vector indexing failed";
}

function normalizeInt(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(Math.max(Math.floor(numeric), min), max) : fallback;
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(Math.max(numeric, min), max) : fallback;
}

function normalizeText(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : fallback;
}
