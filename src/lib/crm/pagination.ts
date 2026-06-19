export const RECORD_DEFAULT_PAGE_SIZE = 50;
export const RECORD_MAX_PAGE_SIZE = 200;
export const AUDIT_DEFAULT_PAGE_SIZE = 200;
export const AUDIT_MAX_PAGE_SIZE = 200;
export const AUDIT_EXPORT_MAX_PAGE_SIZE = 1000;

export function parsePageParam(value: string | null): number | undefined {
  return parsePositiveInteger(value);
}

export function parsePageSizeParam(value: string | null, maxSize: number): number | undefined {
  const parsed = parsePositiveInteger(value);
  return parsed === undefined ? undefined : Math.min(parsed, maxSize);
}

export function normalizePage(page: number | undefined): number {
  return normalizePositiveInteger(page, 1, Number.MAX_SAFE_INTEGER);
}

export function normalizePageSize(pageSize: number | undefined, options: { defaultSize: number; maxSize: number }): number {
  return normalizePositiveInteger(pageSize, options.defaultSize, options.maxSize);
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizePositiveInteger(value: number | undefined, defaultValue: number, maxValue: number): number {
  if (!Number.isFinite(value) || value === undefined) {
    return defaultValue;
  }

  return Math.min(maxValue, Math.max(1, Math.floor(value)));
}
