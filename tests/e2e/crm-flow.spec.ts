import { expect, test } from "@playwright/test";
import { findRecord, loginAsAdmin, openObject, waitForRecord } from "./helpers";

test("admin can complete the core CRM sales flow", async ({ page }) => {
  const suffix = `${Date.now()}`;
  const companyTitle = `E2E Company ${suffix}`;
  const contactTitle = `E2E Contact ${suffix}`;
  const dealTitle = `E2E Deal ${suffix}`;
  const settingsViewName = `E2E Company Filter View ${suffix}`;

  await loginAsAdmin(page);

  const invalidFiltersResponse = await page.request.get(`/api/records/contacts?filters=${encodeURIComponent(JSON.stringify([{ field: "", operator: "bad", value: "" }]))}`);
  expect(invalidFiltersResponse.status()).toBe(400);
  const invalidFiltersPayload = (await invalidFiltersResponse.json()) as { code: string };
  expect(invalidFiltersPayload.code).toBe("VALIDATION_ERROR");

  const invalidActivityResponse = await page.request.post("/api/activities", {
    data: { type: "task", title: "" }
  });
  expect(invalidActivityResponse.status()).toBe(400);
  const invalidActivityPayload = (await invalidActivityResponse.json()) as { code: string };
  expect(invalidActivityPayload.code).toBe("VALIDATION_ERROR");

  const invalidViewResponse = await page.request.post("/api/saved-views", {
    data: { objectKey: "contacts", name: "Bad View", columns: [], isDefault: false }
  });
  expect(invalidViewResponse.status()).toBe(400);
  const invalidViewPayload = (await invalidViewResponse.json()) as { code: string };
  expect(invalidViewPayload.code).toBe("VALIDATION_ERROR");

  const invalidViewFieldResponse = await page.request.post("/api/saved-views", {
    data: { objectKey: "contacts", name: "Bad Field View", columns: ["title", "missingField"], isDefault: false }
  });
  expect(invalidViewFieldResponse.status()).toBe(400);
  const invalidViewFieldPayload = (await invalidViewFieldResponse.json()) as { code: string; error: string };
  expect(invalidViewFieldPayload.code).toBe("VALIDATION_ERROR");
  expect(invalidViewFieldPayload.error).toContain("unknown column missingField");

  await expect
    .poll(async () => {
      const response = await page.request.get("/api/audit-logs?action=api_error&q=VALIDATION_ERROR&pageSize=20");
      expect(response.ok()).toBe(true);
      const payload = (await response.json()) as Array<{ action: string; entityType: string; summary: string }>;
      return payload.filter((log) => log.action === "api_error" && log.entityType === "api_request" && log.summary.includes("VALIDATION_ERROR")).length;
    })
    .toBeGreaterThan(0);

  await openObject(page, "companies");
  await page.getByTestId("create-field-companies-domain").fill(`e2e-${suffix}.example.com`);
  await page.getByTestId("create-title-companies").fill(companyTitle);
  await page.getByTestId("create-record-companies").click();
  const company = await waitForRecord(page, "companies", companyTitle);

  await openObject(page, "contacts");
  await expect(page.getByTestId("topbar-export-records")).toHaveAttribute("href", /\/api\/records\/contacts\/export/);
  await page.getByTestId("create-field-contacts-email").fill(`contact-${suffix}@example.com`);
  await page.getByTestId("create-field-contacts-phone").fill("+86 139 0000 0000");
  await page.getByTestId("create-field-contacts-companyId").selectOption(company.id);
  await page.getByTestId("create-owner-contacts").selectOption("user-sales");
  await page.getByTestId("create-title-contacts").fill(contactTitle);
  await page.getByTestId("create-record-contacts").click();
  const contact = await waitForRecord(page, "contacts", contactTitle);
  expect(contact.data.companyId).toBe(company.id);
  expect(contact.ownerId).toBe("user-sales");
  await page.getByTestId("view-filter-field-contacts").selectOption("companyId");
  await page.getByTestId("view-filter-value-contacts-search").fill(companyTitle);
  await expect(page.getByTestId("view-filter-value-contacts").locator(`option[value="${company.id}"]`)).toHaveCount(1);
  await page.getByTestId("view-filter-value-contacts").selectOption(company.id);
  await expect(page.getByTestId("crm-workspace")).toHaveAttribute("data-list-loading", "false");
  await expect(page.getByTestId(`record-row-${contact.id}`)).toBeVisible();
  await page.getByTestId("view-filter-field-contacts").selectOption("ownerId");
  await page.getByTestId("view-filter-value-contacts").selectOption("user-sales");
  await expect(page.getByTestId("crm-workspace")).toHaveAttribute("data-list-loading", "false");
  await expect(page.getByTestId(`record-row-${contact.id}`)).toBeVisible();

  const apiKeyResponse = await page.request.post("/api/api-keys", {
    data: {
      name: `E2E API Key ${suffix}`,
      permissions: ["crm.read"]
    }
  });
  expect(apiKeyResponse.status()).toBe(201);
  const apiKeyResult = (await apiKeyResponse.json()) as { apiKey: { id: string; tokenPrefix: string; permissions: string[] }; token: string };
  expect(apiKeyResult.token).toContain(apiKeyResult.apiKey.tokenPrefix);
  expect(apiKeyResult.apiKey.permissions).toEqual(["crm.read"]);

  const bearerRecordsResponse = await page.request.get(`/api/records/contacts?search=${encodeURIComponent(contactTitle)}`, {
    headers: { Authorization: `Bearer ${apiKeyResult.token}` }
  });
  expect(bearerRecordsResponse.ok()).toBe(true);
  const bearerRecords = (await bearerRecordsResponse.json()) as { records: Array<{ id: string }> };
  expect(bearerRecords.records.map((record) => record.id)).toEqual([contact.id]);

  const revokeApiKeyResponse = await page.request.patch(`/api/api-keys/${apiKeyResult.apiKey.id}`, {
    data: { action: "revoke" }
  });
  expect(revokeApiKeyResponse.ok()).toBe(true);
  const revokedBearerResponse = await page.request.get(`/api/records/contacts?search=${encodeURIComponent(contactTitle)}`, {
    headers: { Authorization: `Bearer ${apiKeyResult.token}` }
  });
  expect(revokedBearerResponse.status()).toBe(401);

  await openObject(page, "deals");
  await page.getByTestId("create-field-deals-amount").fill("660000");
  await page.getByTestId("create-field-deals-closeDate").fill("2026-08-31");
  await page.getByTestId("create-field-deals-companyId").selectOption(company.id);
  await page.getByTestId("create-title-deals").fill(dealTitle);
  await page.getByTestId("create-record-deals").click();
  const deal = await waitForRecord(page, "deals", dealTitle);
  expect(deal.data.companyId).toBe(company.id);
  expect(deal.stageKey).toBe("new");

  await page.getByTestId("record-search-deals").fill(dealTitle);
  await expect(page.getByTestId(`record-row-${deal.id}`)).toBeVisible();
  await page.getByTestId(`record-row-${deal.id}`).click();
  await page.getByTestId("move-deal-next-stage").click();
  await expect.poll(async () => (await findRecord(page, "deals", dealTitle))?.stageKey).toBe("qualified");

  await page.getByTestId("nav-settings").click();
  await page.getByTestId("settings-new-view").click();
  await page.getByTestId("settings-view-object").selectOption("contacts");
  await page.getByTestId("settings-view-name").fill(settingsViewName);
  await page.getByTestId("settings-view-columns").fill("title, email, companyId");
  await page.getByTestId("settings-view-filter-field").selectOption("companyId");
  await page.getByTestId("settings-view-filter-value-search").fill(companyTitle);
  await expect(page.getByTestId("settings-view-filter-value").locator(`option[value="${company.id}"]`)).toHaveCount(1);
  await page.getByTestId("settings-view-filter-value").selectOption(company.id);
  const savedViewResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/saved-views") && response.request().method() === "POST");
  await page.getByTestId("settings-save-view").click();
  const savedViewResponse = await savedViewResponsePromise;
  expect(savedViewResponse.status()).toBe(201);
  const settingsView = (await savedViewResponse.json()) as { filters?: Array<{ field: string; operator: string; value: string }> };
  expect(settingsView.filters).toEqual([{ field: "companyId", operator: "equals", value: company.id }]);

});
