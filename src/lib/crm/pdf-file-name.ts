import { ApiError } from "@/lib/api-error";
import { salesDocumentLocalParts } from "@/lib/crm/document-numbering";

export const pdfFileNameVariables = ["$Y", "$M", "$D", "$h", "$m", "$s", "$ID", "$NUM"] as const;
const variablePattern = /\$(?:NUM|ID|Y|M|D|h|m|s)/g;
const anyDollarTokenPattern = /\$[A-Za-z][A-Za-z0-9]*/g;
const maxPatternLength = 160;

export function validatePdfFileNamePattern(pattern: string): void {
  const normalized = pattern.trim();
  if (!normalized) throw new ApiError(400, "VALIDATION_ERROR", "PDF file name pattern is required");
  if (normalized.length > maxPatternLength) throw new ApiError(400, "VALIDATION_ERROR", `PDF file name pattern cannot exceed ${maxPatternLength} characters`);
  const unknown = normalized.match(anyDollarTokenPattern)?.filter((token) => !pdfFileNameVariables.includes(token as (typeof pdfFileNameVariables)[number])) ?? [];
  if (unknown.length) throw new ApiError(400, "VALIDATION_ERROR", `Unknown PDF file name variable: ${unknown[0]}`);
  if (!normalized.includes("$NUM")) throw new ApiError(400, "VALIDATION_ERROR", "PDF file name pattern must include $NUM");
}

export function renderPdfFileName(pattern: string, input: { now?: Date; recordId: string; documentNumber: string }): string {
  validatePdfFileNamePattern(pattern);
  const parts = salesDocumentLocalParts(input.now ?? new Date());
  const values: Record<string, string> = {
    $Y: parts.Y, $M: parts.M, $D: parts.D, $h: parts.h, $m: parts.m, $s: parts.s,
    $ID: input.recordId, $NUM: input.documentNumber
  };
  const baseName = pattern.trim().replace(variablePattern, (token) => values[token] ?? token)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 240);
  if (!baseName) throw new ApiError(400, "VALIDATION_ERROR", "PDF file name pattern renders an empty file name");
  return `${baseName}.pdf`;
}

export function previewPdfFileName(pattern: string, now = new Date()): string {
  return renderPdfFileName(pattern, { now, recordId: "record-id", documentNumber: "QT-202607-0001" });
}
