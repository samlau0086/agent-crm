import type { EmailThreadSearchCommand, EmailThreadSearchCommandType } from "@/lib/crm/types";

const emailSearchCommandPattern = /\/(company|contact|deal)\s*:\s*([^/]+)/i;

export function parseEmailThreadSearchCommand(input: string): EmailThreadSearchCommand | undefined {
  const match = emailSearchCommandPattern.exec(input);
  if (!match) {
    return undefined;
  }
  const type = match[1]?.toLowerCase() as EmailThreadSearchCommandType | undefined;
  const value = match[2]?.trim();
  if (!type || !value) {
    return undefined;
  }
  return { type, value };
}

export function isEmailThreadCommandSearch(input: string): boolean {
  return Boolean(parseEmailThreadSearchCommand(input));
}
