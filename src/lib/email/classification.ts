import type { AiAgentSetting, AiProviderConfig, EmailAiGenerationAuditInput, EmailAiSettings, EmailMessage, EmailThread, RequestContext } from "@/lib/crm/types";
import { getGlobalAiAgentSetting } from "@/lib/ai/agents";
import type { EmailAssistantContext } from "@/lib/email/assistant";
import { generateEmailAiOutput, type EmailAiGenerateResult } from "@/lib/email/ai-generation";

export type EmailThreadCategory = NonNullable<EmailThread["category"]>;

export interface EmailClassifyJobPayload {
  messageId: string;
}

export interface EmailClassifyResult {
  updated: boolean;
  queued?: boolean;
  category?: EmailThreadCategory;
  thread?: EmailThread;
  result: EmailAiGenerateResult;
}

interface EmailClassifyRepository {
  getEmailMessage(context: RequestContext, messageId: string): EmailMessage | Promise<EmailMessage>;
  getEmailAiSettings(context: RequestContext): EmailAiSettings | Promise<EmailAiSettings>;
  getEmailAiProviderConfig(context: RequestContext): AiProviderConfig | Promise<AiProviderConfig>;
  getAiProviderConfigForAgent(context: RequestContext, agent: AiAgentSetting): AiProviderConfig | Promise<AiProviderConfig>;
  buildEmailAssistantContext(
    context: RequestContext,
    input: { purpose: "classification"; threadId: string; sourceMessageId: string; sourceText?: string }
  ): EmailAssistantContext | Promise<EmailAssistantContext>;
  recordEmailAiGeneration(context: RequestContext, input: EmailAiGenerationAuditInput): void | Promise<void>;
  updateEmailThreadState(context: RequestContext, threadId: string, input: { category: EmailThreadCategory }): EmailThread | Promise<EmailThread>;
}

export async function classifyEmailMessageWithAi(
  context: RequestContext,
  repository: EmailClassifyRepository,
  payload: EmailClassifyJobPayload
): Promise<EmailClassifyResult> {
  const message = await repository.getEmailMessage(context, payload.messageId);
  const assistantContext = await repository.buildEmailAssistantContext(context, {
    purpose: "classification",
    threadId: message.threadId,
    sourceMessageId: message.id,
    sourceText: message.bodyText
  });
  const settings = await repository.getEmailAiSettings(context);
  const agent = assistantContext.agentKey ? getGlobalAiAgentSetting(settings, assistantContext.agentKey) : undefined;
  const providerConfig = agent ? await repository.getAiProviderConfigForAgent(context, agent) : await repository.getEmailAiProviderConfig(context);
  const result = await generateEmailAiOutput(
    {
      context: assistantContext,
      userPrompt: "Return exactly one category token: primary, promotions, social, or updates.",
      sourceText: message.bodyText
    },
    { config: providerConfig }
  );
  const category = result.generationMode === "provider" ? parseEmailThreadCategory(result.text) : undefined;
  const persisted = Boolean(result.enabled && category);
  await repository.recordEmailAiGeneration(context, {
    purpose: "classification",
    enabled: result.enabled,
    recordId: result.recordId,
    threadId: result.threadId ?? message.threadId,
    sourceMessageId: result.sourceMessageId ?? message.id,
    sourceCount: result.sources.length,
    sourceLabels: result.sources.map((source) => source.label),
    sourceTextLength: message.bodyText.length,
    resultTextLength: result.text.length,
    contextCharCount: result.budget.contextCharCount,
    maxContextChars: result.budget.maxContextChars,
    modelPromptChars: result.budget.modelPromptChars,
    contextTruncated: result.budget.truncated,
    outputTruncated: result.budget.outputTruncated,
    generationMode: result.generationMode,
    providerError: result.providerError,
    persisted
  });

  if (!persisted || !category) {
    return { updated: false, category, result };
  }

  const thread = await repository.updateEmailThreadState(context, message.threadId, { category });
  return { updated: true, category, thread, result };
}

export function parseEmailThreadCategory(value: string): EmailThreadCategory | undefined {
  const normalized = value.trim().toLowerCase().match(/\b(primary|promotions|social|updates)\b/)?.[1];
  return normalized === "primary" || normalized === "promotions" || normalized === "social" || normalized === "updates" ? normalized : undefined;
}
