import type { FieldDefinition, ObjectDefinition, RecordListQuery, RecordSort } from "@/lib/crm/types";

export interface AiQueryPlan {
  objectKeys: string[];
  queries: Record<string, RecordListQuery>;
  reason: string;
}

interface BuildAiQueryPlanInput {
  question: string;
  objectDefinitions: ObjectDefinition[];
  fields: FieldDefinition[];
  objectKey?: string;
  maxObjects?: number;
  pageSize?: number;
}

const DEFAULT_MAX_OBJECTS = 4;
const DEFAULT_PAGE_SIZE = 25;
const MAX_QUESTION_LENGTH = 200;
const STANDARD_SORT_FIELDS = new Set(["title", "stageKey", "createdAt", "updatedAt", "ownerId"]);
const QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "amount",
  "by",
  "deal",
  "deals",
  "find",
  "for",
  "high",
  "highest",
  "large",
  "largest",
  "list",
  "me",
  "opportunities",
  "opportunity",
  "recent",
  "show",
  "the",
  "top",
  "value",
  "with"
]);
const OBJECT_SYNONYMS: Record<string, string[]> = {
  contacts: ["contact", "contacts", "person", "people", "\u8054\u7cfb\u4eba", "\u5ba2\u6237", "\u7ebf\u7d22"],
  companies: ["company", "companies", "account", "accounts", "\u516c\u53f8", "\u5ba2\u6237\u516c\u53f8"],
  deals: ["deal", "deals", "opportunity", "opportunities", "\u4ea4\u6613", "\u673a\u4f1a", "\u9500\u552e\u673a\u4f1a"],
  tasks: ["task", "tasks", "\u4efb\u52a1", "\u5f85\u529e"],
  activities: ["activity", "activities", "\u6d3b\u52a8", "\u8ddf\u8fdb"]
};

export function buildAiQueryPlan(input: BuildAiQueryPlanInput): AiQueryPlan {
  const question = sanitizeQuestion(input.question);
  const maxObjects = clampInteger(input.maxObjects ?? DEFAULT_MAX_OBJECTS, 1, DEFAULT_MAX_OBJECTS);
  const pageSize = clampInteger(input.pageSize ?? DEFAULT_PAGE_SIZE, 1, DEFAULT_PAGE_SIZE);
  const availableObjects = input.objectDefinitions.map((object) => object.key);
  const objectKeys = input.objectKey
    ? [input.objectKey]
    : rankObjectKeys(question, input.objectDefinitions, input.fields).slice(0, maxObjects);

  const safeObjectKeys = objectKeys.filter((objectKey) => availableObjects.includes(objectKey));
  if (safeObjectKeys.length === 0) {
    throw new Error("AI query plan does not target an available object");
  }

  const queries = Object.fromEntries(
    safeObjectKeys.map((objectKey) => [
      objectKey,
      validateObjectQuery(objectKey, {
        page: 1,
        pageSize,
        q: searchTextFromQuestion(question) || undefined,
        filters: fieldFiltersFromQuestion(question, objectKey, input.fields),
        sort: sortFromQuestion(question, objectKey, input.fields)
      }, input.fields, pageSize)
    ])
  );

  return {
    objectKeys: safeObjectKeys,
    queries,
    reason: input.objectKey ? "explicit-object" : "local-controlled-plan"
  };
}

export function validateAiQueryPlan(
  plan: AiQueryPlan,
  definitions: ObjectDefinition[],
  fields: FieldDefinition[],
  pageSize = DEFAULT_PAGE_SIZE
): AiQueryPlan {
  const availableObjects = new Set(definitions.map((object) => object.key));
  const objectKeys = plan.objectKeys.filter((objectKey) => availableObjects.has(objectKey)).slice(0, DEFAULT_MAX_OBJECTS);
  if (objectKeys.length === 0) {
    throw new Error("AI query plan does not target an available object");
  }

  return {
    objectKeys,
    queries: Object.fromEntries(
      objectKeys.map((objectKey) => [
        objectKey,
        validateObjectQuery(objectKey, plan.queries[objectKey] ?? {}, fields, pageSize)
      ])
    ),
    reason: plan.reason || "validated-plan"
  };
}

function validateObjectQuery(objectKey: string, query: RecordListQuery, fields: FieldDefinition[], pageSize: number): RecordListQuery {
  const allowedFields = allowedQueryFields(objectKey, fields);
  const filters = query.filters
    ?.filter((filter) => allowedFields.has(filter.field))
    .filter((filter) => filter.operator === "contains" || filter.operator === "equals")
    .map((filter) => ({
      field: filter.field,
      operator: filter.operator,
      value: String(filter.value).trim().slice(0, MAX_QUESTION_LENGTH)
    }))
    .filter((filter) => filter.value);
  const sort = normalizeSort(query.sort, allowedFields);

  return {
    page: 1,
    pageSize: clampInteger(query.pageSize ?? pageSize, 1, pageSize),
    q: sanitizeQuestion(query.q ?? ""),
    filters: filters && filters.length > 0 ? filters : undefined,
    sort
  };
}

function rankObjectKeys(question: string, definitions: ObjectDefinition[], fields: FieldDefinition[]): string[] {
  const scored = definitions.map((object, index) => {
    let score = 0;
    const terms = [
      object.key,
      object.label,
      object.pluralLabel,
      ...(OBJECT_SYNONYMS[object.key] ?? [])
    ].map(normalizeText);
    if (terms.some((term) => term && normalizeText(question).includes(term))) {
      score += 10;
    }
    if (hasAmountIntent(question) && fields.some((field) => field.objectKey === object.key && isNumericField(field))) {
      score += 6;
    }
    return { key: object.key, score, index };
  });

  const sorted = scored.sort((left, right) => right.score - left.score || left.index - right.index);
  const targeted = sorted.filter((item) => item.score > 0);
  return (targeted.length > 0 ? targeted : sorted).map((item) => item.key);
}

function fieldFiltersFromQuestion(question: string, objectKey: string, fields: FieldDefinition[]) {
  const normalizedQuestion = normalizeText(question);
  const fieldFilters = fields
    .filter((field) => field.objectKey === objectKey)
    .flatMap((field) => {
      const optionAliases = field.options?.flatMap((option) => [option.label, option.value]) ?? [];
      const aliases = [field.key, field.label, ...optionAliases].map(normalizeText);
      if (!aliases.some((alias) => alias && normalizedQuestion.includes(alias))) {
        return [];
      }
      const value = extractLikelyFieldValue(question, field);
      return value ? [{ field: field.key, operator: "contains" as const, value }] : [];
    });

  return fieldFilters.length > 0 ? fieldFilters.slice(0, 3) : undefined;
}

function sortFromQuestion(question: string, objectKey: string, fields: FieldDefinition[]): RecordSort | undefined {
  const objectFields = fields.filter((field) => field.objectKey === objectKey);
  if (hasRecentIntent(question)) {
    return { field: "updatedAt", direction: "desc" };
  }

  if (hasAmountIntent(question)) {
    const amountField =
      objectFields.find((field) => field.key === "amount") ??
      objectFields.find((field) => isNumericField(field));
    if (amountField) {
      return { field: amountField.key, direction: "desc" };
    }
  }

  return undefined;
}

function normalizeSort(sort: RecordSort | undefined, allowedFields: Set<string>): RecordSort | undefined {
  if (!sort || !allowedFields.has(sort.field)) {
    return undefined;
  }
  return {
    field: sort.field,
    direction: sort.direction === "asc" ? "asc" : "desc"
  };
}

function allowedQueryFields(objectKey: string, fields: FieldDefinition[]): Set<string> {
  return new Set([
    ...STANDARD_SORT_FIELDS,
    ...fields.filter((field) => field.objectKey === objectKey).map((field) => field.key)
  ]);
}

function extractLikelyFieldValue(question: string, field: FieldDefinition): string | undefined {
  if (isNumericField(field)) {
    return question.match(/-?\d+(?:\.\d+)?/)?.[0];
  }

  if (field.type === "date" || field.type === "boolean") {
    return undefined;
  }

  if (field.key.toLowerCase().includes("email")) {
    return question.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  }

  const quoted = question.match(/["'“”‘’]([^"'“”‘’]{2,80})["'“”‘’]/)?.[1];
  if (quoted) {
    return quoted.trim();
  }

  const tokens = question.match(/[\p{L}\p{N}._@+-]{2,80}/gu) ?? [];
  return tokens.find((token) => normalizeText(token) !== normalizeText(field.key) && !isQueryIntentToken(token));
}

function searchTextFromQuestion(question: string): string {
  const quoted = question.match(/["'“”‘’]([^"'“”‘’]{2,80})["'“”‘’]/)?.[1];
  if (quoted) {
    return sanitizeQuestion(quoted);
  }

  const tokens = question.match(/[\p{L}\p{N}._@+-]{2,80}/gu) ?? [];
  const usefulTokens = tokens.filter((token) => !isQueryIntentToken(token));
  return sanitizeQuestion(usefulTokens.join(" "));
}

function isQueryIntentToken(token: string): boolean {
  const normalized = normalizeText(token);
  return (
    QUERY_STOP_WORDS.has(normalized) ||
    Object.values(OBJECT_SYNONYMS).some((terms) => terms.map(normalizeText).includes(normalized)) ||
    /金额|高金额|最大|最高|收入|大单|交易|机会|最近|最新|查询|查找|显示|列出/.test(token)
  );
}

function hasAmountIntent(question: string): boolean {
  return /\b(amount|revenue|value|high|highest|largest|top)\b/i.test(question) || /金额|高金额|最大|最高|收入|大单/.test(question);
}

function hasRecentIntent(question: string): boolean {
  return /\b(recent|latest|newest|updated)\b/i.test(question) || /最近|最新|刚更新/.test(question);
}

function isNumericField(field: FieldDefinition): boolean {
  return field.type === "currency" || field.type === "number";
}

function sanitizeQuestion(question: string): string {
  return question.trim().replace(/\s+/g, " ").slice(0, MAX_QUESTION_LENGTH);
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(Number.isFinite(value) ? value : min)));
}
