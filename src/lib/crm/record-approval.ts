import type { CrmRecord, RecordChangeRequest } from "@/lib/crm/types";

export type RecordApprovalPatch = Partial<Pick<CrmRecord, "title" | "data" | "stageKey" | "ownerId">>;

export function splitRecordApprovalPatch(record: CrmRecord, patch: RecordApprovalPatch): {
  approvalPatch: RecordApprovalPatch;
  immediatePatch: RecordApprovalPatch;
  previousPatch: RecordApprovalPatch;
} {
  const approvalPatch: RecordApprovalPatch = {};
  const immediatePatch: RecordApprovalPatch = {};
  const previousPatch: RecordApprovalPatch = {};

  splitScalarApprovalValue("title", record.title, patch.title, approvalPatch, immediatePatch, previousPatch);
  splitScalarApprovalValue("stageKey", record.stageKey, patch.stageKey, approvalPatch, immediatePatch, previousPatch);
  splitScalarApprovalValue("ownerId", record.ownerId, patch.ownerId, approvalPatch, immediatePatch, previousPatch);

  const approvalData: Record<string, unknown> = {};
  const immediateData: Record<string, unknown> = {};
  const previousData: Record<string, unknown> = {};
  const patchData = isApprovalRecord(patch.data) ? patch.data : {};
  for (const [key, nextValue] of Object.entries(patchData)) {
    const previousValue = record.data[key];
    if (approvalValueKey(previousValue) === approvalValueKey(nextValue)) {
      continue;
    }
    if (isEmptyApprovalValue(previousValue)) {
      immediateData[key] = nextValue;
    } else {
      approvalData[key] = nextValue;
      previousData[key] = previousValue;
    }
  }
  if (Object.keys(approvalData).length > 0) {
    approvalPatch.data = approvalData;
    previousPatch.data = previousData;
  }
  if (Object.keys(immediateData).length > 0) {
    immediatePatch.data = immediateData;
  }

  return { approvalPatch, immediatePatch, previousPatch };
}

export function hasRecordPatchChanges(patch: RecordApprovalPatch | undefined): boolean {
  if (!patch) return false;
  return (
    Object.prototype.hasOwnProperty.call(patch, "title") ||
    Object.prototype.hasOwnProperty.call(patch, "stageKey") ||
    Object.prototype.hasOwnProperty.call(patch, "ownerId") ||
    (isApprovalRecord(patch.data) && Object.keys(patch.data).length > 0)
  );
}

export function stripRecordApprovalMetadata(patch: RecordChangeRequest["patch"] | undefined): RecordApprovalPatch {
  if (!patch) return {};
  const { previous: _previous, ...recordPatch } = patch;
  return recordPatch;
}

export function previousRecordApprovalPatch(patch: RecordChangeRequest["patch"] | undefined): RecordApprovalPatch {
  return isApprovalRecord(patch?.previous) ? patch.previous : {};
}

export function isEmptyApprovalValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isApprovalRecord(value)) return Object.keys(value).length === 0;
  return false;
}

function splitScalarApprovalValue(
  key: "title" | "stageKey" | "ownerId",
  previousValue: unknown,
  nextValue: unknown,
  approvalPatch: RecordApprovalPatch,
  immediatePatch: RecordApprovalPatch,
  previousPatch: RecordApprovalPatch
): void {
  if (nextValue === undefined || approvalValueKey(previousValue) === approvalValueKey(nextValue)) {
    return;
  }
  if (isEmptyApprovalValue(previousValue)) {
    immediatePatch[key] = nextValue as string | undefined;
    return;
  }
  approvalPatch[key] = nextValue as string | undefined;
  previousPatch[key] = previousValue as string | undefined;
}

function approvalValueKey(value: unknown): string {
  if (isEmptyApprovalValue(value)) return "";
  if (Array.isArray(value) || typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function isApprovalRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
