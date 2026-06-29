import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api-error";
import { recordFilterSchema, recordSortDirectionSchema } from "@/lib/crm/api-schemas";
import { parsePageParam, parsePageSizeParam, RECORD_MAX_PAGE_SIZE } from "@/lib/crm/pagination";
import type { RecordFilter, RecordListQuery, RecordSort } from "@/lib/crm/types";

export function parseRecordListQuery(request: NextRequest): RecordListQuery {
  const searchParams = request.nextUrl.searchParams;
  const sortField = searchParams.get("sortField")?.trim();
  const sortDirection = recordSortDirectionSchema.catch("desc").parse(searchParams.get("sortDirection"));

  return {
    page: parsePageParam(searchParams.get("page")),
    pageSize: parsePageSizeParam(searchParams.get("pageSize"), RECORD_MAX_PAGE_SIZE),
    q: searchParams.get("q")?.trim() || searchParams.get("search")?.trim() || undefined,
    filters: parseFilters(searchParams.get("filters")),
    sort: sortField ? ({ field: sortField, direction: sortDirection } satisfies RecordSort) : undefined,
    cursor: normalizeCursor(searchParams.get("cursor")),
    keyset: searchParams.get("keyset") === "1" || searchParams.get("pagination") === "keyset",
    fields: parseFields(searchParams.get("fields")),
    pool: parsePool(searchParams.get("pool"))
  };
}

function parseFilters(value: string | null): RecordFilter[] | undefined {
  if (!value) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ApiError(400, "VALIDATION_ERROR", "Record filters must be valid JSON");
  }

  const result = recordFilterSchema.array().safeParse(parsed);
  if (!result.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Record filters failed validation", result.error.flatten());
  }

  return result.data satisfies RecordFilter[];
}

function normalizeCursor(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parseFields(value: string | null): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const fields = value
    .split(",")
    .map((field) => field.trim())
    .filter((field) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(field));
  return fields.length > 0 ? Array.from(new Set(fields)) : undefined;
}

function parsePool(value: string | null): RecordListQuery["pool"] {
  if (value === "public" || value === "private" || value === "all") {
    return value;
  }
  return undefined;
}
