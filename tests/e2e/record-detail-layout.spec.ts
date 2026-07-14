import { expect, test } from "@playwright/test";
import { createCompany, loginAsAdmin, type CrmRecordPayload } from "./helpers";

test("contact company and deal share the AI-first responsive detail workspace", async ({ page }) => {
  const suffix = `${Date.now()}`;
  const company = await (async () => {
    await loginAsAdmin(page);
    return createCompany(page, `Detail Company ${suffix}`, `detail-${suffix}.example.com`);
  })();

  const contactResponse = await page.request.post("/api/records/contacts", {
    data: {
      title: `Detail Contact ${suffix}`,
      data: { email: `detail-${suffix}@example.com`, companyId: company.id }
    }
  });
  expect(contactResponse.status()).toBe(201);
  const contact = (await contactResponse.json()) as CrmRecordPayload;

  const dealResponse = await page.request.post("/api/records/deals", {
    data: {
      title: `Detail Deal ${suffix}`,
      data: { amount: 120000, companyId: company.id }
    }
  });
  expect(dealResponse.status()).toBe(201);
  const deal = (await dealResponse.json()) as CrmRecordPayload;

  await page.goto(`/contacts?recordId=${encodeURIComponent(contact.id)}`);
  await expect(page.getByTestId("record-detail-workspace")).toHaveAttribute("data-active-tab", "ai");
  await expect(page.getByTestId("record-detail-reminder-card")).toBeVisible();
  await expect(page.getByTestId("record-detail-summary")).toContainText(contact.title);
  await expect(page.getByTestId("record-detail-context-rail")).toBeVisible();
  await page.getByTestId("record-detail-tab-details").click();
  await expect(page.getByTestId("record-detail-overview")).toBeVisible();
  await page.getByTestId("record-detail-edit").click();
  await expect(page.getByTestId("edit-record-title")).toBeVisible();
  await page.getByTestId("edit-record-title").fill(`Changed ${suffix}`);
  await page.getByTestId("record-detail-cancel").click();
  await expect(page.getByTestId("record-detail-overview")).toBeVisible();
  await expect(page.getByTestId("record-detail-summary")).toContainText(contact.title);

  await page.goto(`/companies?recordId=${encodeURIComponent(company.id)}`);
  await expect(page.getByTestId("record-detail-summary")).toContainText(company.title);
  await expect(page.getByTestId("record-detail-related-card")).toContainText(contact.title);

  await page.goto(`/deals?recordId=${encodeURIComponent(deal.id)}`);
  await expect(page.getByTestId("record-detail-summary")).toContainText(deal.title);
  await expect(page.getByTestId("deal-stage-progress-bar")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByTestId("record-detail-tabs")).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(hasHorizontalOverflow).toBe(false);
});
