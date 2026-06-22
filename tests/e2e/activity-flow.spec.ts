import { expect, test } from "@playwright/test";
import { loginAsAdmin, openCreateRecordPanel, openListSettings, openObject, waitForRecord } from "./helpers";

test("admin can add notes tasks and manage the activity timeline", async ({ page }) => {
  const suffix = `${Date.now()}`;
  const companyTitle = `E2E Activity Company ${suffix}`;
  const contactTitle = `E2E Activity Contact ${suffix}`;
  const noteTitle = `E2E Activity Note ${suffix}`;
  const taskTitle = `E2E Activity Task ${suffix}`;
  const dueDate = "2026-12-31";

  await loginAsAdmin(page);

  await openObject(page, "companies");
  await openCreateRecordPanel(page, "companies");
  await page.getByTestId("create-field-companies-domain").fill(`activity-${suffix}.example.com`);
  await page.getByTestId("create-title-companies").fill(companyTitle);
  await page.getByTestId("create-record-companies").click();
  const company = await waitForRecord(page, "companies", companyTitle);

  await openObject(page, "contacts");
  await openCreateRecordPanel(page, "contacts");
  await page.getByTestId("create-field-contacts-email").fill(`activity-${suffix}@example.com`);
  await page.getByTestId("create-field-contacts-phone").fill("+86 137 0000 0000");
  await page.getByTestId("create-field-contacts-companyId").selectOption(company.id);
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

  await page.getByTestId("activity-type").selectOption("note");
  await page.getByTestId("activity-title").fill(noteTitle);
  await page.getByTestId("activity-body").fill(`Note body ${suffix}`);
  const [noteResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/activities") && response.request().method() === "POST"),
    page.getByTestId("activity-submit").click()
  ]);
  expect(noteResponse.status()).toBe(201);
  const note = (await noteResponse.json()) as ActivityPayload;
  expect(note.recordId).toBe(contact.id);
  expect(note.type).toBe("note");
  await expect(page.getByTestId(`record-note-${note.id}`)).toContainText(noteTitle);
  await expect(page.getByTestId(`record-note-${note.id}`)).toContainText(`Note body ${suffix}`);
  await expect(page.getByTestId(`record-activity-${note.id}`)).toContainText(noteTitle);

  await page.getByTestId("activity-type").selectOption("task");
  await page.getByTestId("activity-due-at").fill(dueDate);
  await page.getByTestId("activity-title").fill(taskTitle);
  await page.getByTestId("activity-body").fill(`Task body ${suffix}`);
  const [taskResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/activities") && response.request().method() === "POST"),
    page.getByTestId("activity-submit").click()
  ]);
  expect(taskResponse.status()).toBe(201);
  const task = (await taskResponse.json()) as ActivityPayload;
  expect(task.recordId).toBe(contact.id);
  expect(task.type).toBe("task");
  expect(task.dueAt).toContain(dueDate);
  await expect(page.getByTestId(`record-task-${task.id}`)).toContainText(taskTitle);
  await expect(page.getByTestId(`record-activity-${task.id}`)).toContainText(taskTitle);

  const [completeResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes(`/api/activities/${task.id}`) && response.request().method() === "PATCH"),
    page.getByTestId(`record-task-toggle-${task.id}`).click()
  ]);
  expect(completeResponse.ok()).toBe(true);
  const completedTask = (await completeResponse.json()) as ActivityPayload;
  expect(completedTask.completedAt).toBeTruthy();
  await expect(page.getByTestId(`record-task-${task.id}`)).toHaveAttribute("data-completed", "true");

  const [reopenResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes(`/api/activities/${task.id}`) && response.request().method() === "PATCH"),
    page.getByTestId(`record-task-toggle-${task.id}`).click()
  ]);
  expect(reopenResponse.ok()).toBe(true);
  const reopenedTask = (await reopenResponse.json()) as ActivityPayload;
  expect(reopenedTask.completedAt).toBeFalsy();
  await expect(page.getByTestId(`record-task-${task.id}`)).toHaveAttribute("data-completed", "false");

  await page.getByTestId("nav-tasks").click();
  await expect(page.getByTestId(`task-view-task-${task.id}`)).toContainText(taskTitle);

  await page.getByTestId("nav-activities").click();
  await expect(page.getByTestId(`activity-view-activity-${note.id}`)).toContainText(noteTitle);
  await expect(page.getByTestId(`activity-view-activity-${task.id}`)).toContainText(taskTitle);
});

interface ActivityPayload {
  id: string;
  recordId?: string;
  type: "note" | "call" | "meeting" | "task";
  title: string;
  dueAt?: string;
  completedAt?: string | null;
}
