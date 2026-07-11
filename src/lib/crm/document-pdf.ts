import Handlebars from "handlebars/dist/cjs/handlebars.js";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import pdfMake from "pdfmake/build/pdfmake.js";
import pdfFonts from "pdfmake/build/vfs_fonts.js";
import type { CrmRecord, DocumentTemplate } from "@/lib/crm/types";
import { calculateQuoteTotals, getSalesDocumentCurrency, normalizeQuoteFees, normalizeQuoteLineItems, salesDocumentNumberField, salesDocumentTitles } from "@/lib/crm/quotes";
import { formatMoneyWithCurrency, getCurrencyDefinitions } from "@/lib/crm/currencies";

pdfMake.vfs = pdfFonts.pdfMake?.vfs ?? pdfFonts.vfs ?? {};
const defaultPdfFont = configurePdfFonts();

export interface SalesDocumentPdfContext {
  record: CrmRecord;
  company?: CrmRecord;
  contact?: CrmRecord;
  deal?: CrmRecord;
  workspace: { id: string; name?: string };
  records?: CrmRecord[];
  generatedAt?: string;
}

const handlebars = Handlebars.create();

handlebars.registerHelper("money", (amount: unknown, currency: unknown) => {
  const code = typeof currency === "string" ? currency : "CNY";
  return formatMoneyWithCurrency(Number(amount ?? 0), code, []);
});

handlebars.registerHelper("date", (value: unknown) => {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 10);
});

handlebars.registerHelper("uppercase", (value: unknown) => String(value ?? "").toUpperCase());
handlebars.registerHelper("default", (value: unknown, fallback: unknown) => (value === undefined || value === null || value === "" ? fallback : value));
handlebars.registerHelper("eq", (left: unknown, right: unknown) => left === right);
handlebars.registerHelper("sum", (items: unknown, field: unknown) => {
  if (!Array.isArray(items) || typeof field !== "string") return 0;
  return items.reduce((sum, item) => sum + (isRecord(item) ? Number(item[field] ?? 0) : 0), 0);
});

export async function renderSalesDocumentPdf(template: DocumentTemplate, input: SalesDocumentPdfContext): Promise<Buffer> {
  const context = buildTemplateContext(input);
  const docDefinition = renderTemplateValue(template.templateJson, context) as Record<string, unknown>;
  if (defaultPdfFont) {
    docDefinition.defaultStyle = { ...(isRecord(docDefinition.defaultStyle) ? docDefinition.defaultStyle : {}), font: defaultPdfFont };
  }
  return createPdfBuffer(docDefinition);
}

export function buildTemplateContext(input: SalesDocumentPdfContext): Record<string, unknown> {
  const record = input.record;
  const currencyRecords = input.records?.filter((candidate) => candidate.objectKey === "currencies") ?? [];
  const currency = getSalesDocumentCurrency(record.data, record.objectKey);
  const lineItems = normalizeQuoteLineItems(record.data.lineItems, currency);
  const fees = normalizeQuoteFees(record.data.fees, currency);
  const totals = calculateQuoteTotals(lineItems, fees, currency, currencyRecords);
  const documentNumber = String(record.data[salesDocumentNumberField(record.objectKey)] ?? "");
  return {
    record,
    company: input.company ?? {},
    contact: input.contact ?? {},
    deal: input.deal ?? {},
    workspace: input.workspace,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    documentTitle: salesDocumentTitles[record.objectKey as keyof typeof salesDocumentTitles] ?? record.objectKey,
    documentNumber,
    currency,
    lineItems,
    fees,
    totals,
    lineItemsTable: buildLineItemsTable(lineItems, currency, currencyRecords)
  };
}

function renderTemplateValue(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    if (value.trim() === "{{lineItemsTable}}") {
      return context.lineItemsTable;
    }
    return handlebars.compile(value, { noEscape: true })(context);
  }
  if (Array.isArray(value)) {
    return value.map((item) => renderTemplateValue(item, context));
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderTemplateValue(item, context)]));
  }
  return value;
}

function buildLineItemsTable(lineItems: ReturnType<typeof normalizeQuoteLineItems>, currency: string, currencyRecords: CrmRecord[]): unknown[][] {
  const currencies = getCurrencyDefinitions(currencyRecords);
  return [
    [
      { text: "Item", bold: true },
      { text: "Qty", bold: true },
      { text: "Unit Price", bold: true },
      { text: "Amount", bold: true }
    ],
    ...lineItems.map((item) => [
      item.productName || item.productId || "",
      String(item.quantity),
      formatMoneyWithCurrency(item.unitPrice, item.currency || currency, currencies),
      formatMoneyWithCurrency(item.quantity * item.unitPrice, item.currency || currency, currencies)
    ])
  ];
}

function createPdfBuffer(docDefinition: Record<string, unknown>): Promise<Buffer> {
  return new Promise((resolve) => {
    pdfMake.createPdf(docDefinition, undefined, pdfMake.fonts, pdfMake.vfs).getBuffer((buffer) => resolve(Buffer.from(buffer)));
  });
}

function configurePdfFonts(): string | undefined {
  const fontPath = findCjkFontPath();
  if (!fontPath) {
    return undefined;
  }
  const fontFileName = basename(fontPath);
  pdfMake.vfs[fontFileName] = readFileSync(fontPath).toString("base64");
  pdfMake.fonts = {
    ...(pdfMake.fonts ?? {}),
    NotoSansCJK: {
      normal: fontFileName,
      bold: fontFileName,
      italics: fontFileName,
      bolditalics: fontFileName
    }
  };
  return "NotoSansCJK";
}

function findCjkFontPath(): string | undefined {
  const candidates = [
    process.env.PDFMAKE_CJK_FONT_PATH,
    "/usr/share/fonts/noto-cjk/NotoSansCJKsc-Regular.otf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
    "C:\\Windows\\Fonts\\simhei.ttf",
    "C:\\Windows\\Fonts\\simkai.ttf"
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => /\.(otf|ttf)$/i.test(candidate) && existsSync(candidate));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
