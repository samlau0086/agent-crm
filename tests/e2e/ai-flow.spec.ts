import { expect, test } from "@playwright/test";
import { findRecord, loginAsAdmin, openCreateRecordPanel, openListSettings, openObject, waitForRecord, type CrmRecordPayload } from "./helpers";

test("admin can use CRM AI without mutating source records", async ({ page }) => {
  const suffix = `${Date.now()}`;
  const companyTitle = `E2E AI Company ${suffix}`;
  const contactTitle = `E2E AI Contact ${suffix}`;
  const hiddenSourceTitle = `E2E Hidden AI Source ${suffix}`;

  await loginAsAdmin(page);

  const invalidAiResponse = await page.request.post("/api/ai/query", {
    data: { question: "", objectKey: "contacts" }
  });
  expect(invalidAiResponse.status()).toBe(400);
  const invalidAiPayload = (await invalidAiResponse.json()) as { code: string };
  expect(invalidAiPayload.code).toBe("VALIDATION_ERROR");

  await openObject(page, "companies");
  await openCreateRecordPanel(page, "companies");
  await page.getByTestId("create-field-companies-domain").fill(`ai-${suffix}.example.com`);
  await page.getByTestId("create-title-companies").fill(companyTitle);
  await page.getByTestId("create-record-companies").click();
  const company = await waitForRecord(page, "companies", companyTitle);

  await openObject(page, "contacts");
  await openCreateRecordPanel(page, "contacts");
  await page.getByTestId("create-field-contacts-email").fill(`ai-contact-${suffix}@example.com`);
  await page.getByTestId("create-field-contacts-phone").fill("+86 137 0000 0000");
  await page.getByTestId("create-field-contacts-companyId").selectOption(company.id);
  await page.getByTestId("create-owner-contacts").selectOption("user-sales");
  await page.getByTestId("create-title-contacts").fill(contactTitle);
  await page.getByTestId("create-record-contacts").click();
  const contact = await waitForRecord(page, "contacts", contactTitle);

  await openListSettings(page, "contacts");
  await page.getByTestId("view-filter-field-contacts").selectOption("");
  await expect(page.getByTestId("crm-workspace")).toHaveAttribute("data-list-loading", "false");
  await page.getByTestId("record-search-contacts").fill(contactTitle);
  await expect(page.getByTestId("crm-workspace")).toHaveAttribute("data-list-loading", "false");
  await expect(page.getByTestId(`record-row-${contact.id}`)).toBeVisible();
  await page.getByTestId(`record-row-${contact.id}`).click();

  await expect(page.getByTestId("ai-generate-summary")).toBeVisible();
  await page.getByTestId("ai-generate-summary").click();
  await expect.poll(async () => (await page.getByTestId("ai-summary-result").textContent())?.trim() ?? "").not.toBe("");
  await expect(page.locator('[data-testid^="ai-source-record-"]').first()).toBeVisible();
  await page.locator('[data-testid^="ai-source-record-"]').first().click();
  await expect(page.getByTestId("edit-record-title")).toHaveValue(contactTitle);

  const hiddenSourceResponse = await page.request.post("/api/records/contacts", {
    data: {
      title: hiddenSourceTitle,
      data: {
        email: `hidden-ai-source-${suffix}@example.com`,
        phone: "+86 138 0000 0000",
        companyId: company.id
      }
    }
  });
  expect(hiddenSourceResponse.status()).toBe(201);
  const hiddenSource = (await hiddenSourceResponse.json()) as CrmRecordPayload;

  await page.getByTestId("ai-query-input").fill(`查找 "${hiddenSourceTitle}"`);
  await page.getByTestId("ai-query-submit").click();
  await expect(page.getByTestId(`ai-source-record-${hiddenSource.id}`)).toBeVisible();
  await page.getByTestId(`ai-source-record-${hiddenSource.id}`).click();
  await expect(page.getByTestId("edit-record-title")).toHaveValue(hiddenSourceTitle);

  const beforeSuggestions = await findRecord(page, "contacts", hiddenSourceTitle);
  expect(beforeSuggestions?.data.email).toBe(`hidden-ai-source-${suffix}@example.com`);
  expect(beforeSuggestions?.data.companyId).toBe(company.id);

  await page.getByTestId("ai-generate-next-actions").click();
  await expect(page.getByTestId("ai-next-actions-result")).toContainText("AI");

  const afterSuggestions = await findRecord(page, "contacts", hiddenSourceTitle);
  expect(afterSuggestions?.title).toBe(beforeSuggestions?.title);
  expect(afterSuggestions?.ownerId).toBe(beforeSuggestions?.ownerId);
  expect(afterSuggestions?.data.email).toBe(beforeSuggestions?.data.email);
  expect(afterSuggestions?.data.phone).toBe(beforeSuggestions?.data.phone);
  expect(afterSuggestions?.data.companyId).toBe(beforeSuggestions?.data.companyId);
});
