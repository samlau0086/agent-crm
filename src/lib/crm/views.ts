import type { CrmRecord, FieldDefinition, RelationDefinition, SavedView } from "@/lib/crm/types";

export interface RelatedRecordSummary {
  record: CrmRecord;
  label: string;
}

export function matchesSavedView(record: CrmRecord, view?: SavedView): boolean {
  if (!view?.filters?.length) {
    return true;
  }

  return view.filters.every((filter) => {
    const actual = normalizeComparable(readRecordValue(record, filter.field));
    const expected = normalizeComparable(filter.value);

    if (filter.operator === "equals") {
      return actual === expected;
    }

    return actual.includes(expected);
  });
}

export function matchesRecordSearch(record: CrmRecord, query?: string): boolean {
  const normalizedQuery = normalizeComparable(query);
  if (!normalizedQuery) {
    return true;
  }

  return `${record.title} ${JSON.stringify(record.data)}`.toLowerCase().includes(normalizedQuery);
}

export function compareRecords(
  left: CrmRecord,
  right: CrmRecord,
  sort?: SavedView["sort"]
): number {
  if (!sort?.field) {
    return 0;
  }

  const leftValue = readRecordValue(left, sort.field);
  const rightValue = readRecordValue(right, sort.field);
  const direction = sort.direction === "desc" ? -1 : 1;

  if (leftValue === rightValue) {
    return left.title.localeCompare(right.title) * direction;
  }

  if (leftValue === undefined || leftValue === null || leftValue === "") {
    return 1;
  }
  if (rightValue === undefined || rightValue === null || rightValue === "") {
    return -1;
  }

  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return (leftValue - rightValue) * direction;
  }

  if (looksNumeric(leftValue) && looksNumeric(rightValue)) {
    return (Number(leftValue) - Number(rightValue)) * direction;
  }

  return normalizeComparable(leftValue).localeCompare(normalizeComparable(rightValue)) * direction;
}

export function findRelatedRecords(
  selectedRecord: CrmRecord | undefined,
  records: CrmRecord[],
  fields: FieldDefinition[],
  relations: RelationDefinition[]
): RelatedRecordSummary[] {
  if (!selectedRecord) {
    return [];
  }

  const referenceFields = fields.filter((field) => field.type === "reference");
  const related = new Map<string, RelatedRecordSummary>();

  for (const field of referenceFields.filter((item) => item.objectKey === selectedRecord.objectKey)) {
    const relatedId = selectedRecord.data[field.key];
    if (typeof relatedId !== "string") {
      continue;
    }

    const target = records.find((record) => record.id === relatedId);
    if (!target) {
      continue;
    }

    related.set(`${field.key}:${target.id}`, {
      record: target,
      label: relationLabel(relations, selectedRecord.objectKey, target.objectKey, field.label)
    });
  }

  for (const record of records) {
    if (record.id === selectedRecord.id) {
      continue;
    }

    for (const field of referenceFields.filter((item) => item.objectKey === record.objectKey)) {
      if (record.data[field.key] !== selectedRecord.id) {
        continue;
      }

      related.set(`${record.id}:${field.key}`, {
        record,
        label: relationLabel(relations, record.objectKey, selectedRecord.objectKey, field.label)
      });
    }
  }

  return Array.from(related.values()).sort((left, right) => left.record.title.localeCompare(right.record.title));
}

function relationLabel(
  relations: RelationDefinition[],
  fromObjectKey: string,
  toObjectKey: string,
  fallback: string
): string {
  return (
    relations.find((relation) => relation.fromObjectKey === fromObjectKey && relation.toObjectKey === toObjectKey)?.label ??
    relations.find((relation) => relation.fromObjectKey === toObjectKey && relation.toObjectKey === fromObjectKey)?.label ??
    fallback
  );
}

export function readRecordValue(record: CrmRecord, field: string): unknown {
  if (field === "title") {
    return record.title;
  }
  if (field === "createdAt") {
    return record.createdAt;
  }
  if (field === "updatedAt") {
    return record.updatedAt;
  }
  if (field === "stageKey") {
    return record.stageKey;
  }
  if (field === "ownerId") {
    return record.ownerId;
  }
  return record.data[field];
}

function normalizeComparable(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }
  return String(value).trim().toLowerCase();
}

function looksNumeric(value: unknown): boolean {
  if (typeof value === "number") {
    return true;
  }

  if (typeof value !== "string" || value.trim() === "") {
    return false;
  }

  return !Number.isNaN(Number(value));
}
