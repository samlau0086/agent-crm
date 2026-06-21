import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson } from "@/lib/api";
import { emailAiGenerateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";
import { generateEmailAiOutput } from "@/lib/email/ai-generation";


export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, emailAiGenerateSchema);
    const repository = getCrmRepository();
    const assistantContext = await repository.buildEmailAssistantContext(context, body);
    const result = await generateEmailAiOutput({ context: assistantContext, userPrompt: body.userPrompt, sourceText: body.sourceText });
    await repository.recordEmailAiGeneration(context, {
      purpose: body.purpose,
      enabled: result.enabled,
      recordId: assistantContext.recordId ?? body.recordId,
      threadId: assistantContext.threadId ?? body.threadId,
      sourceMessageId: assistantContext.sourceMessageId ?? body.sourceMessageId,
      sourceCount: result.sources.length,
      sourceLabels: result.sources.map((source) => source.label),
      targetLocale: body.targetLocale,
      userPromptLength: body.userPrompt?.length,
      sourceTextLength: body.sourceText?.length,
      resultTextLength: result.text.length,
      contextCharCount: result.budget.contextCharCount,
      maxContextChars: result.budget.maxContextChars,
      modelPromptChars: result.budget.modelPromptChars,
      contextTruncated: result.budget.truncated,
      outputTruncated: result.budget.outputTruncated,
      generationMode: result.generationMode,
      providerError: result.providerError,
      suggestedSubjectProvided: Boolean(result.suggestedSubject)
    });
    return ok(result);
  } catch (error) {
    return handleApiError(error, request);
  }
}
