export const crmCoreObjectKeys = ["contacts", "companies", "deals", "products", "quotes"] as const;

export type CrmCoreObjectKey = (typeof crmCoreObjectKeys)[number];
export type CrmRouteNavKey =
  | "dashboard"
  | CrmCoreObjectKey
  | "objects"
  | "records"
  | "tasks"
  | "activities"
  | "email"
  | "settings";

export type CrmResolvedRoute = {
  navKey: CrmRouteNavKey;
  objectKey: string;
  path: string;
};

const rootObjectKey = "contacts";

const navPathByKey: Record<Exclude<CrmRouteNavKey, "records">, string> = {
  dashboard: "/dashboard",
  contacts: "/contacts",
  companies: "/companies",
  deals: "/deals",
  products: "/products",
  quotes: "/quotes",
  objects: "/objects",
  tasks: "/tasks",
  activities: "/activities",
  email: "/email",
  settings: "/settings"
};

export function isCoreCrmObjectKey(value: string): value is CrmCoreObjectKey {
  return crmCoreObjectKeys.includes(value as CrmCoreObjectKey);
}

export function crmPathForNav(navKey: CrmRouteNavKey | string, objectKey?: string): string {
  if (navKey === "records" && objectKey) {
    return `/records/${encodeURIComponent(objectKey)}`;
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

  if (isCoreCrmObjectKey(first)) {
    return { navKey: first, objectKey: first, path: crmPathForNav(first) };
  }

  if (first === "records" && second && availableObjectKeys.includes(second)) {
    return { navKey: "records", objectKey: second, path: crmPathForNav("records", second) };
  }

  if (first === "dashboard" || first === "objects" || first === "tasks" || first === "activities" || first === "email" || first === "settings") {
    return { navKey: first, objectKey: rootObjectKey, path: crmPathForNav(first) };
  }

  return null;
}
