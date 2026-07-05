CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "KnowledgeVectorSettings" (
  "workspaceId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "providerProfileKey" TEXT NOT NULL DEFAULT 'openai',
  "embeddingModel" TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  "dimensions" INTEGER NOT NULL DEFAULT 1536,
  "chunkSizeChars" INTEGER NOT NULL DEFAULT 1200,
  "chunkOverlapChars" INTEGER NOT NULL DEFAULT 200,
  "topK" INTEGER NOT NULL DEFAULT 5,
  "similarityThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeVectorSettings_pkey" PRIMARY KEY ("workspaceId"),
  CONSTRAINT "KnowledgeVectorSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "KnowledgeEmbeddingChunk" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "articleId" TEXT NOT NULL,
  "chunkIndex" INTEGER NOT NULL,
  "chunkText" TEXT NOT NULL,
  "embedding" vector,
  "embeddingModel" TEXT NOT NULL,
  "dimensions" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'indexed',
  "errorMessage" TEXT,
  "indexedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeEmbeddingChunk_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeEmbeddingChunk_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeEmbeddingChunk_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KnowledgeArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "KnowledgeEmbeddingChunk_articleId_chunkIndex_key" ON "KnowledgeEmbeddingChunk"("articleId", "chunkIndex");
CREATE INDEX "KnowledgeEmbeddingChunk_workspaceId_articleId_idx" ON "KnowledgeEmbeddingChunk"("workspaceId", "articleId");
CREATE INDEX "KnowledgeEmbeddingChunk_workspaceId_status_updatedAt_idx" ON "KnowledgeEmbeddingChunk"("workspaceId", "status", "updatedAt");
