import type { CrmRecord, FieldDefinition, FieldType } from "@/lib/crm/types";

const fieldTypes = new Set<FieldType>([
  "text",
  "textarea",
  "number",
  "currency",
  "date",
  "select",
  "boolean",
  "user",
  "reference"
]);

export function assertValidFieldDefinition(field: Pick<FieldDefinition, "key" | "label" | "type" | "options">): void {
  if (!/^[a-z][a-zA-Z0-9_]*$/.test(field.key)) {
    throw new Error("字段 key 必须以小写字母开头，并且只能包含字母、数字和下划线");
  }

  if (!field.label.trim()) {
    throw new Error("字段名称不能为空");
  }

  if (!fieldTypes.has(field.type)) {
    throw new Error(`不支持的字段类型: ${field.type}`);
  }

  if ((field.type === "select" || field.type === "reference") && (!field.options || field.options.length === 0)) {
    throw new Error("枚举字段必须提供 options");
  }
}

export function validateRecordPayload(
  fields: FieldDefinition[],
  payload: Record<string, unknown>,
  existingRecords: CrmRecord[],
  currentRecordId?: string
): void {
  for (const field of fields) {
    const value = payload[field.key];

    if (field.required && (value === undefined || value === null || value === "")) {
      throw new Error(`${field.label} 为必填字段`);
    }

    if (value === undefined || value === null || value === "") {
      continue;
    }

    validateFieldValue(field, value);

    if (field.unique) {
      const duplicate = existingRecords.find((record) => record.id !== currentRecordId && record.data[field.key] === value);
      if (duplicate) {
        throw new Error(`${field.label} 必须唯一`);
      }
    }
  }
}

function validateFieldValue(field: FieldDefinition, value: unknown): void {
  if ((field.type === "number" || field.type === "currency") && typeof value !== "number") {
    throw new Error(`${field.label} 必须是数字`);
  }

  if (field.type === "boolean" && typeof value !== "boolean") {
    throw new Error(`${field.label} 必须是布尔值`);
  }

  if (field.type === "date" && typeof value === "string" && Number.isNaN(Date.parse(value))) {
    throw new Error(`${field.label} 必须是有效日期`);
  }

  if (field.type === "select") {
    const allowed = new Set((field.options ?? []).map((option) => option.value));
    if (typeof value !== "string" || !allowed.has(value)) {
      throw new Error(`${field.label} 不在允许的选项中`);
    }
  }

  if ((field.type === "reference" || field.type === "user") && typeof value !== "string") {
    throw new Error(`${field.label} 必须是有效引用`);
  }
}
