import type { CrmRecord, CsvImportConflict, CsvImportJob, CsvImportRowPreview } from "@/lib/crm/types";

export interface ImportJobObservability {
  presetName?: string;
  presetId?: string;
  headers: string[];
  mappingEntries: Array<{ header: string; target: string }>;
  unmappedHeaders: string[];
  issueBuckets: Array<{ label: string; count: number }>;
  errorSamples: string[];
  conflictSamples: CsvImportConflict[];
  createdSamples: CrmRecord[];
  updatedSamples: CrmRecord[];
}

export function buildImportJobObservability(job: CsvImportJob): ImportJobObservability {
  const preview = job.preview ?? job.result?.preview;
  const created = job.result?.created ?? [];
  const updated = job.result?.updated ?? [];
  const errorSamples = job.result?.errors ?? preview?.errors ?? [];
  const conflictSamples = preview?.conflicts ?? [];
  const rows = preview?.rows ?? [];

  return {
    presetName: job.sourcePayload?.presetName,
    presetId: job.sourcePayload?.presetId,
    headers: preview?.headers ?? [],
    mappingEntries: Object.entries(job.sourcePayload?.mapping ?? {}).map(([header, target]) => ({ header, target })),
    unmappedHeaders: preview?.unmappedHeaders ?? [],
    issueBuckets: buildIssueBuckets(job, rows),
    errorSamples,
    conflictSamples,
    createdSamples: created,
    updatedSamples: updated
  };
}

function buildIssueBuckets(job: CsvImportJob, rows: CsvImportRowPreview[]): Array<{ label: string; count: number }> {
  const validationRows = rows.filter((row) => row.errors.length > 0).length;
  const conflictRows = rows.filter((row) => row.conflicts.length > 0).length;
  const buckets = [
    { label: "validation", count: validationRows },
    { label: "conflict", count: conflictRows },
    { label: "job_error", count: job.errorMessage ? 1 : 0 },
    { label: "aborted", count: job.aborted ? 1 : 0 }
  ];
  return buckets.filter((bucket) => bucket.count > 0);
}
