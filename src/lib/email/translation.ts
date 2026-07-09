import type { AiAgentSetting, AiProviderConfig, EmailAiGenerationAuditInput, EmailAiSettings, EmailMessage, RequestContext } from "@/lib/crm/types";
import type { EmailAssistantContext } from "@/lib/email/assistant";
import { generateEmailAiOutput } from "@/lib/email/ai-generation";
import { getGlobalAiAgentSetting } from "@/lib/ai/agents";

export interface EmailTranslateJobPayload {
  messageId: string;
  targetLocale?: string;
}

interface EmailTranslateRepository {
  getEmailMessage(context: RequestContext, messageId: string): EmailMessage | Promise<EmailMessage>;
  getEmailAiSettings(context: RequestContext): EmailAiSettings | Promise<EmailAiSettings>;
  getEmailAiProviderConfig(context: RequestContext): AiProviderConfig | Promise<AiProviderConfig>;
  getAiProviderConfigForAgent(context: RequestContext, agent: AiAgentSetting): AiProviderConfig | Promise<AiProviderConfig>;
  buildEmailAssistantContext(
    context: RequestContext,
    input: { purpose: "translate"; threadId: string; sourceMessageId: string; targetLocale: string }
  ): EmailAssistantContext | Promise<EmailAssistantContext>;
  recordEmailAiGeneration(context: RequestContext, input: EmailAiGenerationAuditInput): void | Promise<void>;
  updateEmailMessageTranslation(context: RequestContext, messageId: string, text: string, locale: string, sources?: EmailMessage["translatedSources"]): EmailMessage | Promise<EmailMessage>;
}

export async function translateEmailMessage(
  context: RequestContext,
  repository: EmailTranslateRepository,
  payload: EmailTranslateJobPayload
): Promise<EmailMessage> {
  const message = await repository.getEmailMessage(context, payload.messageId);
  const settings = await repository.getEmailAiSettings(context);
  const targetLocale = payload.targetLocale ?? settings.defaultLocale;
  if (message.translatedBodyText && message.translatedLocale === targetLocale) {
    return message;
  }

  const assistantContext = await repository.buildEmailAssistantContext(context, {
    purpose: "translate",
    threadId: message.threadId,
    sourceMessageId: message.id,
    targetLocale
  });
  const agent = assistantContext.agentKey ? getGlobalAiAgentSetting(settings, assistantContext.agentKey) : undefined;
  const providerConfig = agent ? await repository.getAiProviderConfigForAgent(context, agent) : await repository.getEmailAiProviderConfig(context);
  const result = await generateEmailAiOutput({ context: assistantContext, sourceText: message.bodyText }, { config: providerConfig });
  const persisted = result.enabled && result.generationMode === "provider";
  await repository.recordEmailAiGeneration(context, {
    purpose: "translate",
    enabled: result.enabled,
    recordId: result.recordId,
    threadId: result.threadId ?? message.threadId,
    sourceMessageId: result.sourceMessageId ?? message.id,
    sourceCount: result.sources.length,
    sourceLabels: result.sources.map((source) => source.label),
    targetLocale,
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
  if (!persisted) {
    return message;
  }
  return repository.updateEmailMessageTranslation(context, message.id, result.text, targetLocale, result.sources);
}
