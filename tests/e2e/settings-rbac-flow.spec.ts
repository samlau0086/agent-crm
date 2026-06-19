import { expect, test } from "@playwright/test";
import { findRecord, findUser, loginAsAdmin, openObject, type CrmRecordPayload } from "./helpers";

test("admin can manage roles teams users and password setup", async ({ page, browser }) => {
  const suffix = `${Date.now()}`;
  const roleName = `E2E Import Role ${suffix}`;
  const teamName = `E2E Team ${suffix}`;
  const userEmail = `e2e-user-${suffix}@example.com`;
  const companyTitle = `E2E Owner Company ${suffix}`;
  const contactTitle = `E2E Owner Contact ${suffix}`;

  await loginAsAdmin(page);

  const invalidUserResponse = await page.request.post("/api/users", {
    data: { email: "bad-email", name: "", roleId: "role-sales", password: "short" }
  });
  expect(invalidUserResponse.status()).toBe(400);
  const invalidUserPayload = (await invalidUserResponse.json()) as { code: string; details?: { fieldErrors?: Record<string, string[]> } };
  expect(invalidUserPayload.code).toBe("VALIDATION_ERROR");
  expect(invalidUserPayload.details?.fieldErrors?.email?.length).toBeGreaterThan(0);
  expect(invalidUserPayload.details?.fieldErrors?.password?.length).toBeGreaterThan(0);

  const invalidJsonResult = await page.evaluate(async () => {
    const response = await fetch("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{"
    });
    return { status: response.status, payload: (await response.json()) as { code: string } };
  });
  expect(invalidJsonResult.status).toBe(400);
  expect(invalidJsonResult.payload.code).toBe("INVALID_JSON");

  const invalidRoleResponse = await page.request.post("/api/roles", {
    data: { name: "Bad Role", permissions: ["crm.read", "crm.drop"] }
  });
  expect(invalidRoleResponse.status()).toBe(400);
  const invalidRolePayload = (await invalidRoleResponse.json()) as { code: string };
  expect(invalidRolePayload.code).toBe("VALIDATION_ERROR");

  await page.getByTestId("nav-settings").click();
  await page.getByTestId("settings-new-role").click();
  await page.getByTestId("settings-role-name").fill(roleName);
  await page.getByTestId("settings-role-permission-crm.import").check();
  const roleResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/roles") && response.request().method() === "POST");
  await page.getByTestId("settings-save-role").click();
  const roleResponse = await roleResponsePromise;
  expect(roleResponse.status()).toBe(201);
  const role = (await roleResponse.json()) as { id: string; name: string; permissions: string[] };
  expect(role.permissions).toEqual(expect.arrayContaining(["crm.read", "crm.import"]));

  await page.getByTestId("settings-new-team").click();
  await page.getByTestId("settings-team-name").fill(teamName);
  const teamResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/teams") && response.request().method() === "POST");
  await page.getByTestId("settings-save-team").click();
  const teamResponse = await teamResponsePromise;
  expect(teamResponse.status()).toBe(201);
  const team = (await teamResponse.json()) as { id: string; name: string };

  await page.getByTestId("settings-new-user").click();
  await expect(page.getByTestId("settings-user-role").locator(`option[value="${role.id}"]`)).toHaveCount(1);
  await expect(page.getByTestId("settings-user-team").locator(`option[value="${team.id}"]`)).toHaveCount(1);
  await page.getByTestId("settings-user-email").fill(userEmail);
  await page.getByTestId("settings-user-name").fill(`E2E User ${suffix}`);
  await page.getByTestId("settings-user-role").selectOption(role.id);
  await page.getByTestId("settings-user-team").selectOption(team.id);
  await page.getByTestId("settings-user-password").fill("E2EUser123!");
  await page.getByTestId("settings-save-user").click();
  await expect.poll(async () => (await findUser(page, userEmail))?.teamId).toBe(team.id);

  const createdUser = await findUser(page, userEmail);
  expect(createdUser?.id).toBeTruthy();
  await expect(page.getByTestId(`settings-user-row-${createdUser!.id}`)).toBeVisible();

  const companyResponse = await page.request.post("/api/records/companies", {
    data: {
      title: companyTitle,
      data: {
        domain: `owner-${suffix}.example.com`,
        industry: "software"
      }
    }
  });
  expect(companyResponse.status()).toBe(201);
  const company = (await companyResponse.json()) as CrmRecordPayload;
  const contactResponse = await page.request.post("/api/records/contacts", {
    data: {
      title: contactTitle,
      ownerId: "user-sales",
      data: {
        email: `owner-${suffix}@example.com`,
        phone: "+86 139 0000 0000",
        companyId: company.id
      }
    }
  });
  expect(contactResponse.status()).toBe(201);
  const contact = (await contactResponse.json()) as CrmRecordPayload;

  await openObject(page, "contacts");
  await page.getByTestId("view-filter-field-contacts").selectOption("");
  await expect(page.getByTestId("crm-workspace")).toHaveAttribute("data-list-loading", "false");
  await page.getByTestId("record-search-contacts").fill(contactTitle);
  await expect(page.getByTestId("crm-workspace")).toHaveAttribute("data-list-loading", "false");
  await expect(page.getByTestId(`record-row-${contact.id}`)).toBeVisible();
  await page.getByTestId(`record-row-${contact.id}`).click();
  await page.getByTestId("edit-record-owner").selectOption(createdUser!.id);
  await expect(page.getByTestId("edit-record-owner")).toHaveValue(createdUser!.id);
  await page.getByTestId("edit-record-title").fill(contactTitle);
  const updateContactResponsePromise = page.waitForResponse(
    (response) => response.url().includes(`/api/records/contacts/${contact.id}`) && response.request().method() === "PATCH"
  );
  await page.getByTestId("edit-record-save").click();
  const updateContactResponse = await updateContactResponsePromise;
  expect(updateContactResponse.ok()).toBe(true);
  const updatedContact = (await updateContactResponse.json()) as CrmRecordPayload;
  expect(updatedContact.ownerId).toBe(createdUser!.id);
  await expect.poll(async () => (await findRecord(page, "contacts", contactTitle))?.ownerId).toBe(createdUser!.id);
  await page.getByTestId("record-search-contacts").fill("");
  await page.getByTestId("view-filter-field-contacts").selectOption("ownerId");
  await page.getByTestId("view-filter-value-contacts").selectOption(createdUser!.id);
  await expect(page.getByTestId("crm-workspace")).toHaveAttribute("data-list-loading", "false");
  await expect(page.getByTestId(`record-row-${contact.id}`)).toBeVisible();

  await page.getByTestId("nav-settings").click();
  await page.getByTestId(`settings-user-row-${createdUser!.id}`).click();
  await page.getByTestId("settings-generate-password-link").click();
  const setupLink = await page.getByTestId("settings-password-setup-link").inputValue();
  expect(setupLink).toContain("/setup-password?token=");

  const setupContext = await browser.newContext();
  const setupPage = await setupContext.newPage();
  await setupPage.goto(setupLink);
  await setupPage.getByTestId("setup-password-input").fill("ChangedByLink123!");
  await setupPage.getByTestId("setup-password-confirm").fill("ChangedByLink123!");
  await setupPage.getByTestId("setup-password-submit").click();
  await expect(setupPage).toHaveURL(/\/login\?password=updated/);
  await setupPage.locator('input[name="email"]').fill(userEmail);
  await setupPage.locator('input[name="password"]').fill("ChangedByLink123!");
  await setupPage.locator('form button[type="submit"]').click();
  await expect(setupPage.getByTestId("nav-dashboard")).toBeVisible();
  await setupContext.close();

  await expect(page.getByTestId("settings-save-user")).toBeEnabled();
  await page.getByTestId(`settings-user-row-${createdUser!.id}`).click();
  await expect(page.getByTestId("settings-user-active")).toBeChecked();
  await page.getByTestId("settings-user-active").uncheck();
  await expect(page.getByTestId("settings-user-active")).not.toBeChecked();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain(userEmail);
    await dialog.accept();
  });
  const deactivateUserResponsePromise = page.waitForResponse(
    (response) => response.url().includes(`/api/users/${createdUser!.id}`) && response.request().method() === "PATCH"
  );
  await page.getByTestId("settings-save-user").click();
  const deactivateUserResponse = await deactivateUserResponsePromise;
  expect(deactivateUserResponse.ok()).toBe(true);
  const deactivatedUser = (await deactivateUserResponse.json()) as { active: boolean };
  expect(deactivatedUser.active).toBe(false);
  await expect.poll(async () => (await findUser(page, userEmail))?.active).toBe(false);

  const loginResponse = await page.request.post("/api/auth/login", {
    form: { email: userEmail, password: "ChangedByLink123!" },
    maxRedirects: 0
  });
  expect(loginResponse.status()).toBe(303);
  expect(loginResponse.headers()["location"]).toContain("/login?error=invalid");
});
