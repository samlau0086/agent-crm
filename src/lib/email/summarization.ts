import type { Activity, AiAgentSetting, AiProviderConfig, EmailAiGenerationAuditInput, EmailAiSettings, EmailThread, RequestContext } from "@/lib/crm/types";
import type { EmailAssistantContext } from "@/lib/email/assistant";
import { generateEmailAiOutput, type EmailAiGenerateResult } from "@/lib/email/ai-generation";
import { getGlobalAiAgentSetting } from "@/lib/ai/agents";

export interface EmailSummarizeJobPayload {
  threadId: string;
}

export interface EmailSummarizeResult {
  updated: boolean;
  queued?: boolean;
  thread?: EmailThread;
  result: EmailAiGenerateResult;
}

interface EmailSummarizeRepository {
  getEmailAiSettings(context: RequestContext): EmailAiSettings | Promise<EmailAiSettings>;
  getEmailAiProviderConfig(context: RequestContext): AiProviderConfig | Promise<AiProviderConfig>;
  getAiProviderConfigForAgent(context: RequestContext, agent: AiAgentSetting): AiProviderConfig | Promise<AiProviderConfig>;
  buildEmailAssistantContext(
    context: RequestContext,
    input: { purpose: "summarize"; threadId: string }
  ): EmailAssistantContext | Promise<EmailAssistantContext>;
  recordEmailAiGeneration(context: RequestContext, input: EmailAiGenerationAuditInput): void | Promise<void>;
  updateEmailThreadSummary(context: RequestContext, threadId: string, summary: string): EmailThread | Promise<EmailThread>;
  createActivity?(
    context: RequestContext,
    input: Omit<Activity, "id" | "workspaceId" | "createdAt" | "actorId">
  ): Activity | Promise<Activity>;
}

export async function summarizeEmailThreadWithAi(
  context: RequestContext,
  repository: EmailSummarizeRepository,
  payload: EmailSummarizeJobPayload
): Promise<EmailSummarizeResult> {
  const assistantContext = await repository.buildEmailAssistantContext(context, {
    purpose: "summarize",
    threadId: payload.threadId
  });
  const settings = await repository.getEmailAiSettings(context);
  const agent = assistantContext.agentKey ? getGlobalAiAgentSetting(settings, assistantContext.agentKey) : undefined;
  const providerConfig = agent ? await repository.getAiProviderConfigForAgent(context, agent) : await repository.getEmailAiProviderConfig(context);
  const result = await generateEmailAiOutput({ context: assistantContext }, { config: providerConfig });
  await repository.recordEmailAiGeneration(context, {
    purpose: "summarize",
    enabled: result.enabled,
    recordId: result.recordId,
    threadId: result.threadId ?? payload.threadId,
    sourceMessageId: result.sourceMessageId,
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

  const thread = await repository.updateEmailThreadSummary(context, payload.threadId, result.text);
  if (thread.recordId && repository.createActivity) {
    await repository.createActivity(context, {
      recordId: thread.recordId,
      type: "email",
      title: `AI 邮件跟进摘要：${thread.subject}`,
      body: `跟进目的 / Compact 摘要:\n${result.text}`
    });
  }
  return { updated: true, thread, result };
}
