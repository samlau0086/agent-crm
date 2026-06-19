import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { createCompany, loginAsAdmin } from "./helpers";

test("admin can inspect backups and export audit logs", async ({ page }) => {
  const suffix = `${Date.now()}`;
  const backupName = `e2e-backup-${suffix}.dump`;
  const companyTitle = `E2E Audit Company ${suffix}`;
  const backupDirectory = resolve(process.cwd(), "backups");

  await mkdir(backupDirectory, { recursive: true });
  await writeFile(resolve(backupDirectory, backupName), `e2e backup ${suffix}\n`, "utf8");

  await loginAsAdmin(page);
  const homeResponse = await page.request.get("/");
  expect(homeResponse.headers()["x-frame-options"]).toBe("DENY");
  expect(homeResponse.headers()["x-content-type-options"]).toBe("nosniff");
  expect(homeResponse.headers()["referrer-policy"]).toBe("same-origin");
  expect(homeResponse.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  const crossSiteWriteResponse = await page.request.post("/api/saved-views", {
    headers: { Origin: "https://evil.example" },
    data: { objectKey: "contacts", name: `E2E Cross Site ${suffix}`, columns: ["title"], isDefault: false }
  });
  expect(crossSiteWriteResponse.status()).toBe(403);
  await expect(crossSiteWriteResponse.json()).resolves.toMatchObject({ code: "CSRF_BLOCKED" });

  const company = await createCompany(page, companyTitle, `audit-${suffix}.example.com`);

  const auditResponse = await page.request.get(`/api/audit-logs?action=create&q=${encodeURIComponent(company.id)}&pageSize=20`);
  expect(auditResponse.ok()).toBe(true);
  const auditLogs = (await auditResponse.json()) as Array<{ id: string; summary: string; entityType: string; entityId?: string }>;
  expect(auditLogs.some((log) => log.entityId === company.id || log.summary.includes(companyTitle))).toBe(true);

  const auditExportResponse = await page.request.get(`/api/audit-logs/export?action=create&q=${encodeURIComponent(company.id)}`);
  expect(auditExportResponse.ok()).toBe(true);
  expect(auditExportResponse.headers()["content-type"]).toContain("text/csv");
  const auditCsv = await auditExportResponse.text();
  expect(auditCsv).toContain(company.id);

  const backupListResponse = await page.request.get("/api/backups");
  expect(backupListResponse.ok()).toBe(true);
  const backups = (await backupListResponse.json()) as Array<{ name: string; sizeBytes: number }>;
  expect(backups.some((backup) => backup.name === backupName && backup.sizeBytes > 0)).toBe(true);

  const backupDownloadResponse = await page.request.get(`/api/backups/${encodeURIComponent(backupName)}/download`);
  expect(backupDownloadResponse.ok()).toBe(true);
  expect(backupDownloadResponse.headers()["content-disposition"]).toContain(backupName);
  await expect(backupDownloadResponse.text()).resolves.toContain(`e2e backup ${suffix}`);

  await page.reload();
  await expect(page.getByTestId("crm-workspace")).toHaveAttribute("data-ready", "true");
  await page.getByTestId("nav-settings").click();
  await expect(page.getByTestId(`settings-backup-row-${backupName}`)).toContainText(backupName);
  await expect(page.getByTestId(`settings-backup-download-${backupName}`)).toHaveAttribute("href", `/api/backups/${encodeURIComponent(backupName)}/download`);

  await page.getByTestId("settings-audit-action-filter").selectOption("create");
  await page.getByTestId("settings-audit-query").fill(company.id);
  await expect(page.locator('[data-testid^="settings-audit-row-"]').first()).toContainText(company.id);
  await expect(page.getByTestId("settings-audit-export")).toHaveAttribute("href", new RegExp(`/api/audit-logs/export\\?.*q=${company.id}`));
});
