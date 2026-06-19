const blockedIntentPatterns = [
  /\b(delete|remove|update|edit|change|create|insert|write|move|assign)\b/i,
  /\u5220\u9664|\u79fb\u9664|\u4fee\u6539|\u66f4\u65b0|\u6539\u6210|\u521b\u5efa|\u65b0\u589e|\u5199\u5165|\u63a8\u8fdb|\u79fb\u52a8\u9636\u6bb5|\u5206\u914d|\u8f6c\u79fb/
];

export function assertReadOnlyAiQuestion(question: string): void {
  if (blockedIntentPatterns.some((pattern) => pattern.test(question))) {
    throw new Error("AI query is read-only. Use CRM forms or APIs for changes.");
  }
}
