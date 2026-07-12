import Handlebars from "handlebars/dist/cjs/handlebars.js";
import { existsSync, readFileSync } from "node:fs";
import PdfPrinter from "pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts.js";
import type { TDocumentDefinitions, TFontDictionary } from "pdfmake/interfaces";
import type { CrmRecord, DocumentTemplate, Team } from "@/lib/crm/types";
import { calculateQuoteTotals, getSalesDocumentCurrency, normalizeQuoteFees, normalizeQuoteLineItems, salesDocumentNumberField, salesDocumentTitles } from "@/lib/crm/quotes";
import { formatMoneyWithCurrency, getCurrencyDefinitions } from "@/lib/crm/currencies";
import { buildPaymentTermSchedule } from "@/lib/crm/payment-terms";
import { assertWebhookDeliveryTarget } from "@/lib/integrations/webhook";

const bundledFontVfs = pdfFonts.pdfMake?.vfs ?? pdfFonts.vfs ?? (pdfFonts as unknown as Record<string, string>);
const { fonts: pdfFontsByName, defaultFont: defaultPdfFont } = configurePdfFonts();
const pdfPrinter = new PdfPrinter(pdfFontsByName);

export interface SalesDocumentPdfContext {
  record: CrmRecord;
  company?: CrmRecord;
  contact?: CrmRecord;
  deal?: CrmRecord;
  workspace: { id: string; name?: string };
  team?: Team;
  records?: CrmRecord[];
  generatedAt?: string;
}

const handlebars = Handlebars.create();

handlebars.registerHelper("money", (amount: unknown, currencyOrOptions: unknown, helperOptions?: unknown) => {
  const options = isHandlebarsOptions(helperOptions) ? helperOptions : isHandlebarsOptions(currencyOrOptions) ? currencyOrOptions : undefined;
  const contextCurrency = options?.data?.root?.currency;
  const currencyDefinitions = Array.isArray(options?.data?.root?.currencyDefinitions) ? options.data.root.currencyDefinitions : [];
  const code = typeof contextCurrency === "string" && contextCurrency.trim()
    ? contextCurrency
    : typeof currencyOrOptions === "string" && currencyOrOptions.trim()
      ? currencyOrOptions
      : "CNY";
  return formatMoneyWithCurrency(Number(amount ?? 0), code, currencyDefinitions);
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
  context.lineItemsTable = await buildLineItemsTableWithImages(context.lineItems as EnrichedLineItem[], String(context.currency), input.records?.filter((record) => record.objectKey === "currencies") ?? []);
  const docDefinition = renderTemplateValue(template.templateJson, context) as Record<string, unknown>;
  if (defaultPdfFont) {
    docDefinition.defaultStyle = { ...(isRecord(docDefinition.defaultStyle) ? docDefinition.defaultStyle : {}), font: defaultPdfFont };
  }
  return createPdfBuffer(docDefinition);
}

export function buildTemplateContext(input: SalesDocumentPdfContext): Record<string, unknown> {
  const record = input.record;
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const issueDate = resolveIssueDate(record, generatedAt);
  const templateRecord = {
    ...record,
    data: { ...record.data, issueDate }
  };
  const currencyRecords = input.records?.filter((candidate) => candidate.objectKey === "currencies") ?? [];
  const currency = getSalesDocumentCurrency(record.data, record.objectKey);
  const products = input.records?.filter((candidate) => candidate.objectKey === "products") ?? [];
  const lineItems = enrichLineItems(normalizeQuoteLineItems(record.data.lineItems, currency), products);
  const fees = normalizeQuoteFees(record.data.fees, currency);
  const totals = calculateQuoteTotals(lineItems, fees, currency, currencyRecords);
  const paymentTermSchedule = buildPaymentTermSchedule(input.records ?? [], record.data.paymentTerm, totals.totalAmount, currency, currencyRecords);
  const documentNumber = String(record.data[salesDocumentNumberField(record.objectKey)] ?? "");
  return {
    record: templateRecord,
    company: input.company ?? {},
    contact: input.contact ?? {},
    deal: input.deal ?? {},
    team: input.team ?? {},
    workspace: input.workspace,
    generatedAt,
    issueDate,
    documentTitle: pdfDocumentTitles[record.objectKey] ?? salesDocumentTitles[record.objectKey as keyof typeof salesDocumentTitles] ?? record.objectKey,
    documentNumber,
    currency,
    currencyDefinitions: getCurrencyDefinitions(currencyRecords),
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

function resolveIssueDate(record: CrmRecord, generatedAt: string): string {
  const candidates = [record.data.issueDate, record.createdAt, generatedAt];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const date = new Date(String(candidate));
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return "";
}

function renderTemplateValue(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    if (value.trim() === "{{lineItemsTable}}") {
      return context.lineItemsTable;
    }
    return renderPdfTemplateText(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((item) => renderTemplateValue(item, context));
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderTemplateValue(item, context)]));
  }
  return value;
}

export function renderPdfTemplateText(value: string, context: Record<string, unknown>): string {
  return handlebars.compile(value, { noEscape: true })(context);
}

type EnrichedLineItem = ReturnType<typeof normalizeQuoteLineItems>[number] & {
  description?: string;
  imageUrl?: string;
};

const pdfDocumentTitles: Record<string, string> = {
  quotes: "Quotation",
  salesorders: "Sales Order",
  proformainvoices: "Proforma Invoice",
  commercialinvoices: "Commercial Invoice"
};

function enrichLineItems(lineItems: ReturnType<typeof normalizeQuoteLineItems>, products: CrmRecord[]): EnrichedLineItem[] {
  const productsById = new Map(products.map((product) => [product.id, product]));
  return lineItems.map((item) => {
    const product = productsById.get(item.productId);
    return {
      ...item,
      description: item.description || String(product?.data.description ?? "").trim() || undefined,
      imageUrl: item.imageUrl || String(product?.data.mainImageUrl ?? "").trim() || undefined
    };
  });
}

async function buildLineItemsTableWithImages(lineItems: EnrichedLineItem[], currency: string, currencyRecords: CrmRecord[]): Promise<unknown[][]> {
  const images = await Promise.all(lineItems.map((item) => loadPdfImage(item.imageUrl)));
  return buildLineItemsTable(lineItems, currency, currencyRecords, images);
}

function buildLineItemsTable(lineItems: EnrichedLineItem[], currency: string, currencyRecords: CrmRecord[], images: Array<string | undefined> = []): unknown[][] {
  const currencies = getCurrencyDefinitions(currencyRecords);
  return [
    [
      { text: "Item", bold: true },
      { text: "Qty", bold: true },
      { text: "Unit Price", bold: true },
      { text: "Amount", bold: true }
    ],
    ...lineItems.map((item, index) => [
      buildProductCell(item, images[index]),
      String(item.quantity),
      formatMoneyWithCurrency(item.unitPrice, item.currency || currency, currencies),
      formatMoneyWithCurrency(item.quantity * item.unitPrice, item.currency || currency, currencies)
    ])
  ];
}

function buildProductCell(item: EnrichedLineItem, image?: string): Record<string, unknown> {
  const details = {
    stack: [
      { text: item.productName || item.productId || "", bold: true },
      ...(item.description ? [{ text: item.description, fontSize: 8, color: "#64748b", margin: [0, 3, 0, 0] }] : [])
    ]
  };
  return image
    ? { columns: [{ image, width: 40, height: 40, fit: [40, 40] }, { ...details, width: "*", margin: [8, 0, 0, 0] }], columnGap: 0 }
    : details;
}

async function loadPdfImage(imageUrl?: string): Promise<string | undefined> {
  if (!imageUrl) return undefined;
  if (/^data:image\/(?:png|jpe?g);base64,/i.test(imageUrl)) return imageUrl;
  if (!/^https:\/\//i.test(imageUrl)) return undefined;
  try {
    await assertWebhookDeliveryTarget(imageUrl);
    const response = await fetch(imageUrl, { signal: AbortSignal.timeout(4000), redirect: "error" });
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase();
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (!response.ok || !contentType || !["image/png", "image/jpeg"].includes(contentType) || contentLength > 2_000_000) return undefined;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 2_000_000) return undefined;
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  } catch {
    return undefined;
  }
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

function isHandlebarsOptions(value: unknown): value is { data?: { root?: { currency?: unknown; currencyDefinitions?: ReturnType<typeof getCurrencyDefinitions> } } } {
  return isRecord(value) && "hash" in value;
}
