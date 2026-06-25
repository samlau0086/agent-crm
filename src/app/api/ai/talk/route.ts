import type { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac";
import { getRequestContext, handleApiError, ok, parseJson } from "@/lib/api";
import { aiTalkRequestSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";
import { generateAiTalkResponse, generateAiTalkSuggestion, type AiTalkSource } from "@/lib/ai/talk";
import type { Activity, CrmRecord, EmailMessage, EmailThread, FieldDefinition, KnowledgeArticle } from "@/lib/crm/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    requirePermission(context, "ai.use");
    const body = await parseJson(request, aiTalkRequestSchema);
    const repository = getCrmRepository();
    const providerConfig = await repository.getEmailAiProviderConfig(context);
    const knowledgeArticles = await repository.listKnowledgeArticles(context, true);
    const talkContext =
      body.target.type === "record"
        ? await buildRecordTalkContext(repository, context, body.target.objectKey, body.target.recordId, knowledgeArticles)
        : await buildEmailThreadTalkContext(repository, context, body.target.threadId, knowledgeArticles);

    const input = {
      question: body.question,
      history: body.history,
      ...talkContext
    };
    return ok(
      body.mode === "suggestion"
        ? await generateAiTalkSuggestion(
            {
              ...input,
              questionPrefix: body.question
            },
            { config: providerConfig }
          )
        : await generateAiTalkResponse(input, { config: providerConfig })
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}

async function buildRecordTalkContext(
  repository: ReturnType<typeof getCrmRepository>,
  context: Awaited<ReturnType<typeof getRequestContext>>,
  objectKey: string,
  recordId: string,
  knowledgeArticles: KnowledgeArticle[]
) {
  const record = await repository.getRecord(context, objectKey, recordId);
  const fields = await repository.listFieldDefinitions(context, objectKey);
  const activities = await repository.listActivities(context, record.id);
  const recordEmails = await findRecordEmailThreads(repository, context, record);
  const contextText = [
    formatRecordContext(record, fields),
    activities.length ? `Activities:\n${activities.slice(0, 10).map(formatActivityContext).join("\n")}` : "",
    recordEmails.length ? `Related email threads:\n${recordEmails.map(formatEmailThreadContext).join("\n")}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
  const sources: AiTalkSource[] = [
    { label: record.title, objectKey: record.objectKey, recordId: record.id },
    ...recordEmails.slice(0, 5).map((thread) => ({ label: thread.subject, messageId: thread.id }))
  ];
  return {
    targetLabel: record.title,
    targetType: record.objectKey,
    contextText,
    knowledgeText: formatKnowledgeContext(knowledgeArticles, `${record.title} ${record.objectKey} ${JSON.stringify(record.data)}`),
    sources
  };
}

async function buildEmailThreadTalkContext(
  repository: ReturnType<typeof getCrmRepository>,
  context: Awaited<ReturnType<typeof getRequestContext>>,
  threadId: string,
  knowledgeArticles: KnowledgeArticle[]
) {
  const thread = await repository.getEmailThread(context, threadId);
  const messages = await repository.listEmailMessages(context, thread.id);
  const linkedRecord = thread.recordId ? await findRecordById(repository, context, thread.recordId) : undefined;
  const contextText = [
    formatEmailThreadContext(thread),
    messages.length ? `Messages:\n${messages.slice(-8).map(formatEmailMessageContext).join("\n")}` : "",
    linkedRecord ? `Linked CRM record:\n${formatRecordContext(linkedRecord.record, linkedRecord.fields)}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
  const sources: AiTalkSource[] = [
    { label: thread.subject, messageId: thread.id },
    ...(linkedRecord ? [{ label: linkedRecord.record.title, objectKey: linkedRecord.record.objectKey, recordId: linkedRecord.record.id }] : [])
  ];
  return {
    targetLabel: thread.subject,
    targetType: "email_thread",
    contextText,
    knowledgeText: formatKnowledgeContext(knowledgeArticles, `${thread.subject} ${thread.participantEmails.join(" ")} ${messages.map((message) => message.bodyText).join(" ")}`),
    sources
  };
}

async function findRecordEmailThreads(repository: ReturnType<typeof getCrmRepository>, context: Awaited<ReturnType<typeof getRequestContext>>, record: CrmRecord): Promise<EmailThread[]> {
  const threads = await repository.listEmailThreads(context);
  const recordEmails = new Set(Object.values(record.data).filter((value): value is string => typeof value === "string" && value.includes("@")).map((value) => value.toLowerCase()));
  return threads
    .filter((thread) => thread.recordId === record.id || thread.participantEmails.some((email) => recordEmails.has(email.toLowerCase())))
    .slice(0, 8);
}

async function findRecordById(repository: ReturnType<typeof getCrmRepository>, context: Awaited<ReturnType<typeof getRequestContext>>, recordId: string) {
  const objects = await repository.listObjectDefinitions(context);
  for (const object of objects) {
    try {
      const record = await repository.getRecord(context, object.key, recordId);
      const fields = await repository.listFieldDefinitions(context, object.key);
      return { record, fields };
    } catch {
      // Try the next object type. Record ids are globally unique in normal operation, but this keeps the route tolerant.
    }
  }
  return undefined;
}

function formatRecordContext(record: CrmRecord, fields: FieldDefinition[]): string {
  const fieldLabels = new Map(fields.map((field) => [field.key, field.label]));
  const data = Object.entries(record.data)
    .slice(0, 60)
    .map(([key, value]) => `${fieldLabels.get(key) ?? key}: ${formatContextValue(value)}`)
    .join("; ");
  return `Record ${record.objectKey}/${record.id}: ${record.title}; owner=${record.ownerId ?? "unassigned"}; stage=${record.stageKey ?? "none"}; data=${data}`;
}

function formatActivityContext(activity: Activity): string {
  return `- ${activity.type}: ${activity.title} (${activity.dueAt ?? activity.createdAt}) ${activity.body ?? ""}`;
}

function formatEmailThreadContext(thread: EmailThread): string {
  return `- ${thread.subject}; participants=${thread.participantEmails.join(", ")}; summary=${thread.summary ?? ""}; analysis=${thread.aiAnalysis ?? ""}`;
}

function formatEmailMessageContext(message: EmailMessage): string {
  return `- ${message.direction}/${message.status}: ${message.subject}; from=${message.from}; to=${message.to.join(", ")}; body=${message.bodyText.slice(0, 1200)}`;
}

function formatKnowledgeContext(articles: KnowledgeArticle[], query: string): string {
  const terms = query.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff@._-]+/).filter((term) => term.length > 1).slice(0, 40);
  return articles
    .map((article) => ({
      article,
      score: terms.reduce((total, term) => total + (article.title.toLowerCase().includes(term) ? 3 : 0) + (article.tags.join(" ").toLowerCase().includes(term) ? 2 : 0) + (article.body.toLowerCase().includes(term) ? 1 : 0), 0)
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map(({ article }) => `${article.title} [${article.tags.join(", ")}]\n${article.body.slice(0, 1200)}`)
    .join("\n\n");
}

function formatContextValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return typeof value === "object" ? JSON.stringify(value).slice(0, 500) : String(value);
}
