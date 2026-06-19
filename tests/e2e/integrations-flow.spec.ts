import { expect, test } from "@playwright/test";
import { createCompany, loginAsAdmin } from "./helpers";

test("admin can manage api keys and webhook deliveries", async ({ page }) => {
  const suffix = `${Date.now()}`;
  const companyTitle = `E2E Integration Company ${suffix}`;
  const apiKeyName = `E2E API Key ${suffix}`;
  const webhookName = `E2E Webhook ${suffix}`;

  await loginAsAdmin(page);
  await createCompany(page, companyTitle, `integration-${suffix}.example.com`);

  await page.getByTestId("nav-settings").click();
  await page.getByTestId("settings-new-api-key").click();
  await page.getByTestId("settings-api-key-name").fill(apiKeyName);
  await expect(page.getByTestId("settings-api-key-permission-crm.read")).toBeChecked();

  const [apiKeyResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/api-keys") && response.request().method() === "POST"),
    page.getByTestId("settings-create-api-key").click()
  ]);
  expect(apiKeyResponse.status()).toBe(201);
  const apiKeyResult = (await apiKeyResponse.json()) as { apiKey: { id: string; name: string; tokenPrefix: string }; token: string };
  expect(apiKeyResult.apiKey.name).toBe(apiKeyName);
  await expect(page.getByTestId("settings-api-key-token")).toContainText(apiKeyResult.token);
  await expect(page.getByTestId(`settings-api-key-row-${apiKeyResult.apiKey.id}`)).toContainText(apiKeyName);

  const bearerRecordsResponse = await page.request.get(`/api/records/companies?q=${encodeURIComponent(companyTitle)}`, {
    headers: { Authorization: `Bearer ${apiKeyResult.token}` }
  });
  expect(bearerRecordsResponse.ok()).toBe(true);
  const bearerRecords = (await bearerRecordsResponse.json()) as { records: Array<{ title: string }> };
  expect(bearerRecords.records.some((record) => record.title === companyTitle)).toBe(true);

  const bearerValidationResponse = await page.request.get("/api/records/contacts?filters=not-json", {
    headers: { Authorization: `Bearer ${apiKeyResult.token}` }
  });
  expect(bearerValidationResponse.status()).toBe(400);
  const bearerAuditResponse = await page.request.get("/api/audit-logs?action=api_error&q=Record%20filters&pageSize=20");
  expect(bearerAuditResponse.ok()).toBe(true);
  const bearerAuditLogs = (await bearerAuditResponse.json()) as Array<{ summary: string; details?: { authType?: string; path?: string } }>;
  expect(
    bearerAuditLogs.some((log) => log.summary.includes("Record filters") && log.details?.authType === "api_key" && log.details?.path === "/api/records/contacts")
  ).toBe(true);

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain(apiKeyName);
    await dialog.accept();
  });
  const [revokeResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes(`/api/api-keys/${apiKeyResult.apiKey.id}`) && response.request().method() === "PATCH"),
    page.getByTestId(`settings-api-key-revoke-${apiKeyResult.apiKey.id}`).click()
  ]);
  expect(revokeResponse.ok()).toBe(true);
  await expect(page.getByTestId(`settings-api-key-row-${apiKeyResult.apiKey.id}`)).toContainText("revoked");

  const revokedBearerResponse = await page.request.get(`/api/records/companies?q=${encodeURIComponent(companyTitle)}`, {
    headers: { Authorization: `Bearer ${apiKeyResult.token}` }
  });
  expect(revokedBearerResponse.status()).toBe(401);

  await page.getByTestId("settings-new-webhook").click();
  await page.getByTestId("settings-webhook-name").fill(webhookName);
  await page.getByTestId("settings-webhook-url").fill(`http://127.0.0.1:9/e2e-webhook-${suffix}`);
  await expect(page.getByTestId("settings-webhook-event-webhook.test")).toBeChecked();

  const [webhookResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/webhooks") && response.request().method() === "POST"),
    page.getByTestId("settings-create-webhook").click()
  ]);
  expect(webhookResponse.status()).toBe(201);
  const webhookResult = (await webhookResponse.json()) as { webhook: { id: string; name: string; active: boolean }; secret: string };
  expect(webhookResult.webhook.name).toBe(webhookName);
  expect(webhookResult.webhook.active).toBe(true);
  await expect(page.getByTestId("settings-webhook-secret")).toContainText(webhookResult.secret);
  await expect(page.getByTestId(`settings-webhook-row-${webhookResult.webhook.id}`)).toContainText(webhookName);

  const [testWebhookResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes(`/api/webhooks/${webhookResult.webhook.id}/test`) && response.request().method() === "POST"),
    page.getByTestId(`settings-webhook-test-${webhookResult.webhook.id}`).click()
  ]);
  expect(testWebhookResponse.status()).toBe(201);
  const delivery = (await testWebhookResponse.json()) as { id: string; event: string; status: string; webhookId: string };
  expect(delivery.webhookId).toBe(webhookResult.webhook.id);
  expect(delivery.event).toBe("webhook.test");
  expect(delivery.status).toBe("failed");
  await expect(page.getByTestId(`settings-webhook-delivery-${delivery.id}`)).toContainText("webhook.test");
  await expect(page.getByTestId(`settings-webhook-delivery-${delivery.id}`)).toContainText("failed");
});
