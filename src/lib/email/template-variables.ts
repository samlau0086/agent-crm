import type { CrmRecord, FieldDefinition } from "@/lib/crm/types";

export type EmailTemplateVariableScope = "contact" | "company";

export interface EmailTemplateVariableDefinition {
  key: string;
  token: string;
  label: string;
  scope: EmailTemplateVariableScope;
}

export interface EmailTemplateContext {
  recipientEmail: string;
  contact?: CrmRecord;
  company?: CrmRecord;
}

export interface RenderedEmailTemplate {
  value: string;
  missingVariables: string[];
}

const templateVariablePattern = /\{\{\s*(contact|company)\.([A-Za-z0-9_-]+)\s*\}\}/g;

const commonVariables: EmailTemplateVariableDefinition[] = [
  { key: "contact.firstName", token: "{{contact.firstName}}", label: "名字", scope: "contact" },
  { key: "contact.lastName", token: "{{contact.lastName}}", label: "姓氏", scope: "contact" },
  { key: "contact.fullName", token: "{{contact.fullName}}", label: "完整姓名", scope: "contact" },
  { key: "contact.email", token: "{{contact.email}}", label: "邮箱", scope: "contact" },
  { key: "company.name", token: "{{company.name}}", label: "公司名称", scope: "company" },
  { key: "company.address", token: "{{company.address}}", label: "公司地址", scope: "company" }
];

export function getEmailTemplateVariableDefinitions(fields: FieldDefinition[]): EmailTemplateVariableDefinition[] {
  const definitions = [...commonVariables];
  const seen = new Set(definitions.map((definition) => definition.key));
  for (const field of fields) {
    const scope = field.objectKey === "contacts" ? "contact" : field.objectKey === "companies" ? "company" : undefined;
    if (!scope || field.key === "companyId") {
      continue;
    }
    const key = `${scope}.${field.key}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    definitions.push({ key, token: `{{${key}}}`, label: field.label, scope });
  }
  return definitions;
}

export function hasEmailTemplateVariables(value: string): boolean {
  templateVariablePattern.lastIndex = 0;
  return templateVariablePattern.test(value);
}

export function renderEmailTemplate(value: string, context: EmailTemplateContext, options: { html?: boolean } = {}): RenderedEmailTemplate {
  const missingVariables = new Set<string>();
  templateVariablePattern.lastIndex = 0;
  const rendered = value.replace(templateVariablePattern, (_match, scope: EmailTemplateVariableScope, fieldKey: string) => {
    const variableKey = `${scope}.${fieldKey}`;
    const resolved = resolveTemplateVariable(scope, fieldKey, context);
    if (!resolved) {
      missingVariables.add(variableKey);
      return "";
    }
    return options.html ? escapeHtml(resolved) : resolved;
  });
  return { value: rendered, missingVariables: [...missingVariables] };
}

function resolveTemplateVariable(scope: EmailTemplateVariableScope, fieldKey: string, context: EmailTemplateContext): string {
  if (scope === "contact") {
    if (fieldKey === "email") {
      return context.recipientEmail;
    }
    const contact = context.contact;
    if (!contact) {
      return "";
    }
    if (fieldKey === "fullName" || fieldKey === "name" || fieldKey === "title") {
      return contact.title.trim();
    }
    if (fieldKey === "firstName" || fieldKey === "lastName") {
      const explicit = formatTemplateValue(contact.data[fieldKey]);
      if (explicit) {
        return explicit;
      }
      const parts = contact.title.trim().split(/\s+/).filter(Boolean);
      return fieldKey === "firstName" ? (parts[0] ?? "") : (parts.slice(1).join(" ") || parts[0] || "");
    }
    return formatTemplateValue(contact.data[fieldKey]);
  }

  const company = context.company;
  if (!company) {
    return "";
  }
  if (fieldKey === "name" || fieldKey === "title") {
    return company.title.trim();
  }
  if (fieldKey === "address") {
    return formatTemplateValue(company.data.address) || formatFirstCompanyAddress(company.data.billingAddresses) || formatFirstCompanyAddress(company.data.shippingAddresses);
  }
  return formatTemplateValue(company.data[fieldKey]);
}

function formatTemplateValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(formatTemplateValue).filter(Boolean).join(", ");
  }
  if (value && typeof value === "object") {
    return formatAddressObject(value as Record<string, unknown>);
  }
  return "";
}

function formatFirstCompanyAddress(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }
  const first = value.find((candidate) => candidate && typeof candidate === "object") as Record<string, unknown> | undefined;
  return first ? formatAddressObject(first) : "";
}

function formatAddressObject(value: Record<string, unknown>): string {
  return [value.line1, value.line2, value.city, value.region, value.postalCode, value.country]
    .map(formatTemplateValue)
    .filter(Boolean)
    .join(", ");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
