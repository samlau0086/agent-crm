export interface EmailAiSourceRef {
  label: string;
  recordId?: string;
  activityId?: string;
  messageId?: string;
  knowledgeArticleId?: string;
}

export function canOpenEmailAiSource(source: Pick<EmailAiSourceRef, "recordId" | "activityId" | "messageId" | "knowledgeArticleId">): boolean {
  return Boolean(source.recordId || source.activityId || source.messageId || source.knowledgeArticleId);
}

export function emailAiSourceKey(source: EmailAiSourceRef): string {
  return `${source.label}-${source.recordId ?? source.activityId ?? source.messageId ?? source.knowledgeArticleId ?? "source"}`;
}
