export type PdfTemplateNode = Record<string, unknown> | PdfTemplateNode[] | string | number | boolean | null;

export interface PdfLayoutColumn {
  type: "col";
  span?: number;
  offset?: number;
  content: PdfTemplateNode[];
  style?: unknown;
  margin?: unknown;
}

export interface PdfLayoutRow {
  type: "row";
  gutter?: number;
  align?: "top" | "center" | "bottom";
  columns: Array<PdfLayoutColumn | PdfSplitter>;
}

export interface PdfSplitter {
  type: "splitter";
  orientation?: "horizontal" | "vertical";
  color?: string;
  thickness?: number;
  style?: "solid" | "dashed";
  margin?: number[];
  height?: number;
}

export interface PdfTemplateValidationIssue {
  path: Array<string | number>;
  message: string;
}

export class PdfTemplateValidationError extends Error {
  readonly issues: PdfTemplateValidationIssue[];

  constructor(issues: PdfTemplateValidationIssue[]) {
    super(issues.map((issue) => `${formatPath(issue.path)} ${issue.message}`).join("; "));
    this.issues = issues;
    this.name = "PdfTemplateValidationError";
  }
}

export function validatePdfTemplate(template: unknown): void {
  const issues: PdfTemplateValidationIssue[] = [];
  validateNode(template, [], issues, false);
  if (issues.length) throw new PdfTemplateValidationError(issues);
}

export function compilePdfTemplateLayout<T = unknown>(template: T): T {
  validatePdfTemplate(template);
  return compileNode(template, false) as T;
}

function validateNode(value: unknown, path: Array<string | number>, issues: PdfTemplateValidationIssue[], insideRow: boolean): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateNode(item, [...path, index], issues, insideRow));
    return;
  }
  if (!isRecord(value)) return;
  if (value.type === "row") {
    if (!Array.isArray(value.columns) || value.columns.length === 0) {
      issues.push({ path: [...path, "columns"], message: "must contain at least one column" });
      return;
    }
    if (value.gutter !== undefined && (!isFiniteNumber(value.gutter) || value.gutter < 0)) issues.push({ path: [...path, "gutter"], message: "must be a non-negative number" });
    if (value.align !== undefined && !["top", "center", "bottom"].includes(String(value.align))) issues.push({ path: [...path, "align"], message: "must be top, center, or bottom" });
    let units = 0;
    value.columns.forEach((column, index) => {
      const columnPath = [...path, "columns", index];
      if (!isRecord(column) || (column.type !== "col" && !(column.type === "splitter" && (column.orientation ?? "horizontal") === "vertical"))) {
        issues.push({ path: columnPath, message: "must be a col or vertical splitter" });
        return;
      }
      if (column.type === "col") {
        const span = typeof column.span === "number" ? column.span : column.span === undefined ? 12 : Number.NaN;
        const offset = typeof column.offset === "number" ? column.offset : column.offset === undefined ? 0 : Number.NaN;
        if (!Number.isInteger(span) || span < 1 || span > 12) issues.push({ path: [...columnPath, "span"], message: "must be between 1 and 12" });
        if (!Number.isInteger(offset) || offset < 0 || offset > 11) issues.push({ path: [...columnPath, "offset"], message: "must be between 0 and 11" });
        if (Number.isInteger(span) && Number.isInteger(offset)) units += span + offset;
        if (!Array.isArray(column.content)) issues.push({ path: [...columnPath, "content"], message: "must be an array" });
        else validateNode(column.content, [...columnPath, "content"], issues, false);
      } else {
        validateSplitter(column, columnPath, issues, true);
      }
    });
    if (units > 12) issues.push({ path: [...path, "columns"], message: `span and offset total must not exceed 12 (received ${units})` });
    return;
  }
  if (value.type === "col") {
    if (!insideRow) issues.push({ path, message: "col may only be used inside row.columns" });
    return;
  }
  if (value.type === "splitter") {
    validateSplitter(value, path, issues, insideRow);
    return;
  }
  if (typeof value.type === "string" && ["row", "col", "splitter"].includes(value.type) === false) {
    // Unknown native pdfmake `type` values are preserved for compatibility.
  }
  Object.entries(value).forEach(([key, item]) => validateNode(item, [...path, key], issues, false));
}

function validateSplitter(value: Record<string, unknown>, path: Array<string | number>, issues: PdfTemplateValidationIssue[], insideRow: boolean): void {
  const orientation = value.orientation ?? "horizontal";
  if (![/^horizontal$/, /^vertical$/].some((pattern) => pattern.test(String(orientation)))) issues.push({ path: [...path, "orientation"], message: "must be horizontal or vertical" });
  if (orientation === "vertical" && !insideRow) issues.push({ path, message: "vertical splitter may only be used inside row.columns" });
  if (orientation === "horizontal" && insideRow) issues.push({ path, message: "horizontal splitter cannot be used inside row.columns" });
  if (value.thickness !== undefined && (!isFiniteNumber(value.thickness) || value.thickness <= 0)) issues.push({ path: [...path, "thickness"], message: "must be greater than 0" });
  if (value.height !== undefined && (!isFiniteNumber(value.height) || value.height <= 0)) issues.push({ path: [...path, "height"], message: "must be greater than 0" });
  if (value.style !== undefined && !["solid", "dashed"].includes(String(value.style))) issues.push({ path: [...path, "style"], message: "must be solid or dashed" });
  if (value.margin !== undefined && (!Array.isArray(value.margin) || ![2, 4].includes(value.margin.length) || value.margin.some((part) => !isFiniteNumber(part)))) issues.push({ path: [...path, "margin"], message: "must be a 2- or 4-number array" });
}

function compileNode(value: unknown, insideRow: boolean): unknown {
  if (Array.isArray(value)) return value.map((item) => compileNode(item, insideRow));
  if (!isRecord(value)) return value;
  if (value.type === "row") return compileRow(value as unknown as PdfLayoutRow);
  if (value.type === "splitter") return compileSplitter(value as unknown as PdfSplitter);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compileNode(item, false)]));
}

function compileRow(row: PdfLayoutRow): Record<string, unknown> {
  const gutter = row.gutter ?? 12;
  const columns: Record<string, unknown>[] = [];
  for (const item of row.columns) {
    if (item.type === "splitter") {
      columns.push({ ...compileSplitter(item), width: item.thickness ?? 1 });
      continue;
    }
    const offset = item.offset ?? 0;
    if (offset) columns.push({ text: "", width: `${(offset / 12) * 100}%` });
    const stack = item.content.map((node) => compileNode(node, false));
    columns.push({
      stack,
      width: `${((item.span ?? 12) / 12) * 100}%`,
      ...(item.style !== undefined ? { style: item.style } : {}),
      ...(item.margin !== undefined ? { margin: item.margin } : {})
    });
  }
  return { columns, columnGap: gutter };
}

function compileSplitter(splitter: PdfSplitter): Record<string, unknown> {
  const vertical = splitter.orientation === "vertical";
  const thickness = splitter.thickness ?? 1;
  const height = splitter.height ?? 24;
  const line: Record<string, unknown> = {
    type: "line",
    x1: 0,
    y1: 0,
    x2: vertical ? 0 : 100,
    y2: vertical ? height : 0,
    lineWidth: thickness,
    lineColor: splitter.color ?? "#e2e8f0"
  };
  if (splitter.style === "dashed") line.dash = { length: 4, space: 3 };
  if (vertical) return { canvas: [line], margin: splitter.margin ?? [0, 0, 0, 0] };
  return {
    table: { widths: ["*"], body: [[{ text: "", border: [false, false, false, true], borderColor: ["", "", "", splitter.color ?? "#e2e8f0"] }]] },
    layout: {
      hLineWidth: (index: number) => index === 1 ? thickness : 0,
      vLineWidth: () => 0,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
      ...(splitter.style === "dashed" ? { hLineStyle: () => ({ dash: { length: 4, space: 3 } }) } : {})
    },
    margin: splitter.margin ?? [0, 12, 0, 12]
  };
}

function formatPath(path: Array<string | number>): string {
  if (!path.length) return "template";
  return path.reduce<string>((result, part) => typeof part === "number" ? `${result}[${part}]` : result ? `${result}.${part}` : part, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
