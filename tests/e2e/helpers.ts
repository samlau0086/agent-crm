import { expect, type Page } from "@playwright/test";

export interface CrmRecordPayload {
  id: string;
  title: string;
  objectKey: string;
  ownerId?: string;
  stageKey?: string;
  data: Record<string, unknown>;
}

export interface UserPayload {
  id: string;
  email: string;
  teamId?: string;
  active: boolean;
}

export async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("admin@example.com");
  await page.locator('input[name="password"]').fill("Admin123!");
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByTestId("nav-dashboard")).toBeVisible();
  await expect(page.getByTestId("crm-workspace")).toHaveAttribute("data-ready", "true");
}

export async function openObject(page: Page, objectKey: string) {
  await page.getByTestId(`nav-${objectKey}`).click();
  await expect(page.getByTestId("crm-workspace")).toHaveAttribute("data-active-object", objectKey);
  await expect(page.getByTestId("crm-workspace")).toHaveAttribute("data-create-form-object", objectKey);
  await expect(page.getByTestId("crm-workspace")).toHaveAttribute("data-list-loading", "false");
}

export async function openCreateRecordPanel(page: Page, objectKey: string) {
  await page.getByTestId(`open-create-record-${objectKey}`).click();
  await expect(page.getByTestId(`create-title-${objectKey}`)).toBeVisible();
}

export async function openImportPanel(page: Page) {
  await page.getByRole("button", { name: "导入" }).click();
  await expect(page.getByTestId("import-csv-input")).toBeVisible();
}

export async function openListSettings(page: Page, objectKey: string) {
  await page.getByRole("button", { name: "列表设置" }).click();
  await expect(page.getByTestId(`view-filter-field-${objectKey}`)).toBeVisible();
}

export async function waitForRecord(page: Page, objectKey: string, title: string): Promise<CrmRecordPayload> {
  let record: CrmRecordPayload | undefined;
  await expect
    .poll(async () => {
      record = await findRecord(page, objectKey, title);
      return record?.id ?? "";
    })
    .not.toBe("");

  return record!;
}

export async function findRecord(page: Page, objectKey: string, title: string): Promise<CrmRecordPayload | undefined> {
  const response = await page.request.get(`/api/records/${objectKey}?q=${encodeURIComponent(title)}&pageSize=50`);
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as { records: CrmRecordPayload[] };
  return payload.records.find((record) => record.title === title);
}

export async function createCompany(page: Page, title: string, domain: string): Promise<CrmRecordPayload> {
  const response = await page.request.post("/api/records/companies", {
    data: {
      title,
      data: {
        domain,
        industry: "software"
      }
    }
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as CrmRecordPayload;
}

export async function findObjectDefinition(page: Page, key: string): Promise<{ key: string } | undefined> {
  const response = await page.request.get("/api/object-definitions");
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as Array<{ key: string }>;
  return payload.find((object) => object.key === key);
}

export async function findFieldDefinition(page: Page, objectKey: string, key: string): Promise<{ key: string } | undefined> {
  const response = await page.request.get(`/api/field-definitions?objectKey=${encodeURIComponent(objectKey)}`);
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as Array<{ key: string }>;
  return payload.find((field) => field.key === key);
}

export async function findUser(page: Page, email: string): Promise<UserPayload | undefined> {
  const response = await page.request.get("/api/users");
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as UserPayload[];
  return payload.find((user) => user.email === email);
}
