import type { EmailAiGenerationAuditInput, EmailThread, RequestContext } from "@/lib/crm/types";
import type { EmailAssistantContext } from "@/lib/email/assistant";
import { generateEmailAiOutput, type EmailAiGenerateResult } from "@/lib/email/ai-generation";

export interface EmailAnalyzeJobPayload {
  threadId: string;
  sourceMessageId?: string;
}

export interface EmailAnalyzeResult {
  updated: boolean;
  queued?: boolean;
  thread?: EmailThread;
  result: EmailAiGenerateResult;
}

interface EmailAnalyzeRepository {
  buildEmailAssistantContext(
    context: RequestContext,
    input: { purpose: "context_analysis"; threadId: string; sourceMessageId?: string }
  ): EmailAssistantContext | Promise<EmailAssistantContext>;
  recordEmailAiGeneration(context: RequestContext, input: EmailAiGenerationAuditInput): void | Promise<void>;
  updateEmailThreadAnalysis(context: RequestContext, threadId: string, analysis: string, sources?: EmailThread["aiAnalysisSources"]): EmailThread | Promise<EmailThread>;
}

export async function analyzeEmailThreadWithAi(
  context: RequestContext,
  repository: EmailAnalyzeRepository,
  payload: EmailAnalyzeJobPayload
): Promise<EmailAnalyzeResult> {
  const assistantContext = await repository.buildEmailAssistantContext(context, {
    purpose: "context_analysis",
    threadId: payload.threadId,
    sourceMessageId: payload.sourceMessageId
  });
  const result = await generateEmailAiOutput({
    context: assistantContext,
    userPrompt: "Analyze this email thread and suggest the next sales action. Do not change CRM data."
  });
  await repository.recordEmailAiGeneration(context, {
    purpose: "context_analysis",
    enabled: result.enabled,
    recordId: result.recordId,
    threadId: result.threadId ?? payload.threadId,
    sourceMessageId: result.sourceMessageId ?? payload.sourceMessageId,
    sourceCount: result.sources.length,
    sourceLabels: result.sources.map((source) => source.label),
    resultTextLength: result.text.length,
    contextCharCount: result.budget.contextCharCount,
    maxContextChars: result.budget.maxContextChars,
    modelPromptChars: result.budget.modelPromptChars,
    contextTruncated: result.budget.truncated,
    outputTruncated: result.budget.outputTruncated,
    generationMode: result.generationMode,
    providerError: result.providerError
  });
  if (!result.enabled) {
    return { updated: false, result };
  }

  const thread = await repository.updateEmailThreadAnalysis(context, payload.threadId, result.text, result.sources);
  return { updated: true, thread, result };
}
