import type { CrmRecord } from "@/lib/crm/types";
import { formatMoneyWithCurrency, getCurrencyDefinitions, roundCurrency, type CurrencyDefinition } from "@/lib/crm/currencies";

export type PaymentTermMode = "full" | "deposit_balance";
export type PaymentTermDepositType = "percentage" | "fixed";

export interface PaymentTermDefinition {
  code: string;
  label: string;
  active: boolean;
  mode: PaymentTermMode;
  fullPaymentMethod?: string;
  depositPaymentMethod?: string;
  balancePaymentMethod?: string;
  depositType: PaymentTermDepositType;
  depositValue: number;
  paymentInstructions?: string;
}

export interface PaymentScheduleItem {
  key: "full" | "deposit" | "balance";
  label: string;
  method?: string;
  amount: number;
  percentage?: number;
  description: string;
}

export interface PaymentTermSchedule {
  term?: PaymentTermDefinition;
  paymentSchedule: PaymentScheduleItem[];
  paymentSummary: string;
  paymentInstructions: string;
}

export const defaultPaymentTermCode = "net_30";

export const fallbackPaymentTerms: PaymentTermDefinition[] = [
  {
    code: "due_on_receipt",
    label: "Due on receipt",
    active: true,
    mode: "full",
    fullPaymentMethod: "Full Payment",
    depositType: "percentage",
    depositValue: 100,
    paymentInstructions: ""
  },
  {
    code: "net_15",
    label: "Net 15",
    active: true,
    mode: "full",
    fullPaymentMethod: "Full Payment",
    depositType: "percentage",
    depositValue: 100,
    paymentInstructions: ""
  },
  {
    code: "net_30",
    label: "Net 30",
    active: true,
    mode: "full",
    fullPaymentMethod: "Full Payment",
    depositType: "percentage",
    depositValue: 100,
    paymentInstructions: ""
  },
  {
    code: "net_60",
    label: "Net 60",
    active: true,
    mode: "full",
    fullPaymentMethod: "Full Payment",
    depositType: "percentage",
    depositValue: 100,
    paymentInstructions: ""
  },
  {
    code: "advance_30_balance_70",
    label: "30% Advance / 70% Balance",
    active: true,
    mode: "deposit_balance",
    depositPaymentMethod: "Payment in Advance",
    balancePaymentMethod: "Balance",
    depositType: "percentage",
    depositValue: 30,
    paymentInstructions: ""
  }
];

export function getPaymentTermDefinitions(records: CrmRecord[]): PaymentTermDefinition[] {
  const configured = records
    .filter((record) => record.objectKey === "paymentterms")
    .map((record) => normalizePaymentTermDefinition(record))
    .filter((term) => term.code && term.label);

  return configured.length ? configured : fallbackPaymentTerms;
}

export function getPaymentTerm(records: CrmRecord[], code: unknown): PaymentTermDefinition | undefined {
  const normalizedCode = normalizePaymentTermCode(code);
  return getPaymentTermDefinitions(records).find((term) => term.code === normalizedCode);
}

export function paymentTermOptionsFromRecords(records: CrmRecord[], includeCodes: string[] = []): Array<{ label: string; value: string }> {
  const included = new Set(includeCodes.map((code) => normalizePaymentTermCode(code)).filter(Boolean));
  return getPaymentTermDefinitions(records)
    .filter((term) => term.code || included.has(term.code))
    .map((term) => ({ label: term.label, value: term.code }));
}

export function buildPaymentTermSchedule(
  records: CrmRecord[],
  code: unknown,
  totalAmount: unknown,
  currencyCode: string | undefined,
  currencyRecords: CrmRecord[] = records
): PaymentTermSchedule {
  const currencies = getCurrencyDefinitions(currencyRecords);
  const term = getPaymentTerm(records, code);
  const amount = normalizeNonNegativeNumber(totalAmount, 0);
  const paymentSchedule = term ? buildScheduleItems(term, amount, currencyCode, currencies) : [];
  return {
    term,
    paymentSchedule,
    paymentSummary: paymentSchedule.map((item) => item.description).join(", "),
    paymentInstructions: term?.paymentInstructions ?? ""
  };
}

export function formatPaymentTermSummary(term: PaymentTermDefinition, currencyCode?: string, currencies: CurrencyDefinition[] = []): string {
  if (term.mode === "full") {
    return term.fullPaymentMethod?.trim() || "Full Payment";
  }

  if (term.depositType === "fixed") {
    const amount = formatMoneyWithCurrency(term.depositValue, currencyCode, currencies);
    return `${amount} Payment in Advance, Balance`;
  }

  const depositPercent = clampPercentage(term.depositValue);
  return `${formatPercent(depositPercent)} Payment in Advance, ${formatPercent(100 - depositPercent)} Balance`;
}

export function normalizePaymentTermCode(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") : "";
}

function normalizePaymentTermDefinition(record: CrmRecord): PaymentTermDefinition {
  const mode = record.data.mode === "deposit_balance" ? "deposit_balance" : "full";
  const depositType = record.data.depositType === "fixed" ? "fixed" : "percentage";
  return {
    code: normalizePaymentTermCode(record.data.code || record.title),
    label: normalizeString(record.data.label) || record.title,
    active: record.data.active !== false,
    mode,
    fullPaymentMethod: normalizeOptionalString(record.data.fullPaymentMethod),
    depositPaymentMethod: normalizeOptionalString(record.data.depositPaymentMethod),
    balancePaymentMethod: normalizeOptionalString(record.data.balancePaymentMethod),
    depositType,
    depositValue: normalizeNonNegativeNumber(record.data.depositValue, depositType === "percentage" ? 100 : 0),
    paymentInstructions: normalizeOptionalString(record.data.paymentInstructions)
  };
}

function buildScheduleItems(term: PaymentTermDefinition, totalAmount: number, currencyCode: string | undefined, currencies: CurrencyDefinition[]): PaymentScheduleItem[] {
  if (term.mode === "full") {
    return [
      buildScheduleItem({
        key: "full",
        label: "100% Full Payment",
        method: term.fullPaymentMethod || "Full Payment",
        amount: totalAmount,
        percentage: 100,
        currencyCode,
        currencies
      })
    ];
  }

  const depositAmount =
    term.depositType === "fixed"
      ? Math.min(roundCurrency(term.depositValue), totalAmount)
      : roundCurrency(totalAmount * (clampPercentage(term.depositValue) / 100));
  const balanceAmount = roundCurrency(Math.max(totalAmount - depositAmount, 0));
  const depositPercent = totalAmount > 0 ? roundDisplayPercent((depositAmount / totalAmount) * 100) : undefined;
  const balancePercent = totalAmount > 0 ? roundDisplayPercent((balanceAmount / totalAmount) * 100) : undefined;

  return [
    buildScheduleItem({
      key: "deposit",
      label: `${depositPercent !== undefined ? `${formatPercent(depositPercent)} ` : ""}Payment in Advance`,
      method: term.depositPaymentMethod || "Payment in Advance",
      amount: depositAmount,
      percentage: depositPercent,
      currencyCode,
      currencies
    }),
    buildScheduleItem({
      key: "balance",
      label: `${balancePercent !== undefined ? `${formatPercent(balancePercent)} ` : ""}Balance`,
      method: term.balancePaymentMethod || "Balance",
      amount: balanceAmount,
      percentage: balancePercent,
      currencyCode,
      currencies
    })
  ];
}

function buildScheduleItem(input: {
  key: PaymentScheduleItem["key"];
  label: string;
  method?: string;
  amount: number;
  percentage?: number;
  currencyCode?: string;
  currencies: CurrencyDefinition[];
}): PaymentScheduleItem {
  const method = input.method?.trim();
  const methodSuffix = method && method !== input.label.replace(/^\d+(?:\.\d+)?% /, "") ? ` by ${method}` : "";
  const amountLabel = formatMoneyWithCurrency(input.amount, input.currencyCode, input.currencies);
  return {
    key: input.key,
    label: input.label,
    method,
    amount: input.amount,
    percentage: input.percentage,
    description: `${input.label}${methodSuffix}: ${amountLabel}`
  };
}

function formatPercent(value: number): string {
  return `${roundDisplayPercent(value)}%`;
}

function roundDisplayPercent(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(value, 0), 100);
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = normalizeString(value);
  return normalized || undefined;
}

function normalizeNonNegativeNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}
