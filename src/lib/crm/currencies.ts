import type { CrmRecord } from "@/lib/crm/types";

export interface CurrencyDefinition {
  code: string;
  label: string;
  symbol: string;
  rateToBase: number;
  isBase: boolean;
  active: boolean;
}

export const defaultCurrencyCode = "CNY";

export function getCurrencyDefinitions(records: CrmRecord[]): CurrencyDefinition[] {
  const configured = records
    .filter((record) => record.objectKey === "currencies")
    .map((record) => normalizeCurrencyDefinition(record))
    .filter((currency) => currency.code && currency.active && currency.rateToBase > 0);

  if (configured.length === 0) {
    return [fallbackCurrency()];
  }

  const hasBase = configured.some((currency) => currency.isBase);
  return configured.map((currency, index) => ({
    ...currency,
    isBase: hasBase ? currency.isBase : index === 0,
    rateToBase: currency.isBase || (!hasBase && index === 0) ? 1 : currency.rateToBase
  }));
}

export function getBaseCurrencyCode(currencies: CurrencyDefinition[]): string {
  return currencies.find((currency) => currency.isBase)?.code ?? currencies[0]?.code ?? defaultCurrencyCode;
}

export function getCurrency(currencies: CurrencyDefinition[], code?: string): CurrencyDefinition {
  const normalizedCode = normalizeCurrencyCode(code);
  return currencies.find((currency) => currency.code === normalizedCode) ?? currencies.find((currency) => currency.isBase) ?? currencies[0] ?? fallbackCurrency();
}

export function convertCurrencyAmount(amount: number, fromCode: string | undefined, toCode: string | undefined, currencies: CurrencyDefinition[]): number {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) {
    return 0;
  }

  const from = getCurrency(currencies, fromCode);
  const to = getCurrency(currencies, toCode);
  if (from.code === to.code) {
    return roundCurrency(numericAmount);
  }

  return roundCurrency((numericAmount * from.rateToBase) / to.rateToBase);
}

export function formatMoneyWithCurrency(value: unknown, currencyCode: string | undefined, currencies: CurrencyDefinition[]): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return "-";
  }

  const currency = getCurrency(currencies, currencyCode);
  const formatted = new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  }).format(amount);
  return `${currency.symbol || currency.code} ${formatted} ${currency.code}`.trim();
}

export function normalizeCurrencyCode(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeCurrencyDefinition(record: CrmRecord): CurrencyDefinition {
  return {
    code: normalizeCurrencyCode(record.data.code || record.title),
    label: typeof record.data.label === "string" && record.data.label.trim() ? record.data.label.trim() : record.title,
    symbol: typeof record.data.symbol === "string" ? record.data.symbol.trim() : "",
    rateToBase: normalizePositiveNumber(record.data.rateToBase, record.data.isBase ? 1 : 0),
    isBase: record.data.isBase === true,
    active: record.data.active !== false
  };
}

function fallbackCurrency(): CurrencyDefinition {
  return {
    code: defaultCurrencyCode,
    label: "人民币",
    symbol: "¥",
    rateToBase: 1,
    isBase: true,
    active: true
  };
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
