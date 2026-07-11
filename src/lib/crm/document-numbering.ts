import { ApiError } from "@/lib/api-error";
import { isSalesDocumentObjectKey, salesDocumentNumberPrefixes, type SalesDocumentObjectKey } from "@/lib/crm/quotes";
import type { SalesDocumentNumberSetting } from "@/lib/crm/types";

export const salesDocumentNumberVariables = ["$Y", "$M", "$D", "$h", "$m", "$s", "$ID", "$NUM"] as const;
const variablePattern = /\$(?:NUM|ID|Y|M|D|h|m|s)/g;
const anyDollarTokenPattern = /\$[A-Za-z][A-Za-z0-9]*/g;
const maxPatternLength = 160;
const maxRenderedLength = 255;
export const salesDocumentNumberTimeZone = "Asia/Shanghai";

export function defaultSalesDocumentNumberSetting(workspaceId: string, objectKey: SalesDocumentObjectKey): SalesDocumentNumberSetting {
  return {
    workspaceId,
    objectKey,
    pattern: `${salesDocumentNumberPrefixes[objectKey]}-$Y$M-$NUM`,
    sequencePadding: 4,
    updatedAt: new Date(0).toISOString()
  };
}

export function validateSalesDocumentNumberRule(pattern: string, sequencePadding: number): void {
  const normalized = pattern.trim();
  if (!normalized) throw new ApiError(400, "VALIDATION_ERROR", "Number pattern is required");
  if (normalized.length > maxPatternLength) throw new ApiError(400, "VALIDATION_ERROR", `Number pattern cannot exceed ${maxPatternLength} characters`);
  if (!Number.isInteger(sequencePadding) || sequencePadding < 1 || sequencePadding > 12) {
    throw new ApiError(400, "VALIDATION_ERROR", "Sequence padding must be between 1 and 12");
  }
  const unknown = normalized.match(anyDollarTokenPattern)?.filter((token) => !salesDocumentNumberVariables.includes(token as (typeof salesDocumentNumberVariables)[number])) ?? [];
  if (unknown.length) throw new ApiError(400, "VALIDATION_ERROR", `Unknown number variable: ${unknown[0]}`);
  if (!normalized.includes("$NUM") && !normalized.includes("$ID")) {
    throw new ApiError(400, "VALIDATION_ERROR", "Number pattern must include $NUM or $ID to remain unique");
  }
  renderSalesDocumentNumber(normalized, sequencePadding, { now: new Date(), recordId: "record-preview", sequence: 1 });
}

export function salesDocumentLocalParts(now: Date): Record<"Y" | "M" | "D" | "h" | "m" | "s", string> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: salesDocumentNumberTimeZone,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { Y: value("year"), M: value("month"), D: value("day"), h: value("hour"), m: value("minute"), s: value("second") };
}

export function salesDocumentLocalDate(now: Date): string {
  const parts = salesDocumentLocalParts(now);
  return `${parts.Y}-${parts.M}-${parts.D}`;
}

export function renderSalesDocumentNumber(
  pattern: string,
  sequencePadding: number,
  input: { now: Date; recordId: string; sequence: number | string }
): string {
  const parts = salesDocumentLocalParts(input.now);
  const sequence = typeof input.sequence === "number" ? String(input.sequence).padStart(sequencePadding, "0") : input.sequence;
  const values: Record<string, string> = { $Y: parts.Y, $M: parts.M, $D: parts.D, $h: parts.h, $m: parts.m, $s: parts.s, $ID: input.recordId, $NUM: sequence };
  const rendered = pattern.replace(variablePattern, (token) => values[token] ?? token);
  if (rendered.length > maxRenderedLength) throw new ApiError(400, "VALIDATION_ERROR", `Generated number cannot exceed ${maxRenderedLength} characters`);
  return rendered;
}

export function previewSalesDocumentNumber(setting: SalesDocumentNumberSetting, now = new Date()): string {
  return renderSalesDocumentNumber(setting.pattern, setting.sequencePadding, { now, recordId: "<保存后分配ID>", sequence: "<保存时序号>" });
}

export function assertSalesDocumentObjectKey(value: string): asserts value is SalesDocumentObjectKey {
  if (!isSalesDocumentObjectKey(value)) throw new ApiError(400, "VALIDATION_ERROR", "Unsupported sales document type");
}
