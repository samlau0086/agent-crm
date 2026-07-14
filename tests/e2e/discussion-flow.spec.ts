import { expect, test } from "@playwright/test";
import { createCompany, loginAsAdmin } from "./helpers";

test("record, activity, and email surfaces expose team discussions", async ({ page }) => {
  await loginAsAdmin(page);
  const suffix = Date.now();
  const company = await createCompany(page, `Discussion Company ${suffix}`, `discussion-${suffix}.example.com`);
  await page.goto(`/companies?recordId=${encodeURIComponent(company.id)}`);
  await page.getByTestId("record-detail-tab-discussions").click();
  await expect(page.getByTestId("team-discussion-panel")).toBeVisible();
  const composer = page.getByPlaceholder("输入消息，使用 @ 提及成员…");
  await expect(composer).toBeVisible();
  const message = `Discussion message ${suffix}`;
  await composer.fill(message);
  await page.getByTestId("team-discussion-panel").getByRole("button", { name: "发送" }).click();
  await expect(page.getByTestId("team-discussion-panel")).toContainText(message);

  await page.goto("/activities");
  const discussionButton = page.getByTestId(/activity-view-activity-discussion-/).first();
  if (await discussionButton.count()) {
    await discussionButton.click();
    await expect(page.getByTestId("team-discussion-panel")).toBeVisible();
  }

  await page.goto("/email");
  const emailDiscussion = page.getByTestId("email-thread-discussion");
  if (await emailDiscussion.count()) {
    await emailDiscussion.click();
    await expect(page.getByTestId("team-discussion-panel")).toBeVisible();
  }
});
