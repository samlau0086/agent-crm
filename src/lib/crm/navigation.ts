export const crmCoreObjectKeys = ["contacts", "companies", "deals", "products", "quotes", "salesorders", "proformainvoices", "commercialinvoices"] as const;

export type CrmCoreObjectKey = (typeof crmCoreObjectKeys)[number];
export type CrmRouteNavKey =
  | "dashboard"
  | "sales-documents"
  | CrmCoreObjectKey
  | "objects"
  | "records"
  | "tasks"
  | "activities"
  | "record-approvals"
  | "automation"
  | "email"
  | "settings";

export type CrmResolvedRoute = {
  navKey: CrmRouteNavKey;
  objectKey: string;
  path: string;
};

const rootObjectKey = "contacts";
const salesDocumentObjectKeys = ["quotes", "salesorders", "proformainvoices", "commercialinvoices"] as const;

const navPathByKey: Record<Exclude<CrmRouteNavKey, "records">, string> = {
  dashboard: "/dashboard",
  contacts: "/contacts",
  companies: "/companies",
  deals: "/deals",
  products: "/products",
  "sales-documents": "/sales-documents",
  quotes: "/sales-documents",
  salesorders: "/sales-documents",
  proformainvoices: "/sales-documents",
  commercialinvoices: "/sales-documents",
  objects: "/objects",
  tasks: "/tasks",
  activities: "/activities",
  "record-approvals": "/record-approvals",
  automation: "/automation",
  email: "/email",
  settings: "/settings"
};

export function isCoreCrmObjectKey(value: string): value is CrmCoreObjectKey {
  return crmCoreObjectKeys.includes(value as CrmCoreObjectKey);
}

export function isSalesDocumentRouteObjectKey(value: string): value is (typeof salesDocumentObjectKeys)[number] {
  return salesDocumentObjectKeys.includes(value as (typeof salesDocumentObjectKeys)[number]);
}

export function crmPathForNav(navKey: CrmRouteNavKey | string, objectKey?: string): string {
  if (navKey === "records" && objectKey) {
    return `/records/${encodeURIComponent(objectKey)}`;
  }
  if (navKey === "sales-documents" || isSalesDocumentRouteObjectKey(navKey)) {
    return "/sales-documents";
  }

  return navPathByKey[navKey as Exclude<CrmRouteNavKey, "records">] ?? "/dashboard";
}

export function resolveCrmRoute(segments: string[] = [], availableObjectKeys: string[] = []): CrmResolvedRoute | null {
  const [rawFirst, rawSecond] = segments.filter(Boolean);
  const first = rawFirst ? decodeURIComponent(rawFirst) : "";
  const second = rawSecond ? decodeURIComponent(rawSecond) : "";

  if (!first) {
    return { navKey: "dashboard", objectKey: rootObjectKey, path: "/" };
  }

  if (first === "sales-documents") {
    return { navKey: "sales-documents", objectKey: "quotes", path: crmPathForNav("sales-documents") };
  }

  if (isSalesDocumentRouteObjectKey(first)) {
    return { navKey: "sales-documents", objectKey: first, path: crmPathForNav("sales-documents") };
  }

  if (isCoreCrmObjectKey(first)) {
    return { navKey: first, objectKey: first, path: crmPathForNav(first) };
  }

  if (first === "records" && second && availableObjectKeys.includes(second)) {
    return { navKey: "records", objectKey: second, path: crmPathForNav("records", second) };
  }

  if (first === "dashboard" || first === "objects" || first === "tasks" || first === "activities" || first === "record-approvals" || first === "automation" || first === "email" || first === "settings") {
    return { navKey: first, objectKey: rootObjectKey, path: crmPathForNav(first) };
  }

  return null;
}
