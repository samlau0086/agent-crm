import type { CustomerLevelDefinition } from "@/lib/crm/types";

export const MAX_CUSTOMER_LEVELS = 20;
export const UNRATED_POOL_LEVEL = "unrated";
export const CUSTOMER_LEVEL_CODE_PATTERN = /^[A-Z][A-Z0-9_-]{0,23}$/;

export function normalizeCustomerLevelCode(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function isCustomerLevelCode(value: unknown): value is string {
  const normalized = normalizeCustomerLevelCode(value);
  return normalized !== "UNRATED" && CUSTOMER_LEVEL_CODE_PATTERN.test(normalized);
}

export function enabledCustomerLevelCodes(levels: CustomerLevelDefinition[]): Set<string> {
  return new Set(levels.filter((level) => level.enabled).map((level) => level.value));
}

export function allCustomerLevelCodes(levels: CustomerLevelDefinition[]): Set<string> {
  return new Set(levels.map((level) => level.value));
}

export function customerLevelFieldOptions(levels: CustomerLevelDefinition[]): Array<{ label: string; value: string }> {
  return levels
    .slice()
    .sort((left, right) => left.position - right.position)
    .map((level) => ({ label: level.label, value: level.value }));
}

export function validateEnabledCustomerLevelCoverage(levels: CustomerLevelDefinition[]): string | undefined {
  const enabled = levels
    .filter((level) => level.enabled)
    .slice()
    .sort((left, right) => left.minScore - right.minScore || left.maxScore - right.maxScore);
  if (enabled.length === 0) {
    return "至少需要启用一个客户等级";
  }
  if (enabled[0]?.minScore !== 0) {
    return "启用等级的评分区间必须从 0 分开始";
  }
  for (let index = 0; index < enabled.length; index += 1) {
    const level = enabled[index];
    if (!Number.isInteger(level.minScore) || !Number.isInteger(level.maxScore) || level.minScore < 0 || level.maxScore > 100 || level.minScore > level.maxScore) {
      return `${level.label || level.value} 的评分区间必须是 0–100 的整数，且起始分不能大于结束分`;
    }
    const next = enabled[index + 1];
    if (next && next.minScore !== level.maxScore + 1) {
      return `${level.label || level.value} 与 ${next.label || next.value} 的评分区间必须连续且不能重叠`;
    }
  }
  if (enabled.at(-1)?.maxScore !== 100) {
    return "启用等级的评分区间必须覆盖到 100 分";
  }
  return undefined;
}
