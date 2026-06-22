import { expect, test } from "@playwright/test";
import { loginAsAdmin, openObject, waitForRecord, type CrmRecordPayload } from "./helpers";

type EmailAccountPayload = {
  id: string;
  name: string;
  emailAddress: string;
  connectionConfigured?: boolean;
};

type EmailMessagePayload = {
  id: string;
  threadId: string;
};

type EmailThreadPayload = {
  id: string;
  subject: string;
};

type KnowledgeArticlePayload = {
  id: string;
  title: string;
};

test("admin can use email workspace reply translate and send flow", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await loginAsAdmin(page);

  const contactResponse = await page.request.post("/api/records/contacts", {
    data: {
      title: `E2E Email Contact ${suffix}`,
      data: {
        email: `email-contact-${suffix}@example.com`,
        phone: "+86 139 0000 0000"
      }
    }
  });
  expect(contactResponse.status()).toBe(201);
  const contact = (await contactResponse.json()) as CrmRecordPayload;

  const accountResponse = await page.request.post("/api/email/accounts", {
    data: {
      name: `E2E SMTP Mailbox ${suffix}`,
      emailAddress: `sales-${suffix}@example.com`,
      provider: "smtp_imap",
      status: "active",
      sendEnabled: true,
      syncEnabled: true
    }
  });
  expect(accountResponse.status()).toBe(201);
  const account = (await accountResponse.json()) as EmailAccountPayload;
  const accountReadResponse = await page.request.get(`/api/email/accounts/${account.id}`);
  expect(accountReadResponse.ok()).toBe(true);
  const readAccount = (await accountReadResponse.json()) as EmailAccountPayload;
  expect(readAccount.emailAddress).toBe(account.emailAddress);
  expect(readAccount.connectionConfigured).toBe(false);

  const inboundResponse = await page.request.post("/api/email/messages", {
    data: {
      accountId: account.id,
      direction: "inbound",
      status: "received",
      from: contact.data.email,
      to: [account.emailAddress],
      subject: "E2E deployment reply",
      bodyText: "Please confirm the private deployment plan and launch training.",
      recordId: contact.id
    }
  });
  expect(inboundResponse.status()).toBe(201);
  const inbound = (await inboundResponse.json()) as EmailMessagePayload;
  const threadResponse = await page.request.get(`/api/email/threads/${inbound.threadId}`);
  expect(threadResponse.ok()).toBe(true);
  const thread = (await threadResponse.json()) as EmailThreadPayload;
  expect(thread.id).toBe(inbound.threadId);
  expect(thread.subject).toBe("E2E deployment reply");

  const sourceMessageResponse = await page.request.get(`/api/email/messages/${inbound.id}`);
  expect(sourceMessageResponse.ok()).toBe(true);
  const sourceMessage = (await sourceMessageResponse.json()) as EmailMessagePayload & { subject: string };
  expect(sourceMessage.threadId).toBe(inbound.threadId);
  expect(sourceMessage.subject).toBe("E2E deployment reply");

  await page.goto("/");
  await page.getByTestId("nav-email").click();
  await expect(page.getByTestId("email-tab-mail")).toHaveClass(/active/);
  await expect(page.getByTestId("email-account-create")).toHaveCount(0);
  await page.getByTestId("email-tab-settings").click();
  await expect(page.getByTestId("email-sync-all")).toBeEnabled();
  await page.getByTestId(`email-account-edit-${account.id}`).click();
  await page.getByTestId("email-account-name").fill(`E2E Rotated Mailbox ${suffix}`);
  await page.getByTestId("email-account-smtp-host").fill("smtp.example.com");
  await page.getByTestId("email-account-update").click();
  const updatedAccountResponse = await page.request.get(`/api/email/accounts/${account.id}`);
  expect(updatedAccountResponse.ok()).toBe(true);
  const updatedAccount = (await updatedAccountResponse.json()) as EmailAccountPayload;
  expect(updatedAccount.name).toBe(`E2E Rotated Mailbox ${suffix}`);
  expect(updatedAccount.connectionConfigured).toBe(true);

  await expect(page.getByText("E2E deployment reply").first()).toBeVisible();
  await page.getByTestId("email-tab-mail").click();
  await page.getByTestId(`email-thread-row-${thread.id}`).click();
  await expect(page.getByText("Please confirm the private deployment plan and launch training.")).toBeVisible();

  await page.getByTestId("email-tab-ai").click();
  await page.getByTestId("knowledge-title").fill(`E2E AI Knowledge ${suffix}`);
  await page.getByTestId("knowledge-tags").fill("deployment, training");
  await page.getByTestId("knowledge-body").fill("Private deployment plans must include training schedule, owner handoff, and rollback contacts.");
  await page.getByTestId("knowledge-create").click();
  await expect(page.getByText(`E2E AI Knowledge ${suffix}`)).toBeVisible();
  const knowledgeResponse = await page.request.get("/api/knowledge/articles");
  expect(knowledgeResponse.ok()).toBe(true);
  const articles = (await knowledgeResponse.json()) as KnowledgeArticlePayload[];
  const article = articles.find((candidate) => candidate.title === `E2E AI Knowledge ${suffix}`);
  if (!article) {
    throw new Error("Expected E2E knowledge article to exist");
  }

  await page.getByTestId("email-ai-feature-draft").check();
  await expect(page.getByTestId("email-ai-feature-draft")).toBeChecked();
  await page.getByTestId("email-ai-purpose").selectOption("draft");
  await page.getByTestId("email-ai-prompt").fill("Confirm the private deployment training plan");
  await expect(page.getByTestId("email-ai-generate")).toBeEnabled();
  await page.getByTestId("email-ai-generate").click();
  await page.getByTestId("email-tab-mail").click();
  await expect(page.getByTestId("email-compose-body")).toContainText("Thank you for the recent conversation");
  await expect(page.getByTestId(`email-ai-source-record-${contact.id}`).first()).toBeVisible();
  await expect(page.getByTestId(`email-ai-source-message-${inbound.id}`).first()).toBeVisible();
  await expect(page.getByTestId(`email-ai-source-knowledge-${article.id}`).first()).toBeVisible();

  await page.getByTestId(`email-message-reply-${inbound.id}`).click();
  await expect(page.getByTestId("email-compose-account")).toHaveValue(account.id);
  await expect(page.getByTestId("email-compose-to")).toHaveValue(String(contact.data.email));
  await expect(page.getByTestId("email-compose-subject")).toHaveValue("Re: E2E deployment reply");

  await page.getByTestId("email-compose-body").fill("We will send the deployment plan today.");
  await page.getByTestId("email-send").click();
  await expect(page.getByText("We will send the deployment plan today.")).toBeVisible();

  await page.getByTestId(`email-message-translate-${inbound.id}`).click();
  await expect(page.getByTestId("email-message-translation").filter({ hasText: "Content to translate" })).toBeVisible();

  await openObject(page, "contacts");
  await page.getByTestId("record-search-contacts").fill(contact.title);
  await expect(page.getByTestId("crm-workspace")).toHaveAttribute("data-list-loading", "false");
  await page.getByTestId(`record-row-${contact.id}`).click();
  await expect(page.getByTestId(`record-email-thread-${inbound.threadId}`)).toBeVisible();
  await page.getByTestId(`record-email-compose-${contact.id}-${String(contact.data.email).replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-+|-+$/g, "")}`).click();
  await expect(page.getByTestId("email-tab-mail")).toHaveClass(/active/);
  await expect(page.getByTestId("email-compose-to")).toHaveValue(String(contact.data.email));
  await expect(page.getByTestId("email-compose-subject")).toHaveValue("");

  await openObject(page, "contacts");
  await page.getByTestId("record-search-contacts").fill(contact.title);
  await expect(page.getByTestId("crm-workspace")).toHaveAttribute("data-list-loading", "false");
  await page.getByTestId(`record-row-${contact.id}`).click();
  await page.getByTestId(`record-email-thread-${inbound.threadId}`).click();
  await expect(page.getByTestId("email-tab-mail")).toHaveClass(/active/);
  await expect(page.getByText("Please confirm the private deployment plan and launch training.")).toBeVisible();

  const messagesResponse = await page.request.get(`/api/email/threads/${inbound.threadId}/messages`);
  expect(messagesResponse.ok()).toBe(true);
  const messages = (await messagesResponse.json()) as Array<{ bodyText: string; status: string; translatedBodyText?: string }>;
  expect(messages.some((message) => message.bodyText.includes("deployment plan") && message.status === "sent")).toBe(true);
  expect(messages.some((message) => message.translatedBodyText?.includes("Content to translate"))).toBe(true);

  const freshContact = await waitForRecord(page, "contacts", contact.title);
  expect(freshContact.data.email).toBe(contact.data.email);
});
