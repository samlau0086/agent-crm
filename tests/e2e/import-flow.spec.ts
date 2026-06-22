import { expect, test } from "@playwright/test";
import { loginAsAdmin, openImportPanel, openObject } from "./helpers";

test("admin can manage csv import presets and inspect import job details", async ({ page }) => {
  const suffix = `${Date.now()}`;
  const apiImportPresetName = `E2E API Import Preset ${suffix}`;
  const uiImportPresetName = `E2E UI Import Preset ${suffix}`;

  await loginAsAdmin(page);

  const invalidCsvResponse = await page.request.post("/api/imports/csv", {
    data: { objectKey: "contacts", csv: "title,email\nBad,bad@example.com", strategy: "merge" }
  });
  expect(invalidCsvResponse.status()).toBe(400);
  const invalidCsvPayload = (await invalidCsvResponse.json()) as { code: string };
  expect(invalidCsvPayload.code).toBe("VALIDATION_ERROR");

  const importJobResponse = await page.request.post("/api/imports/jobs", {
    data: {
      objectKey: "contacts",
      csv: `title,email\nE2E Import Job ${suffix},import-job-${suffix}@example.com`,
      strategy: "skip-invalid",
      presetId: `preset-e2e-${suffix}`,
      presetName: `E2E Import Preset Source ${suffix}`
    }
  });
  expect(importJobResponse.status()).toBe(201);
  const importJob = (await importJobResponse.json()) as {
    id: string;
    status: string;
    createdCount: number;
    errorCount: number;
    sourcePayload?: { presetName?: string };
  };
  expect(importJob.status).toBe("completed");
  expect(importJob.createdCount).toBe(1);
  expect(importJob.errorCount).toBe(0);
  expect(importJob.sourcePayload?.presetName).toBe(`E2E Import Preset Source ${suffix}`);

  const importJobDetailsResponse = await page.request.get(`/api/imports/jobs/${importJob.id}`);
  expect(importJobDetailsResponse.ok()).toBe(true);
  const importJobDetails = (await importJobDetailsResponse.json()) as { id: string; sourcePayload?: { presetName?: string } };
  expect(importJobDetails.id).toBe(importJob.id);
  expect(importJobDetails.sourcePayload?.presetName).toBe(`E2E Import Preset Source ${suffix}`);

  const importJobsResponse = await page.request.get("/api/imports/jobs?objectKey=contacts");
  expect(importJobsResponse.ok()).toBe(true);
  const importJobs = (await importJobsResponse.json()) as Array<{ id: string }>;
  expect(importJobs.some((job) => job.id === importJob.id)).toBe(true);

  const invalidImportPresetResponse = await page.request.post("/api/imports/presets", {
    data: { objectKey: "contacts", name: `Broken Import Preset ${suffix}`, mapping: { mail: "missingField" } }
  });
  expect(invalidImportPresetResponse.status()).toBe(400);
  const invalidImportPresetPayload = (await invalidImportPresetResponse.json()) as { code: string; error: string };
  expect(invalidImportPresetPayload.code).toBe("BAD_REQUEST");
  expect(invalidImportPresetPayload.error).toContain("unknown field");

  const apiImportPresetResponse = await page.request.post("/api/imports/presets", {
    data: {
      objectKey: "contacts",
      name: apiImportPresetName,
      strategy: "update-existing",
      mapping: { full_name: "title", mail: "email" }
    }
  });
  expect(apiImportPresetResponse.status()).toBe(201);
  const apiImportPreset = (await apiImportPresetResponse.json()) as { id: string; name: string; strategy: string; mapping?: Record<string, string> };
  expect(apiImportPreset.name).toBe(apiImportPresetName);
  expect(apiImportPreset.strategy).toBe("update-existing");
  expect(apiImportPreset.mapping).toEqual({ full_name: "title", mail: "email" });

  const apiImportPresetUpdateResponse = await page.request.patch(`/api/imports/presets/${apiImportPreset.id}`, {
    data: {
      name: `${apiImportPresetName} Updated`,
      strategy: "all-or-nothing",
      mapping: { full_name: "title" }
    }
  });
  expect(apiImportPresetUpdateResponse.ok()).toBe(true);
  const updatedApiImportPreset = (await apiImportPresetUpdateResponse.json()) as {
    id: string;
    name: string;
    strategy: string;
    mapping?: Record<string, string>;
  };
  expect(updatedApiImportPreset.id).toBe(apiImportPreset.id);
  expect(updatedApiImportPreset.name).toBe(`${apiImportPresetName} Updated`);
  expect(updatedApiImportPreset.strategy).toBe("all-or-nothing");
  expect(updatedApiImportPreset.mapping).toEqual({ full_name: "title" });

  const importPresetsResponse = await page.request.get("/api/imports/presets?objectKey=contacts");
  expect(importPresetsResponse.ok()).toBe(true);
  const importPresets = (await importPresetsResponse.json()) as Array<{ id: string }>;
  expect(importPresets.some((preset) => preset.id === apiImportPreset.id)).toBe(true);

  const deleteApiImportPresetResponse = await page.request.delete(`/api/imports/presets/${apiImportPreset.id}`);
  expect(deleteApiImportPresetResponse.ok()).toBe(true);

  await openObject(page, "contacts");
  await openImportPanel(page);
  await page.getByTestId("import-csv-input").fill(`full_name,mail\nE2E Preset Contact ${suffix},preset-${suffix}@example.com`);
  await page.getByTestId("import-preview-submit").click();
  await expect(page.getByTestId("csv-mapping-full_name")).toBeVisible();
  await page.getByTestId("csv-mapping-full_name").selectOption("title");
  await page.getByTestId("csv-mapping-mail").selectOption("email");
  await page.getByTestId("import-strategy-select").selectOption("update-existing");
  await page.getByTestId("import-preset-name").fill(uiImportPresetName);

  const uiImportPresetResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/imports/presets") && response.request().method() === "POST"
  );
  await page.getByTestId("import-preset-save").click();
  const uiImportPresetResponse = await uiImportPresetResponsePromise;
  expect(uiImportPresetResponse.status()).toBe(201);
  const uiImportPreset = (await uiImportPresetResponse.json()) as { id: string; mapping?: Record<string, string>; strategy: string };
  expect(uiImportPreset.mapping).toEqual({ full_name: "title", mail: "email" });
  expect(uiImportPreset.strategy).toBe("update-existing");

  await page.getByTestId("import-strategy-select").selectOption("all-or-nothing");
  await page.getByTestId("import-preset-name").fill(`${uiImportPresetName} Updated`);
  const uiImportPresetUpdateResponsePromise = page.waitForResponse(
    (response) => response.url().includes(`/api/imports/presets/${uiImportPreset.id}`) && response.request().method() === "PATCH"
  );
  await page.getByTestId("import-preset-save").click();
  const uiImportPresetUpdateResponse = await uiImportPresetUpdateResponsePromise;
  expect(uiImportPresetUpdateResponse.ok()).toBe(true);
  const updatedUiImportPreset = (await uiImportPresetUpdateResponse.json()) as {
    id: string;
    name: string;
    mapping?: Record<string, string>;
    strategy: string;
  };
  expect(updatedUiImportPreset.id).toBe(uiImportPreset.id);
  expect(updatedUiImportPreset.name).toBe(`${uiImportPresetName} Updated`);
  expect(updatedUiImportPreset.strategy).toBe("all-or-nothing");
  expect(updatedUiImportPreset.mapping).toEqual({ full_name: "title", mail: "email" });

  await page.reload();
  await expect(page.getByTestId("crm-workspace")).toHaveAttribute("data-ready", "true");
  await openObject(page, "contacts");
  await openImportPanel(page);

  await page.getByTestId(`import-job-details-${importJob.id}`).click();
  await expect(page.getByTestId("import-job-detail-panel")).toContainText(`E2E Import Preset Source ${suffix}`);

  await page.getByTestId("import-csv-input").fill(`full_name,mail\nE2E Preset Reload ${suffix},preset-reload-${suffix}@example.com`);
  await page.getByTestId("import-preview-submit").click();
  await expect(page.getByTestId("csv-mapping-full_name")).toBeVisible();
  await page.getByTestId("import-strategy-select").selectOption("skip-invalid");
  await page.getByTestId("import-preset-select").selectOption(uiImportPreset.id);
  await page.getByTestId("import-preset-apply").click();
  await expect(page.getByTestId("import-strategy-select")).toHaveValue("all-or-nothing");
  await page.getByTestId("import-preview-submit").click();
  await expect(page.getByTestId("csv-mapping-full_name")).toBeVisible();
  await expect(page.getByTestId("csv-mapping-full_name")).toHaveValue("title");
  await expect(page.getByTestId("csv-mapping-mail")).toHaveValue("email");

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain(`${uiImportPresetName} Updated`);
    await dialog.accept();
  });
  const deleteUiImportPresetResponsePromise = page.waitForResponse(
    (response) => response.url().includes(`/api/imports/presets/${uiImportPreset.id}`) && response.request().method() === "DELETE"
  );
  await page.getByTestId("import-preset-delete").click();
  const deleteUiImportPresetResponse = await deleteUiImportPresetResponsePromise;
  expect(deleteUiImportPresetResponse.ok()).toBe(true);
  await expect(page.getByTestId("import-preset-select").locator(`option[value="${uiImportPreset.id}"]`)).toHaveCount(0);
});
