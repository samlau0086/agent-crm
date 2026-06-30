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
    if (key === "contactMethods") {
      const contactMethodSplit = splitContactMethodsApprovalValue(previousValue, nextValue);
      if (contactMethodSplit.immediateValue !== undefined) {
        immediateData[key] = contactMethodSplit.immediateValue;
      }
      if (contactMethodSplit.approvalValue !== undefined) {
        approvalData[key] = contactMethodSplit.approvalValue;
        previousData[key] = contactMethodSplit.previousValue;
      }
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
  const { previous: _previous, activity: _activity, ...recordPatch } = patch;
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

export function isContactMethodsAdditionOnly(previousValue: unknown, nextValue: unknown): boolean {
  const previousMethods = normalizeApprovalContactMethods(previousValue);
  const nextMethods = normalizeApprovalContactMethods(nextValue);
  if (previousMethods.length === 0 || nextMethods.length <= previousMethods.length) {
    return false;
  }
  const previousById = new Map(previousMethods.map((method) => [method.id, method]));
  return previousMethods.every((method) => {
    const nextMethod = previousById.has(method.id) ? nextMethods.find((candidate) => candidate.id === method.id) : undefined;
    return Boolean(nextMethod && approvalValueKey(nextMethod) === approvalValueKey(method));
  });
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

function splitContactMethodsApprovalValue(
  previousValue: unknown,
  nextValue: unknown
): { immediateValue?: unknown; approvalValue?: unknown; previousValue?: unknown } {
  const previousMethods = normalizeApprovalContactMethods(previousValue);
  const nextMethods = normalizeApprovalContactMethods(nextValue);
  if (approvalValueKey(previousMethods) === approvalValueKey(nextMethods)) {
    return {};
  }
  if (previousMethods.length === 0) {
    return { immediateValue: nextValue };
  }

  if (isContactMethodsAdditionOnly(previousValue, nextValue)) {
    return { immediateValue: nextValue };
  }

  const previousById = new Map(previousMethods.map((method) => [method.id, method]));
  const nextById = new Map(nextMethods.map((method) => [method.id, method]));
  const hasRemovedMethod = previousMethods.some((method) => !nextById.has(method.id));
  const hasChangedExistingMethod = nextMethods.some((method) => {
    const previousMethod = previousById.get(method.id);
    return Boolean(previousMethod && approvalValueKey(previousMethod) !== approvalValueKey(method));
  });
  if (hasRemovedMethod || hasChangedExistingMethod) {
    return { approvalValue: nextValue, previousValue };
  }
  return { immediateValue: nextValue };
}

function normalizeApprovalContactMethods(value: unknown): Array<Record<string, unknown> & { id: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item, index) => {
      if (!isApprovalRecord(item)) {
        return undefined;
      }
      const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : `method-${index}`;
      return { ...item, id };
    })
    .filter((method): method is Record<string, unknown> & { id: string } => Boolean(method));
}
