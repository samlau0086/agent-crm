import type { CrmRecord } from "@/lib/crm/types";

export interface QuoteLineItem {
  id: string;
  productId: string;
  productName: string;
  sku?: string;
  description?: string;
  quantity: number;
  unitPrice: number;
}

export interface QuoteFee {
  id: string;
  name: string;
  description?: string;
  amount: number;
}

export interface QuoteTotals {
  lineSubtotal: number;
  feeSubtotal: number;
  totalAmount: number;
}

const MAX_QUOTE_LINE_ITEMS = 100;
const MAX_QUOTE_FEES = 50;

export function normalizeQuoteRecordData(data: Record<string, unknown>): Record<string, unknown> {
  const lineItems = normalizeQuoteLineItems(data.lineItems);
  const fees = normalizeQuoteFees(data.fees);
  const totals = calculateQuoteTotals(lineItems, fees);

  return {
    ...data,
    lineItems,
    fees,
    totalAmount: totals.totalAmount
  };
}

export function normalizeQuoteLineItems(value: unknown): QuoteLineItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, MAX_QUOTE_LINE_ITEMS).map((item, index) => {
    const record = isRecord(item) ? item : {};
    return {
      id: normalizeString(record.id) || `line-${index + 1}`,
      productId: normalizeString(record.productId),
      productName: normalizeString(record.productName),
      sku: normalizeOptionalString(record.sku),
      description: normalizeOptionalString(record.description),
      quantity: normalizePositiveNumber(record.quantity, 1),
      unitPrice: normalizeNonNegativeNumber(record.unitPrice, 0)
    };
  });
}

export function normalizeQuoteFees(value: unknown): QuoteFee[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, MAX_QUOTE_FEES).map((item, index) => {
    const record = isRecord(item) ? item : {};
    return {
      id: normalizeString(record.id) || `fee-${index + 1}`,
      name: normalizeString(record.name),
      description: normalizeOptionalString(record.description),
      amount: normalizeNonNegativeNumber(record.amount, 0)
    };
  });
}

export function calculateQuoteTotals(lineItems: QuoteLineItem[], fees: QuoteFee[]): QuoteTotals {
  const lineSubtotal = roundMoney(lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0));
  const feeSubtotal = roundMoney(fees.reduce((sum, fee) => sum + fee.amount, 0));
  return {
    lineSubtotal,
    feeSubtotal,
    totalAmount: roundMoney(lineSubtotal + feeSubtotal)
  };
}

export function buildQuoteLineItemFromProduct(product: CrmRecord): QuoteLineItem {
  return {
    id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    productId: product.id,
    productName: product.title,
    sku: normalizeOptionalString(product.data.sku),
    description: normalizeOptionalString(product.data.description),
    quantity: 1,
    unitPrice: normalizeNonNegativeNumber(product.data.unitPrice, 0)
  };
}

export function validateQuoteRecordData(data: Record<string, unknown>, products: CrmRecord[]): void {
  const lineItems = normalizeQuoteLineItems(data.lineItems);
  const fees = normalizeQuoteFees(data.fees);
  const productsById = new Map(products.map((product) => [product.id, product]));

  for (const item of lineItems) {
    if (!item.productId) {
      throw new Error("报价产品必须选择产品");
    }
    if (!productsById.has(item.productId)) {
      throw new Error("报价产品引用了不存在的产品");
    }
    if (item.quantity <= 0) {
      throw new Error("报价产品数量必须大于 0");
    }
    if (item.unitPrice < 0) {
      throw new Error("报价产品价格不能小于 0");
    }
  }

  for (const fee of fees) {
    if (!fee.name.trim()) {
      throw new Error("其他费用名称不能为空");
    }
    if (fee.amount < 0) {
      throw new Error("其他费用金额不能小于 0");
    }
  }
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = normalizeString(value);
  return normalized || undefined;
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeNonNegativeNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
