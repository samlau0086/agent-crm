import { buildCsv } from "@/lib/crm/csv";
import type { CsvImportJob, CsvImportRowPreview } from "@/lib/crm/types";

const issueBaseHeaders = ["rowNumber", "status", "issues"];

export function buildCsvImportIssuesCsv(job: CsvImportJob): string {
  const importableHeaders = getImportableIssueHeaders(job);
  const headers = [...issueBaseHeaders, ...importableHeaders];
  const rows = (job.preview?.rows ?? [])
    .filter((row) => row.status !== "ready")
    .map((row) => buildIssueRow(row, importableHeaders));

  return buildCsv(headers, rows);
}

function getImportableIssueHeaders(job: CsvImportJob): string[] {
  const mapping = job.sourcePayload?.mapping ?? {};
  const headers = (job.preview?.headers ?? []).map((header) => mapping[header] ?? header);
  const usableHeaders = headers.filter((header) => !issueBaseHeaders.includes(header));
  return [...new Set(["title", ...usableHeaders])];
}

function buildIssueRow(row: CsvImportRowPreview, importableHeaders: string[]): Record<string, unknown> {
  const issues = [
    ...row.errors,
    ...row.conflicts.map((conflict) => `${conflict.fieldLabel} conflicts with ${conflict.existingRecordTitle} (${conflict.existingRecordId})`)
  ];
  return {
    rowNumber: row.rowNumber,
    status: row.status,
    issues: issues.join("; "),
    ...Object.fromEntries(importableHeaders.map((header) => [header, header === "title" ? row.title : row.values[header] ?? ""]))
  };
}
