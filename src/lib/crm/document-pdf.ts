import Handlebars from "handlebars/dist/cjs/handlebars.js";
import { existsSync, readFileSync } from "node:fs";
import PdfPrinter from "pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts.js";
import type { TDocumentDefinitions, TFontDictionary } from "pdfmake/interfaces";
import type { CrmRecord, DocumentTemplate } from "@/lib/crm/types";
import { calculateQuoteTotals, getSalesDocumentCurrency, normalizeQuoteFees, normalizeQuoteLineItems, salesDocumentNumberField, salesDocumentTitles } from "@/lib/crm/quotes";
import { formatMoneyWithCurrency, getCurrencyDefinitions } from "@/lib/crm/currencies";
import { buildPaymentTermSchedule } from "@/lib/crm/payment-terms";

const bundledFontVfs = pdfFonts.pdfMake?.vfs ?? pdfFonts.vfs ?? (pdfFonts as unknown as Record<string, string>);
const { fonts: pdfFontsByName, defaultFont: defaultPdfFont } = configurePdfFonts();
const pdfPrinter = new PdfPrinter(pdfFontsByName);

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

handlebars.registerHelper("money", (amount: unknown, currencyOrOptions: unknown, helperOptions?: unknown) => {
  const options = isHandlebarsOptions(helperOptions) ? helperOptions : isHandlebarsOptions(currencyOrOptions) ? currencyOrOptions : undefined;
  const contextCurrency = options?.data?.root?.currency;
  const code = typeof currencyOrOptions === "string" && currencyOrOptions.trim()
    ? currencyOrOptions
    : typeof contextCurrency === "string" && contextCurrency.trim()
      ? contextCurrency
      : "CNY";
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
  const paymentTermSchedule = buildPaymentTermSchedule(input.records ?? [], record.data.paymentTerm, totals.totalAmount, currency, currencyRecords);
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
    paymentTerm: paymentTermSchedule.term ?? {},
    paymentSchedule: paymentTermSchedule.paymentSchedule,
    paymentSummary: paymentTermSchedule.paymentSummary,
    paymentInstructions: paymentTermSchedule.paymentInstructions,
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
  return new Promise((resolve, reject) => {
    let document: PDFKit.PDFDocument;
    try {
      document = pdfPrinter.createPdfKitDocument(docDefinition as unknown as TDocumentDefinitions);
    } catch (error) {
      reject(error);
      return;
    }

    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer | Uint8Array) => chunks.push(Buffer.from(chunk)));
    document.once("error", reject);
    document.once("end", () => resolve(Buffer.concat(chunks)));
    document.end();
  });
}

function configurePdfFonts(): { fonts: TFontDictionary; defaultFont: string } {
  const robotoRegular = fontBufferFromVfs("Roboto-Regular.ttf");
  const robotoMedium = fontBufferFromVfs("Roboto-Medium.ttf");
  const robotoItalic = fontBufferFromVfs("Roboto-Italic.ttf");
  const robotoMediumItalic = fontBufferFromVfs("Roboto-MediumItalic.ttf");
  const fonts: TFontDictionary = {
    Roboto: {
      normal: robotoRegular,
      bold: robotoMedium,
      italics: robotoItalic,
      bolditalics: robotoMediumItalic
    }
  };
  const cjkFontFile = findCjkFontFile();
  if (!cjkFontFile) {
    return { fonts, defaultFont: "Roboto" };
  }
  const fontBuffer = readFileSync(cjkFontFile.path);
  const cjkFont = cjkFontFile.collectionName
    ? [fontBuffer, cjkFontFile.collectionName]
    : fontBuffer;
  fonts.NotoSansCJK = {
    normal: cjkFont as PDFKit.Mixins.PDFFontSource,
    bold: cjkFont as PDFKit.Mixins.PDFFontSource,
    italics: cjkFont as PDFKit.Mixins.PDFFontSource,
    bolditalics: cjkFont as PDFKit.Mixins.PDFFontSource
  };
  return { fonts, defaultFont: "NotoSansCJK" };
}

function fontBufferFromVfs(fileName: string): Buffer {
  const encoded = bundledFontVfs[fileName];
  if (!encoded) {
    throw new Error(`Bundled PDF font is missing: ${fileName}`);
  }
  return Buffer.from(encoded, "base64");
}

function findCjkFontFile(): { path: string; collectionName?: string } | undefined {
  const candidates = [
    process.env.PDFMAKE_CJK_FONT_PATH ? { path: process.env.PDFMAKE_CJK_FONT_PATH, collectionName: process.env.PDFMAKE_CJK_FONT_NAME } : undefined,
    { path: "/usr/share/fonts/noto/NotoSansCJK-Regular.ttc", collectionName: "NotoSansCJKsc-Regular" },
    { path: "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", collectionName: "NotoSansCJKsc-Regular" },
    { path: "/usr/share/fonts/noto-cjk/NotoSansCJKsc-Regular.otf" },
    { path: "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf" },
    { path: "C:\\Windows\\Fonts\\simhei.ttf" },
    { path: "C:\\Windows\\Fonts\\simkai.ttf" }
  ].filter((candidate): candidate is { path: string; collectionName?: string } => Boolean(candidate));
  return candidates.find((candidate) => /\.(otf|ttf|ttc)$/i.test(candidate.path) && existsSync(candidate.path));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHandlebarsOptions(value: unknown): value is { data?: { root?: { currency?: unknown } } } {
  return isRecord(value) && "hash" in value;
}
