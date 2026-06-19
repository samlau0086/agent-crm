import { expect, test } from "@playwright/test";
import {
  createCompany,
  findFieldDefinition,
  findObjectDefinition,
  loginAsAdmin,
  openObject,
  waitForRecord,
  type CrmRecordPayload
} from "./helpers";

test("admin can create custom objects and reference fields", async ({ page }) => {
  const suffix = `${Date.now()}`;
  const companyTitle = `E2E Metadata Company ${suffix}`;
  const partnerKey = `e2epartners${suffix}s`;
  const partnerTitle = `E2E Partner Record ${suffix}`;

  await loginAsAdmin(page);

  const invalidObjectResponse = await page.request.post("/api/object-definitions", {
    data: { key: "Bad Object", label: "", pluralLabel: "Bad Objects", description: "", extra: true }
  });
  expect(invalidObjectResponse.status()).toBe(400);
  const invalidObjectPayload = (await invalidObjectResponse.json()) as { code: string; details?: { fieldErrors?: Record<string, string[]> } };
  expect(invalidObjectPayload.code).toBe("VALIDATION_ERROR");
  expect(invalidObjectPayload.details?.fieldErrors?.key?.length).toBeGreaterThan(0);

  await openObject(page, "companies");
  await page.getByTestId("create-field-companies-domain").fill(`metadata-${suffix}.example.com`);
  await page.getByTestId("create-title-companies").fill(companyTitle);
  await page.getByTestId("create-record-companies").click();
  const company = await waitForRecord(page, "companies", companyTitle);

  await page.getByTestId("nav-settings").click();
  await page.getByTestId("settings-new-object").click();
  await page.getByTestId("settings-object-key").fill(partnerKey);
  await page.getByTestId("settings-object-label").fill(`E2E Partner ${suffix}`);
  await page.getByTestId("settings-object-plural-label").fill(`E2E Partners ${suffix}`);
  await page.getByTestId("settings-object-description").fill("Created by the Playwright metadata flow.");
  await expect(page.getByTestId("settings-object-key")).toHaveValue(partnerKey);
  await expect(page.getByTestId("settings-save-object")).toBeEnabled();
  const [objectCreateResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/object-definitions") && response.request().method() === "POST"),
    page.getByTestId("settings-save-object").click()
  ]);
  expect(objectCreateResponse.status()).toBe(201);
  await expect.poll(async () => Boolean(await findObjectDefinition(page, partnerKey))).toBe(true);

  await page.getByTestId("settings-new-field").click();
  await page.getByTestId("settings-field-object").selectOption(partnerKey);
  await page.getByTestId("settings-field-key").fill("company_id");
  await page.getByTestId("settings-field-label").fill("Related Company");
  await page.getByTestId("settings-field-type").selectOption("reference");
  await page.getByTestId("settings-field-reference-object").selectOption("companies");
  await expect(page.getByTestId("settings-field-object")).toHaveValue(partnerKey);
  await expect(page.getByTestId("settings-field-key")).toHaveValue("company_id");
  await expect(page.getByTestId("settings-save-field")).toBeEnabled();
  const [fieldCreateResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/field-definitions") && response.request().method() === "POST"),
    page.getByTestId("settings-save-field").click()
  ]);
  expect(fieldCreateResponse.status()).toBe(201);
  await expect.poll(async () => Boolean(await findFieldDefinition(page, partnerKey, "company_id"))).toBe(true);

  await page.getByTestId("nav-objects").click();
  await expect(page.getByTestId(`object-entry-${partnerKey}`)).toBeVisible();
  await page.getByTestId(`object-entry-${partnerKey}`).click();
  await expect(page.getByTestId("crm-workspace")).toHaveAttribute("data-active-object", partnerKey);
  await expect(page.getByTestId("crm-workspace")).toHaveAttribute("data-create-form-object", partnerKey);
  await expect(page.getByTestId(`create-field-${partnerKey}-company_id`).locator(`option[value="${company.id}"]`)).toHaveCount(1);

  const lateCompanyTitle = `E2E Late Ref Company ${suffix}`;
  const lateCompanyResponse = await page.request.post("/api/records/companies", {
    data: {
      title: lateCompanyTitle,
      data: {
        domain: `late-ref-${suffix}.example.com`,
        industry: "software"
      }
    }
  });
  expect(lateCompanyResponse.status()).toBe(201);
  const lateCompany = (await lateCompanyResponse.json()) as CrmRecordPayload;

  await page.getByTestId(`create-field-${partnerKey}-company_id-search`).fill(lateCompanyTitle);
  await expect(page.getByTestId(`create-field-${partnerKey}-company_id`).locator(`option[value="${lateCompany.id}"]`)).toHaveCount(1);
  await page.getByTestId(`create-field-${partnerKey}-company_id`).selectOption(lateCompany.id);
  await page.getByTestId(`create-title-${partnerKey}`).fill(partnerTitle);
  await page.getByTestId(`create-record-${partnerKey}`).click();
  const partner = await waitForRecord(page, partnerKey, partnerTitle);
  expect(partner.data.company_id).toBe(lateCompany.id);

  for (let index = 0; index < 55; index += 1) {
    await createCompany(page, `E2E Newer Ref Company ${suffix}-${index}`, `newer-ref-${suffix}-${index}.example.com`);
  }
  await page.reload();
  await expect(page.getByTestId("crm-workspace")).toHaveAttribute("data-ready", "true");
  await page.getByTestId("nav-objects").click();
  await page.getByTestId(`object-entry-${partnerKey}`).click();
  await expect(page.getByTestId("crm-workspace")).toHaveAttribute("data-list-loading", "false");
  await expect(page.getByTestId(`record-row-${partner.id}`)).toBeVisible();
  await page.getByTestId(`record-row-${partner.id}`).click();
  await expect(page.getByTestId(`edit-field-${partnerKey}-company_id`).locator(`option[value="${lateCompany.id}"]`)).toHaveCount(1);
  await expect(page.getByTestId(`edit-field-${partnerKey}-company_id`)).toHaveValue(lateCompany.id);
});
