import type { CrmRecord } from "@/lib/crm/types";
import { convertCurrencyAmount, defaultCurrencyCode, getCurrencyDefinitions, normalizeCurrencyCode, roundCurrency } from "@/lib/crm/currencies";

export interface QuoteLineItem {
  id: string;
  productId: string;
  productName: string;
  sku?: string;
  imageUrl?: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  currency: string;
}

export interface QuoteFee {
  id: string;
  name: string;
  description?: string;
  amount: number;
  currency: string;
}

export interface QuoteTotals {
  lineSubtotal: number;
  feeSubtotal: number;
  totalAmount: number;
}

const MAX_QUOTE_LINE_ITEMS = 100;
const MAX_QUOTE_FEES = 50;
export const salesDocumentObjectKeys = ["quotes", "salesorders", "proformainvoices", "commercialinvoices"] as const;
export type SalesDocumentObjectKey = (typeof salesDocumentObjectKeys)[number];

export const salesDocumentNextObjectKey: Partial<Record<SalesDocumentObjectKey, SalesDocumentObjectKey>> = {
  quotes: "salesorders",
  salesorders: "proformainvoices",
  proformainvoices: "commercialinvoices"
};

export const salesDocumentNumberPrefixes: Record<SalesDocumentObjectKey, string> = {
  quotes: "Q",
  salesorders: "SO",
  proformainvoices: "PI",
  commercialinvoices: "CI"
};

export const salesDocumentTitles: Record<SalesDocumentObjectKey, string> = {
  quotes: "Quote",
  salesorders: "Sales Order",
  proformainvoices: "Proforma Invoice",
  commercialinvoices: "Commercial Invoice"
};

export function isSalesDocumentObjectKey(objectKey: string): objectKey is SalesDocumentObjectKey {
  return (salesDocumentObjectKeys as readonly string[]).includes(objectKey);
}

export function salesDocumentNumberField(objectKey: string): "quoteNumber" | "documentNumber" {
  return objectKey === "quotes" ? "quoteNumber" : "documentNumber";
}

export function salesDocumentCurrencyField(objectKey: string): "quoteCurrency" | "documentCurrency" {
  return objectKey === "quotes" ? "quoteCurrency" : "documentCurrency";
}

export function getSalesDocumentCurrency(data: Record<string, unknown>, objectKey = "quotes"): string {
  return normalizeCurrencyCode(data[salesDocumentCurrencyField(objectKey)]) || defaultCurrencyCode;
}

export function normalizeQuoteRecordData(data: Record<string, unknown>, currencyRecords: CrmRecord[] = []): Record<string, unknown> {
  return normalizeSalesDocumentRecordData("quotes", data, currencyRecords);
}

export function normalizeSalesDocumentRecordData(objectKey: string, data: Record<string, unknown>, currencyRecords: CrmRecord[] = []): Record<string, unknown> {
  const currencyField = salesDocumentCurrencyField(objectKey);
  const documentCurrency = normalizeCurrencyCode(data[currencyField]) || defaultCurrencyCode;
  const lineItems = normalizeQuoteLineItems(data.lineItems, documentCurrency);
  const fees = normalizeQuoteFees(data.fees, documentCurrency);
  const totals = calculateQuoteTotals(lineItems, fees, documentCurrency, currencyRecords);

  return {
    ...data,
    [currencyField]: documentCurrency,
    lineItems,
    fees,
    totalAmount: totals.totalAmount
  };
}

export function normalizeQuoteLineItems(value: unknown, fallbackCurrency = defaultCurrencyCode): QuoteLineItem[] {
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
      imageUrl: normalizeOptionalString(record.imageUrl),
      description: normalizeOptionalString(record.description),
      quantity: normalizePositiveNumber(record.quantity, 1),
      unitPrice: normalizeNonNegativeNumber(record.unitPrice, 0),
      currency: normalizeCurrencyCode(record.currency) || fallbackCurrency
    };
  });
}

export function normalizeQuoteFees(value: unknown, fallbackCurrency = defaultCurrencyCode): QuoteFee[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, MAX_QUOTE_FEES).map((item, index) => {
    const record = isRecord(item) ? item : {};
    return {
      id: normalizeString(record.id) || `fee-${index + 1}`,
      name: normalizeString(record.name),
      description: normalizeOptionalString(record.description),
      amount: normalizeNonNegativeNumber(record.amount, 0),
      currency: normalizeCurrencyCode(record.currency) || fallbackCurrency
    };
  });
}

export function calculateQuoteTotals(lineItems: QuoteLineItem[], fees: QuoteFee[], quoteCurrency?: string, currencyRecords: CrmRecord[] = []): QuoteTotals {
  const currencies = currencyRecords.length ? getCurrencyDefinitions(currencyRecords) : [];
  const targetCurrency = normalizeCurrencyCode(quoteCurrency);
  const lineSubtotal = roundMoney(
    lineItems.reduce((sum, item) => sum + item.quantity * amountForTotal(item.unitPrice, item.currency, targetCurrency, currencies), 0)
  );
  const feeSubtotal = roundMoney(fees.reduce((sum, fee) => sum + amountForTotal(fee.amount, fee.currency, targetCurrency, currencies), 0));
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
    imageUrl: normalizeOptionalString(product.data.mainImageUrl),
    description: normalizeOptionalString(product.data.description),
    quantity: 1,
    unitPrice: normalizeNonNegativeNumber(product.data.unitPrice, 0),
    currency: normalizeCurrencyCode(product.data.unitPriceCurrency) || defaultCurrencyCode
  };
}

export function validateQuoteRecordData(data: Record<string, unknown>, products: CrmRecord[]): void {
  validateSalesDocumentRecordData("quotes", data, products);
}

export function validateSalesDocumentRecordData(objectKey: string, data: Record<string, unknown>, products: CrmRecord[]): void {
  const quoteCurrency = getSalesDocumentCurrency(data, objectKey);
  const lineItems = normalizeQuoteLineItems(data.lineItems, quoteCurrency);
  const fees = normalizeQuoteFees(data.fees, quoteCurrency);
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

export function convertQuotePricingToCurrency(data: Record<string, unknown>, targetCurrencyCode: string, currencyRecords: CrmRecord[]): Record<string, unknown> {
  return convertSalesDocumentPricingToCurrency("quotes", data, targetCurrencyCode, currencyRecords);
}

export function convertSalesDocumentPricingToCurrency(objectKey: string, data: Record<string, unknown>, targetCurrencyCode: string, currencyRecords: CrmRecord[]): Record<string, unknown> {
  const currencies = getCurrencyDefinitions(currencyRecords);
  const currencyField = salesDocumentCurrencyField(objectKey);
  const previousCurrency = normalizeCurrencyCode(data[currencyField]) || targetCurrencyCode || defaultCurrencyCode;
  const nextCurrency = normalizeCurrencyCode(targetCurrencyCode) || previousCurrency;
  const lineItems = normalizeQuoteLineItems(data.lineItems, previousCurrency).map((item) => ({
    ...item,
    unitPrice: convertCurrencyAmount(item.unitPrice, item.currency || previousCurrency, nextCurrency, currencies),
    currency: nextCurrency
  }));
  const fees = normalizeQuoteFees(data.fees, previousCurrency).map((fee) => ({
    ...fee,
    amount: convertCurrencyAmount(fee.amount, fee.currency || previousCurrency, nextCurrency, currencies),
    currency: nextCurrency
  }));
  const totals = calculateQuoteTotals(lineItems, fees);
  return {
    ...data,
    [currencyField]: nextCurrency,
    lineItems,
    fees,
    totalAmount: totals.totalAmount
  };
}

export function buildSalesDocumentConversionData(source: CrmRecord, targetObjectKey: SalesDocumentObjectKey, documentNumber: string): Record<string, unknown> {
  const sourceCurrency = getSalesDocumentCurrency(source.data, source.objectKey);
  return normalizeSalesDocumentRecordData(targetObjectKey, {
    documentNumber,
    companyId: source.data.companyId,
    contactId: source.data.contactId,
    dealId: source.data.dealId,
    documentCurrency: sourceCurrency,
    paymentTerm: source.data.paymentTerm ?? "net_30",
    status: "draft",
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: source.data.validUntil ?? source.data.dueDate,
    validUntil: source.data.validUntil,
    lineItems: source.data.lineItems,
    fees: source.data.fees,
    notes: source.data.notes,
    sourceObjectKey: source.objectKey,
    sourceRecordId: source.id,
    convertedFromRecordId: source.id
  });
}

export function quoteLineItemFromProductForCurrency(product: CrmRecord, targetCurrencyCode: string, currencyRecords: CrmRecord[]): QuoteLineItem {
  const lineItem = buildQuoteLineItemFromProduct(product);
  const targetCurrency = normalizeCurrencyCode(targetCurrencyCode) || lineItem.currency;
  return {
    ...lineItem,
    unitPrice: convertCurrencyAmount(lineItem.unitPrice, lineItem.currency, targetCurrency, getCurrencyDefinitions(currencyRecords)),
    currency: targetCurrency
  };
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
  return roundCurrency(value);
}

function amountForTotal(amount: number, currency: string | undefined, quoteCurrency: string | undefined, currencies: ReturnType<typeof getCurrencyDefinitions>): number {
  if (!quoteCurrency || currencies.length === 0) {
    return amount;
  }

  return convertCurrencyAmount(amount, currency || quoteCurrency, quoteCurrency, currencies);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
