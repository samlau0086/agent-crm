import { canAccessRecordOwner, canManageAllRecords, requirePermission } from "@/lib/auth/rbac";
import { createApiKeyToken, getApiKeyTokenPrefix, hashApiKeyToken } from "@/lib/auth/api-key";
import { permissionCatalog } from "@/lib/auth/permissions";
import { assertValidWebhookEvents, assertValidWebhookUrl, createWebhookSecret, getWebhookSecretPrefix } from "@/lib/integrations/webhook";
import { ApiError } from "@/lib/api-error";
import { buildCsv } from "@/lib/crm/csv";
import { buildCsvImportIssuesCsv } from "@/lib/crm/import-issues";
import { AUDIT_DEFAULT_PAGE_SIZE, AUDIT_EXPORT_MAX_PAGE_SIZE, normalizePage, normalizePageSize, RECORD_DEFAULT_PAGE_SIZE, RECORD_MAX_PAGE_SIZE } from "@/lib/crm/pagination";
import { adminUserId, defaultWorkspaceId, seedData } from "@/lib/crm/seed";
import { buildEmailAssistantContext, canRunEmailClassification, createDefaultEmailAiSettings, normalizeAiAgentSettings, normalizeEmailAiFeatures } from "@/lib/email/assistant";
import { analyzeEmailThreadWithAi } from "@/lib/email/analysis";
import { scheduleEmailAutomationsBestEffort } from "@/lib/email/automations";
import { getEmailProviderCapability } from "@/lib/email/providers";
import { appendEmailTrackingHtml, buildTrackingEvent, createEmailTrackingId } from "@/lib/email/tracking";
import { mergeAiProviderConfigSecrets, normalizeAiProviderConfig, publicAiProviderConfig } from "@/lib/ai/provider-config";
import { summarizeEmailThreadWithAi } from "@/lib/email/summarization";
import { translateEmailMessage } from "@/lib/email/translation";
import type {
  Activity,
  ApiKey,
  AuditAction,
  AuditLog,
  AuditLogQuery,
  CreatedApiKey,
  CreatedWebhookEndpoint,
  CsvImportConflict,
  CsvImportMapping,
  CsvImportResult,
  CsvImportStrategy,
  CsvImportPreview,
  CsvImportJob,
  CsvImportJobSourcePayload,
  CrmRecord,
  CrmSnapshot,
  DashboardSummary,
  EmailAccount,
  EmailAttachment,
  EmailAiGenerationAuditInput,
  EmailAiSettings,
  EmailSyncSettings,
  AiProviderConfig,
  EmailConnectionConfig,
  EmailMessage,
  EmailSignature,
  EmailThread,
  EmailThreadState,
  FieldDefinition,
  ImportPreset,
  ImportJobQueueSummary,
  KnowledgeArticle,
  MediaAsset,
  ObjectDefinition,
  Permission,
  Pipeline,
  RecordListQuery,
  RecordListResult,
  RelationDefinition,
  RequestContext,
  Role,
  SavedView,
  Team,
  TalkMessage,
  User,
  WebhookDelivery,
  WebhookEndpoint,
  WebhookEvent,
  WebhookDeliveryStatus
} from "@/lib/crm/types";
import { assertValidFieldDefinition, validateRecordPayload } from "@/lib/crm/validation";
import { compareRecords, matchesRecordSearch, matchesSavedView } from "@/lib/crm/views";
import { normalizeQuoteRecordData, validateQuoteRecordData } from "@/lib/crm/quotes";

type GlobalStore = typeof globalThis & { __crmStore?: CrmStore };
type StoredCsvImportJob = CsvImportJob & { sourcePayload?: CsvImportJobSourcePayload };
type StoredApiKey = ApiKey & { tokenHash: string };
type StoredWebhookEndpoint = WebhookEndpoint & { secret: string };
type EmailAssistantInput = Parameters<typeof buildEmailAssistantContext>[0];

function clone<T>(value: T): T {
  return structuredClone(value);
}

function stamp(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeRoleInput(input: Pick<Role, "name" | "permissions">): Pick<Role, "name" | "permissions"> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Role name is required");
  }

  const allowedPermissions = new Set(permissionCatalog.map((permission) => permission.key));
  const permissions = Array.from(new Set(input.permissions)).filter((permission) => allowedPermissions.has(permission));
  if (permissions.length === 0) {
    throw new Error("Role must include at least one permission");
  }

  if (permissions.length !== new Set(input.permissions).size) {
    throw new Error("Role contains unsupported permissions");
  }

  return { name, permissions };
}

function normalizeApiKeyInput(input: { name: string; permissions: Permission[]; expiresAt?: string }): { name: string; permissions: Permission[]; expiresAt?: string } {
  const name = input.name.trim();
  if (!name) {
    throw new Error("API key name is required");
  }

  const allowedPermissions = new Set<Permission>(["crm.read", "crm.write", "crm.import", "ai.use"]);
  const requestedPermissions = Array.from(new Set(input.permissions));
  const permissions = requestedPermissions.filter((permission) => allowedPermissions.has(permission));
  if (permissions.length !== requestedPermissions.length) {
    throw new Error("API key contains unsupported permissions");
  }
  if (permissions.length === 0) {
    throw new Error("API key must include at least one non-admin permission");
  }

  const expiresAt = input.expiresAt?.trim();
  if (expiresAt && Number.isNaN(new Date(expiresAt).getTime())) {
    throw new Error("API key expiration is invalid");
  }

  return { name, permissions, expiresAt: expiresAt || undefined };
}

function normalizeWebhookInput(input: { name: string; url: string; events: string[]; active?: boolean }): { name: string; url: string; events: WebhookEndpoint["events"]; active: boolean } {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Webhook name is required");
  }

  const url = assertValidWebhookUrl(input.url);

  return {
    name,
    url,
    events: assertValidWebhookEvents(input.events),
    active: input.active ?? true
  };
}

function normalizeTeamName(input: string): string {
  const name = input.trim();
  if (!name) {
    throw new Error("Team name is required");
  }
  return name;
}

type TalkMessageTargetInput = { type: "record"; objectKey: string; recordId: string } | { type: "email_thread"; threadId: string };

export class CrmStore {
  private data: CrmSnapshot;

  constructor(initialData: CrmSnapshot = seedData) {
    this.data = clone(initialData);
  }

  reset(initialData: CrmSnapshot = seedData): void {
    this.data = clone(initialData);
  }

  snapshot(): CrmSnapshot {
    return clone(this.data);
  }

  getContext(userId = adminUserId): RequestContext {
    const user = this.data.users.find((candidate) => candidate.id === userId);
    if (!user) {
      throw new Error("当前用户不存在");
    }
    if (!user.active) {
      throw new Error("Current user is disabled");
    }

    const role = this.data.roles.find((candidate) => candidate.id === user.roleId && candidate.workspaceId === user.workspaceId);
    if (!role) {
      throw new Error("当前用户没有角色");
    }

    return { workspaceId: user.workspaceId, user, role };
  }

  getUsers(context: RequestContext): User[] {
    requirePermission(context, "crm.read");
    return clone(this.data.users.filter((user) => user.workspaceId === context.workspaceId));
  }

  createUser(
    context: RequestContext,
    input: Pick<User, "email" | "name" | "roleId"> & Pick<Partial<User>, "teamId" | "active"> & { password: string }
  ): User {
    requirePermission(context, "crm.admin");
    const data = this.normalizeUserInput(context, input);
    if (input.password.trim().length < 8) {
      throw new Error("Password must be at least 8 characters");
    }
    if (this.data.users.some((user) => user.workspaceId === context.workspaceId && user.email.toLowerCase() === data.email)) {
      throw new Error("User email already exists");
    }

    const active = input.active ?? true;
    const user: User = {
      id: createId("user"),
      workspaceId: context.workspaceId,
      email: data.email,
      name: data.name,
      roleId: data.roleId,
      teamId: data.teamId,
      active,
      disabledAt: active ? undefined : stamp()
    };
    this.data.users.push(user);
    this.writeAuditLog(context, "create", "user", user.id, {
      summary: `Created user ${user.email}`,
      details: { email: user.email, name: user.name, roleId: user.roleId, teamId: user.teamId, active: user.active }
    });
    return clone(user);
  }

  updateUser(
    context: RequestContext,
    id: string,
    patch: Partial<Pick<User, "email" | "name" | "roleId" | "teamId" | "active">> & { password?: string }
  ): User {
    requirePermission(context, "crm.admin");
    const user = this.data.users.find((candidate) => candidate.id === id && candidate.workspaceId === context.workspaceId);
    if (!user) {
      throw new Error("User not found");
    }

    const data = this.normalizeUserInput(context, {
      email: patch.email ?? user.email,
      name: patch.name ?? user.name,
      roleId: patch.roleId ?? user.roleId,
      teamId: Object.prototype.hasOwnProperty.call(patch, "teamId") ? patch.teamId : user.teamId
    });
    if (data.email !== user.email.toLowerCase()) {
      const duplicate = this.data.users.some(
        (candidate) => candidate.workspaceId === context.workspaceId && candidate.id !== id && candidate.email.toLowerCase() === data.email
      );
      if (duplicate) {
        throw new Error("User email already exists");
      }
    }

    const currentRole = this.data.roles.find((role) => role.id === user.roleId && role.workspaceId === context.workspaceId);
    if (currentRole?.permissions.includes("crm.admin") && data.roleId !== user.roleId) {
      const targetRole = this.data.roles.find((role) => role.id === data.roleId && role.workspaceId === context.workspaceId);
      if (!targetRole?.permissions.includes("crm.admin")) {
        this.assertWorkspaceKeepsAdminUserAfterUserRoleChange(context, id);
      }
    }
    if (user.active && patch.active === false && currentRole?.permissions.includes("crm.admin")) {
      this.assertWorkspaceKeepsAdminUserAfterUserRoleChange(context, id);
    }
    if (patch.password !== undefined && patch.password.trim().length > 0 && patch.password.trim().length < 8) {
      throw new Error("Password must be at least 8 characters");
    }

    const active = patch.active ?? user.active;
    Object.assign(user, data, {
      active,
      disabledAt: active ? undefined : user.disabledAt ?? stamp()
    });
    this.writeAuditLog(context, "update", "user", user.id, {
      summary: `Updated user ${user.email}`,
      details: {
        email: user.email,
        name: user.name,
        roleId: user.roleId,
        teamId: user.teamId,
        active: user.active,
        passwordChanged: Boolean(patch.password?.trim())
      }
    });
    return clone(user);
  }

  listApiKeys(context: RequestContext): ApiKey[] {
    requirePermission(context, "crm.admin");
    return clone(
      ((this.data.apiKeys ?? []) as StoredApiKey[])
        .filter((key) => key.workspaceId === context.workspaceId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map(({ tokenHash: _tokenHash, ...apiKey }) => apiKey)
    );
  }

  createApiKey(context: RequestContext, input: { name: string; permissions: Permission[]; expiresAt?: string }): CreatedApiKey {
    requirePermission(context, "crm.admin");
    const data = normalizeApiKeyInput(input);
    const token = createApiKeyToken();
    const now = stamp();
    const apiKey: StoredApiKey = {
      id: createId("api_key"),
      workspaceId: context.workspaceId,
      name: data.name,
      tokenHash: hashApiKeyToken(token),
      tokenPrefix: getApiKeyTokenPrefix(token),
      permissions: data.permissions,
      createdById: context.user.id,
      expiresAt: data.expiresAt,
      createdAt: now,
      updatedAt: now
    };
    ((this.data.apiKeys ??= []) as StoredApiKey[]).push(apiKey);
    this.writeAuditLog(context, "create", "api_key", apiKey.id, {
      summary: `Created API key ${apiKey.name}`,
      details: { permissions: apiKey.permissions, expiresAt: apiKey.expiresAt }
    });
    const { tokenHash: _tokenHash, ...publicKey } = apiKey;
    return clone({ apiKey: publicKey, token });
  }

  revokeApiKey(context: RequestContext, id: string): ApiKey {
    requirePermission(context, "crm.admin");
    const apiKey = ((this.data.apiKeys ?? []) as StoredApiKey[]).find((candidate) => candidate.id === id && candidate.workspaceId === context.workspaceId);
    if (!apiKey) {
      throw new Error("API key not found");
    }
    apiKey.revokedAt ??= stamp();
    apiKey.updatedAt = stamp();
    this.writeAuditLog(context, "update", "api_key", id, {
      summary: `Revoked API key ${apiKey.name}`,
      details: { tokenPrefix: apiKey.tokenPrefix }
    });
    const { tokenHash: _tokenHash, ...publicKey } = apiKey;
    return clone(publicKey);
  }

  listWebhooks(context: RequestContext): WebhookEndpoint[] {
    requirePermission(context, "crm.admin");
    return clone(
      ((this.data.webhooks ?? []) as StoredWebhookEndpoint[])
        .filter((webhook) => webhook.workspaceId === context.workspaceId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map(({ secret: _secret, ...webhook }) => webhook)
    );
  }

  createWebhook(context: RequestContext, input: { name: string; url: string; events: string[]; active?: boolean }): CreatedWebhookEndpoint {
    requirePermission(context, "crm.admin");
    const data = normalizeWebhookInput(input);
    const secret = createWebhookSecret();
    const now = stamp();
    const webhook: StoredWebhookEndpoint = {
      id: createId("webhook"),
      workspaceId: context.workspaceId,
      name: data.name,
      url: data.url,
      events: data.events,
      secret,
      secretPrefix: getWebhookSecretPrefix(secret),
      active: data.active,
      createdById: context.user.id,
      createdAt: now,
      updatedAt: now
    };
    ((this.data.webhooks ??= []) as StoredWebhookEndpoint[]).push(webhook);
    this.writeAuditLog(context, "create", "webhook", webhook.id, {
      summary: `Created webhook ${webhook.name}`,
      details: { url: webhook.url, events: webhook.events, active: webhook.active }
    });
    const { secret: _secret, ...publicWebhook } = webhook;
    return clone({ webhook: publicWebhook, secret });
  }

  updateWebhook(context: RequestContext, id: string, patch: Partial<{ name: string; url: string; events: string[]; active: boolean }>): WebhookEndpoint {
    requirePermission(context, "crm.admin");
    const webhook = ((this.data.webhooks ?? []) as StoredWebhookEndpoint[]).find((candidate) => candidate.id === id && candidate.workspaceId === context.workspaceId);
    if (!webhook) {
      throw new Error("Webhook not found");
    }
    const data = normalizeWebhookInput({
      name: patch.name ?? webhook.name,
      url: patch.url ?? webhook.url,
      events: patch.events ?? webhook.events,
      active: patch.active ?? webhook.active
    });
    Object.assign(webhook, { ...data, updatedAt: stamp() });
    this.writeAuditLog(context, "update", "webhook", id, {
      summary: `Updated webhook ${webhook.name}`,
      details: { url: webhook.url, events: webhook.events, active: webhook.active }
    });
    const { secret: _secret, ...publicWebhook } = webhook;
    return clone(publicWebhook);
  }

  listWebhookDeliveries(
    context: RequestContext,
    webhookId?: string,
    query: { status?: WebhookDeliveryStatus; event?: WebhookEvent; limit?: number } = {}
  ): WebhookDelivery[] {
    requirePermission(context, "crm.admin");
    return clone(
      (this.data.webhookDeliveries ?? [])
        .filter((delivery) => delivery.workspaceId === context.workspaceId && (!webhookId || delivery.webhookId === webhookId))
        .filter((delivery) => (query.status ? delivery.status === query.status : true))
        .filter((delivery) => (query.event ? delivery.event === query.event : true))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, query.limit ?? 50)
    );
  }

  testWebhook(context: RequestContext, id: string): WebhookDelivery {
    requirePermission(context, "crm.admin");
    const webhook = ((this.data.webhooks ?? []) as StoredWebhookEndpoint[]).find((candidate) => candidate.id === id && candidate.workspaceId === context.workspaceId);
    if (!webhook) {
      throw new Error("Webhook not found");
    }
    if (!webhook.active) {
      throw new Error("Webhook is inactive");
    }
    return this.recordStoreWebhookDelivery(context, webhook, "webhook.test", {
      workspaceId: context.workspaceId,
      webhookId: webhook.id,
      sentById: context.user.id,
      test: true
    });
  }

  retryWebhookDelivery(context: RequestContext, webhookId: string, deliveryId: string): WebhookDelivery {
    requirePermission(context, "crm.admin");
    const webhook = ((this.data.webhooks ?? []) as StoredWebhookEndpoint[]).find((candidate) => candidate.id === webhookId && candidate.workspaceId === context.workspaceId);
    if (!webhook) {
      throw new Error("Webhook not found");
    }
    if (!webhook.active) {
      throw new Error("Webhook is inactive");
    }

    const delivery = (this.data.webhookDeliveries ?? []).find(
      (candidate) => candidate.id === deliveryId && candidate.webhookId === webhookId && candidate.workspaceId === context.workspaceId
    );
    if (!delivery) {
      throw new Error("Webhook delivery not found");
    }

    return this.recordStoreWebhookDelivery(context, webhook, delivery.event, (delivery.requestBody.data ?? {}) as Record<string, unknown>, delivery.attempts + 1);
  }

  listEmailAccounts(context: RequestContext): EmailAccount[] {
    requirePermission(context, "crm.read");
    return clone(
      (this.data.emailAccounts ?? [])
        .filter((account) => account.workspaceId === context.workspaceId)
        .sort((left, right) => left.emailAddress.localeCompare(right.emailAddress))
    );
  }

  getEmailAccount(context: RequestContext, accountId: string): EmailAccount {
    requirePermission(context, "crm.read");
    return clone(this.assertEmailAccount(context, accountId));
  }

  createEmailAccount(
    context: RequestContext,
    input: Pick<EmailAccount, "name" | "emailAddress" | "provider"> &
      Partial<Pick<EmailAccount, "syncEnabled" | "sendEnabled" | "status">> & { connectionConfig?: EmailConnectionConfig }
  ): EmailAccount {
    requirePermission(context, "crm.admin");
    const now = stamp();
    const toggles = normalizeEmailAccountToggles(input.provider, {
      syncEnabled: input.syncEnabled ?? false,
      sendEnabled: input.sendEnabled ?? false
    });
    const emailAddress = normalizeEmailAddress(input.emailAddress);
    this.assertEmailAccountEmailAvailable(context, emailAddress);
    const account: EmailAccount = {
      id: createId("email_account"),
      workspaceId: context.workspaceId,
      name: normalizeRequiredText(input.name, "Email account name"),
      emailAddress,
      provider: input.provider,
      status: input.status ?? "draft",
      syncEnabled: toggles.syncEnabled,
      sendEnabled: toggles.sendEnabled,
      connectionConfigured: Boolean(input.connectionConfig),
      createdById: context.user.id,
      createdAt: now,
      updatedAt: now
    };
    (this.data.emailAccounts ??= []).push(account);
    this.writeAuditLog(context, "create", "email_account", account.id, {
      summary: `Created email account ${account.emailAddress}`,
      details: { provider: account.provider, syncEnabled: account.syncEnabled, sendEnabled: account.sendEnabled }
    });
    return clone(account);
  }

  updateEmailAccount(
    context: RequestContext,
    accountId: string,
    input: Partial<Pick<EmailAccount, "name" | "emailAddress" | "provider" | "syncEnabled" | "sendEnabled" | "status">> & {
      connectionConfig?: EmailConnectionConfig;
      clearConnectionConfig?: boolean;
    }
  ): EmailAccount {
    requirePermission(context, "crm.admin");
    const account = this.assertEmailAccount(context, accountId);
    const nextProvider = input.provider ?? account.provider;
    const toggles = normalizeEmailAccountToggles(nextProvider, {
      syncEnabled: input.syncEnabled ?? account.syncEnabled,
      sendEnabled: input.sendEnabled ?? account.sendEnabled
    });
    const emailAddress = input.emailAddress !== undefined ? normalizeEmailAddress(input.emailAddress) : account.emailAddress;
    this.assertEmailAccountEmailAvailable(context, emailAddress, account.id);
    if (input.name !== undefined) account.name = normalizeRequiredText(input.name, "Email account name");
    account.emailAddress = emailAddress;
    if (input.provider !== undefined) account.provider = input.provider;
    if (input.status !== undefined) account.status = input.status;
    account.syncEnabled = toggles.syncEnabled;
    account.sendEnabled = toggles.sendEnabled;
    if (input.connectionConfig) {
      account.connectionConfigured = true;
      delete account.lastConnectionError;
      if (input.status === undefined && account.status === "draft") {
        account.status = "active";
      }
    }
    if (input.clearConnectionConfig) {
      account.connectionConfigured = false;
      delete account.lastConnectionError;
      if (input.status === undefined) {
        account.status = "draft";
      }
    }
    account.updatedAt = stamp();
    this.writeAuditLog(context, "update", "email_account", account.id, {
      summary: `Updated email account ${account.emailAddress}`,
      details: {
        provider: account.provider,
        status: account.status,
        syncEnabled: account.syncEnabled,
        sendEnabled: account.sendEnabled,
        connectionConfigured: account.connectionConfigured
      }
    });
    return clone(account);
  }

  getEmailAccountConnectionConfig(context: RequestContext, accountId: string): EmailConnectionConfig | undefined {
    requirePermission(context, "crm.write");
    this.assertEmailAccount(context, accountId);
    return undefined;
  }

  updateEmailAccountConnectionConfig(context: RequestContext, accountId: string, _config: EmailConnectionConfig): EmailAccount {
    requirePermission(context, "crm.write");
    const account = this.assertEmailAccount(context, accountId);
    account.connectionConfigured = true;
    delete account.lastConnectionError;
    account.status = "active";
    account.updatedAt = stamp();
    return clone(account);
  }

  deleteEmailAccount(context: RequestContext, accountId: string): void {
    requirePermission(context, "crm.admin");
    const account = this.assertEmailAccount(context, accountId);
    const messageCount = (this.data.emailMessages ?? []).filter((message) => message.workspaceId === context.workspaceId && message.accountId === account.id).length;
    if (messageCount > 0) {
      account.status = "disabled";
      account.syncEnabled = false;
      account.sendEnabled = false;
      account.updatedAt = stamp();
      this.writeAuditLog(context, "update", "email_account", account.id, {
        summary: `Disabled email account ${account.emailAddress}`,
        details: { reason: "account has email history", messageCount }
      });
      return;
    }
    this.data.emailAccounts = (this.data.emailAccounts ?? []).filter((candidate) => candidate.id !== account.id);
    this.writeAuditLog(context, "delete", "email_account", account.id, {
      summary: `Deleted email account ${account.emailAddress}`,
      details: { provider: account.provider }
    });
  }

  listEmailSignatures(context: RequestContext): EmailSignature[] {
    requirePermission(context, "crm.read");
    this.ensureDefaultEmailSignatures(context);
    return clone(
      (this.data.emailSignatures ?? [])
        .filter((signature) => signature.workspaceId === context.workspaceId)
        .sort((left, right) =>
          Number(right.active) - Number(left.active) ||
          Number(right.isDefault) - Number(left.isDefault) ||
          left.name.localeCompare(right.name) ||
          left.createdAt.localeCompare(right.createdAt)
        )
    );
  }

  createEmailSignature(
    context: RequestContext,
    input: Pick<EmailSignature, "name" | "bodyText"> & Partial<Pick<EmailSignature, "bodyHtml" | "isDefault" | "active">> & { accountId?: string | null }
  ): EmailSignature {
    requirePermission(context, "crm.admin");
    const now = stamp();
    const accountId = this.normalizeEmailSignatureAccountId(context, input.accountId);
    if (input.isDefault) {
      this.clearDefaultEmailSignatures(context.workspaceId, accountId);
    }
    const signature: EmailSignature = {
      id: createId("email_signature"),
      workspaceId: context.workspaceId,
      accountId: accountId ?? undefined,
      name: normalizeRequiredText(input.name, "Email signature name"),
      bodyText: normalizeRequiredText(input.bodyText, "Email signature body"),
      bodyHtml: input.bodyHtml?.trim() || undefined,
      isDefault: input.isDefault ?? false,
      active: input.active ?? true,
      createdById: context.user.id,
      createdAt: now,
      updatedAt: now
    };
    (this.data.emailSignatures ??= []).push(signature);
    this.writeAuditLog(context, "create", "email_signature", signature.id, {
      summary: `Created email signature ${signature.name}`,
      details: { accountId: signature.accountId, isDefault: signature.isDefault, active: signature.active }
    });
    return clone(signature);
  }

  updateEmailSignature(
    context: RequestContext,
    signatureId: string,
    patch: Partial<Pick<EmailSignature, "name" | "bodyText" | "bodyHtml" | "isDefault" | "active">> & { accountId?: string | null }
  ): EmailSignature {
    requirePermission(context, "crm.admin");
    const signature = this.assertEmailSignature(context, signatureId);
    const accountId = patch.accountId !== undefined ? this.normalizeEmailSignatureAccountId(context, patch.accountId) : signature.accountId ?? null;
    if (patch.isDefault === true || (patch.isDefault === undefined && signature.isDefault && accountId !== (signature.accountId ?? null))) {
      this.clearDefaultEmailSignatures(context.workspaceId, accountId, signature.id);
    }
    signature.accountId = accountId ?? undefined;
    if (patch.name !== undefined) signature.name = normalizeRequiredText(patch.name, "Email signature name");
    if (patch.bodyText !== undefined) signature.bodyText = normalizeRequiredText(patch.bodyText, "Email signature body");
    if (patch.bodyHtml !== undefined) signature.bodyHtml = patch.bodyHtml.trim() || undefined;
    if (patch.isDefault !== undefined) signature.isDefault = patch.isDefault;
    if (patch.active !== undefined) signature.active = patch.active;
    signature.updatedAt = stamp();
    this.writeAuditLog(context, "update", "email_signature", signature.id, {
      summary: `Updated email signature ${signature.name}`,
      details: { accountId: signature.accountId, isDefault: signature.isDefault, active: signature.active }
    });
    return clone(signature);
  }

  deleteEmailSignature(context: RequestContext, signatureId: string): void {
    requirePermission(context, "crm.admin");
    const signature = this.assertEmailSignature(context, signatureId);
    this.data.emailSignatures = (this.data.emailSignatures ?? []).filter((candidate) => candidate.id !== signature.id);
    this.writeAuditLog(context, "delete", "email_signature", signature.id, {
      summary: `Deleted email signature ${signature.name}`,
      details: { accountId: signature.accountId, isDefault: signature.isDefault }
    });
  }

  markEmailAccountConnectionError(context: RequestContext, accountId: string, errorMessage: string | null): EmailAccount {
    requirePermission(context, "crm.write");
    const account = this.assertEmailAccount(context, accountId);
    const previousStatus = account.status;
    const previousError = account.lastConnectionError ?? null;
    const normalizedError = errorMessage?.trim() || null;
    const nextStatus: EmailAccount["status"] = normalizedError ? "error" : "active";

    account.status = nextStatus;
    if (normalizedError) {
      account.lastConnectionError = normalizedError;
    } else {
      delete account.lastConnectionError;
    }
    account.updatedAt = stamp();

    if (previousStatus !== nextStatus || previousError !== normalizedError) {
      this.writeAuditLog(context, "update", "email_account", account.id, {
        summary: normalizedError
          ? `Email account connection failed ${account.emailAddress}`
          : `Email account connection restored ${account.emailAddress}`,
        details: {
          previousStatus,
          status: nextStatus,
          previousError,
          error: normalizedError,
          provider: account.provider
        }
      });
    }
    return clone(account);
  }

  listEmailThreads(context: RequestContext, recordId?: string): EmailThread[] {
    requirePermission(context, "crm.read");
    if (recordId) {
      this.assertVisibleRecordById(context, recordId);
    }
    return clone(
      (this.data.emailThreads ?? [])
        .filter((thread) => thread.workspaceId === context.workspaceId && (!recordId || thread.recordId === recordId) && this.canAccessEmailThread(context, thread))
        .map((thread) => this.mergeEmailThreadState(context, thread))
        .sort((left, right) => (right.lastMessageAt ?? right.updatedAt).localeCompare(left.lastMessageAt ?? left.updatedAt))
    );
  }

  getEmailThread(context: RequestContext, threadId: string): EmailThread {
    requirePermission(context, "crm.read");
    return clone(this.mergeEmailThreadState(context, this.assertEmailThread(context, threadId)));
  }

  updateEmailThread(context: RequestContext, threadId: string, input: { recordId?: string | null }): EmailThread {
    requirePermission(context, "crm.write");
    const thread = this.assertEmailThread(context, threadId);
    const previousRecordId = thread.recordId;
    if (Object.prototype.hasOwnProperty.call(input, "recordId")) {
      thread.recordId = input.recordId ? this.assertVisibleRecordById(context, input.recordId).id : undefined;
    }
    thread.updatedAt = stamp();
    this.writeAuditLog(context, "update", "email_thread", thread.id, {
      summary: `Updated email thread link ${thread.subject}`,
      details: { threadId: thread.id, previousRecordId, recordId: thread.recordId }
    });
    return clone(this.mergeEmailThreadState(context, thread));
  }

  deleteEmailThread(context: RequestContext, threadId: string): void {
    requirePermission(context, "crm.write");
    const thread = this.assertEmailThread(context, threadId);
    this.data.emailMessages = (this.data.emailMessages ?? []).filter((message) => message.threadId !== thread.id);
    this.data.emailThreadStates = (this.data.emailThreadStates ?? []).filter((state) => state.threadId !== thread.id);
    this.data.emailThreads = (this.data.emailThreads ?? []).filter((candidate) => candidate.id !== thread.id);
    this.writeAuditLog(context, "delete", "email_thread", thread.id, {
      summary: `Deleted email thread ${thread.subject}`,
      details: { threadId: thread.id, subject: thread.subject }
    });
  }

  updateEmailThreadState(
    context: RequestContext,
    threadId: string,
    input: Partial<Pick<EmailThreadState, "archived" | "deleted" | "important" | "labels" | "read" | "starred">> & {
      category?: EmailThreadState["category"] | "" | null;
      snoozedUntil?: string | null;
    }
  ): EmailThread {
    requirePermission(context, "crm.read");
    const thread = this.assertEmailThread(context, threadId);
    const states = (this.data.emailThreadStates ??= []);
    let state = states.find((candidate) => candidate.workspaceId === context.workspaceId && candidate.threadId === thread.id && candidate.userId === context.user.id);
    const now = stamp();
    if (!state) {
      state = {
        id: createId("email_thread_state"),
        workspaceId: context.workspaceId,
        threadId: thread.id,
        userId: context.user.id,
        archived: false,
        deleted: false,
        important: false,
        labels: [],
        read: false,
        starred: false,
        createdAt: now,
        updatedAt: now
      };
      states.push(state);
    }
    if (typeof input.archived === "boolean") state.archived = input.archived;
    if (Object.prototype.hasOwnProperty.call(input, "category")) state.category = input.category ? normalizeEmailThreadCategory(input.category) : undefined;
    if (typeof input.deleted === "boolean") state.deleted = input.deleted;
    if (typeof input.important === "boolean") state.important = input.important;
    if (Array.isArray(input.labels)) state.labels = normalizeEmailThreadLabels(input.labels);
    if (typeof input.read === "boolean") state.read = input.read;
    if (Object.prototype.hasOwnProperty.call(input, "snoozedUntil")) state.snoozedUntil = input.snoozedUntil || undefined;
    if (typeof input.starred === "boolean") state.starred = input.starred;
    state.updatedAt = now;
    return clone(this.mergeEmailThreadState(context, thread));
  }

  listEmailMessages(context: RequestContext, threadId: string): EmailMessage[] {
    requirePermission(context, "crm.read");
    this.assertEmailThread(context, threadId);
    return clone(
      (this.data.emailMessages ?? [])
        .filter((message) => message.workspaceId === context.workspaceId && message.threadId === threadId)
        .sort((left, right) => emailMessageTime(left).localeCompare(emailMessageTime(right)))
    );
  }

  getEmailMessage(context: RequestContext, messageId: string): EmailMessage {
    requirePermission(context, "crm.read");
    const message = (this.data.emailMessages ?? []).find((candidate) => candidate.id === messageId && candidate.workspaceId === context.workspaceId);
    if (!message) {
      throw new Error("Email message not found");
    }
    this.assertEmailThread(context, message.threadId);
    return clone(message);
  }

  findEmailMessageByExternalId(context: RequestContext, accountId: string, externalMessageId: string): EmailMessage | undefined {
    requirePermission(context, "crm.read");
    this.assertEmailAccount(context, accountId);
    const normalizedExternalMessageId = externalMessageId.trim();
    if (!normalizedExternalMessageId) {
      return undefined;
    }
    const message = (this.data.emailMessages ?? []).find(
      (candidate) =>
        candidate.workspaceId === context.workspaceId &&
        candidate.accountId === accountId &&
        candidate.externalMessageId === normalizedExternalMessageId
    );
    return message ? clone(message) : undefined;
  }

  updateEmailThreadSummary(context: RequestContext, threadId: string, summary: string): EmailThread {
    requirePermission(context, "crm.write");
    const thread = this.assertEmailThread(context, threadId);
    thread.summary = normalizeRequiredText(summary, "Email thread summary");
    thread.summaryUpdatedAt = stamp();
    thread.updatedAt = stamp();
    this.writeAuditLog(context, "update", "email_thread", thread.id, {
      summary: `Updated email thread summary ${thread.subject}`,
      details: { threadId: thread.id, summaryLength: thread.summary.length }
    });
    return clone(thread);
  }

  updateEmailThreadAnalysis(context: RequestContext, threadId: string, analysis: string, sources: EmailThread["aiAnalysisSources"] = []): EmailThread {
    requirePermission(context, "crm.write");
    const thread = this.assertEmailThread(context, threadId);
    const aiAnalysisSources = this.assertVisibleEmailAiSources(context, sources);
    thread.aiAnalysis = normalizeRequiredText(analysis, "Email thread analysis");
    thread.aiAnalysisSources = aiAnalysisSources;
    thread.aiAnalysisUpdatedAt = stamp();
    thread.updatedAt = stamp();
    this.writeAuditLog(context, "update", "email_thread", thread.id, {
      summary: `Updated email thread analysis ${thread.subject}`,
      details: { threadId: thread.id, analysisLength: thread.aiAnalysis.length, sourceCount: aiAnalysisSources.length }
    });
    return clone(thread);
  }

  listDueQueuedEmailMessagesForWorker(limit = 25): EmailMessage[] {
    const now = Date.now();
    return clone(
      (this.data.emailMessages ?? [])
        .filter((message) => message.direction === "outbound" && message.status === "queued")
        .filter((message) => !message.scheduledSendAt || new Date(message.scheduledSendAt).getTime() <= now)
        .sort((left, right) => (left.scheduledSendAt ?? left.createdAt).localeCompare(right.scheduledSendAt ?? right.createdAt))
        .slice(0, Math.max(1, Math.min(100, Math.floor(limit))))
    );
  }

  recordEmailTrackingEvent(
    trackingId: string,
    input: { type: "open" | "click"; ip?: string; userAgent?: string; url?: string; country?: string; timezone?: string }
  ): EmailMessage | undefined {
    const message = (this.data.emailMessages ?? []).find((candidate) => candidate.trackingEnabled && candidate.trackingId === trackingId.trim());
    if (!message) {
      return undefined;
    }
    message.trackingEvents = [...(message.trackingEvents ?? []), buildTrackingEvent(input.type, input)].slice(-200);
    return clone(message);
  }

  updateEmailMessageStatus(
    context: RequestContext,
    messageId: string,
    status: EmailMessage["status"],
    options: { externalMessageId?: string; failureReason?: string | null } = {}
  ): EmailMessage {
    requirePermission(context, "crm.write");
    const message = (this.data.emailMessages ?? []).find((candidate) => candidate.id === messageId && candidate.workspaceId === context.workspaceId);
    if (!message) {
      throw new Error("Email message not found");
    }
    this.assertEmailThread(context, message.threadId);
    const previousStatus = message.status;
    message.status = status;
    if (options.externalMessageId?.trim()) {
      message.externalMessageId = options.externalMessageId.trim();
    }
    if (status === "failed") {
      message.failureReason = options.failureReason?.trim() || "Delivery failed";
    } else if (status === "queued" || status === "sending" || status === "sent") {
      delete message.failureReason;
    }
    if (status === "sent") {
      message.sentAt = stamp();
      delete message.scheduledSendAt;
    } else {
      delete message.sentAt;
    }
    if (status === "sending") {
      message.sendAttemptedAt = stamp();
    } else if (status === "queued") {
      delete message.sendAttemptedAt;
    }
    this.writeAuditLog(context, "update", "email_message", message.id, {
      summary: `Updated email status ${message.subject}`,
      details: { status, previousStatus, threadId: message.threadId }
    });
    if (status === "sent" && previousStatus !== "sent") {
      this.triggerEmailAutomations(context, message);
    }
    return clone(message);
  }

  claimEmailMessageForSending(context: RequestContext, messageId: string): { message: EmailMessage; claimed: boolean } {
    requirePermission(context, "crm.write");
    const message = (this.data.emailMessages ?? []).find((candidate) => candidate.id === messageId && candidate.workspaceId === context.workspaceId);
    if (!message) {
      throw new Error("Email message not found");
    }
    this.assertEmailThread(context, message.threadId);
    const staleBefore = emailSendClaimStaleBefore();
    const isClaimableSending = message.status === "sending" && isEmailSendClaimStale(message.sendAttemptedAt, staleBefore);
    const scheduledAt = message.scheduledSendAt ? new Date(message.scheduledSendAt) : undefined;
    if (scheduledAt && scheduledAt.getTime() > Date.now() && message.status === "queued") {
      return { message: clone(message), claimed: false };
    }
    if (message.direction !== "outbound" || (message.status !== "queued" && message.status !== "failed" && !isClaimableSending)) {
      return { message: clone(message), claimed: false };
    }
    const previousStatus = message.status;
    message.status = "sending";
    message.sendAttemptedAt = stamp();
    delete message.failureReason;
    delete message.sentAt;
    this.writeAuditLog(context, "update", "email_message", message.id, {
      summary: `Claimed email send ${message.subject}`,
      details: { status: message.status, previousStatus, threadId: message.threadId }
    });
    return { message: clone(message), claimed: true };
  }

  updateEmailMessageTranslation(context: RequestContext, messageId: string, text: string, locale: string, sources: EmailMessage["translatedSources"] = []): EmailMessage {
    requirePermission(context, "crm.write");
    const message = (this.data.emailMessages ?? []).find((candidate) => candidate.id === messageId && candidate.workspaceId === context.workspaceId);
    if (!message) {
      throw new Error("Email message not found");
    }
    this.assertEmailThread(context, message.threadId);
    const translatedSources = this.assertVisibleEmailAiSources(context, sources);
    message.translatedBodyText = normalizeRequiredText(text, "Email translation");
    message.translatedLocale = normalizeRequiredText(locale, "Translation locale");
    message.translatedSources = translatedSources;
    message.translatedAt = stamp();
    this.writeAuditLog(context, "update", "email_message", message.id, {
      summary: `Translated email ${message.subject}`,
      details: { threadId: message.threadId, locale: message.translatedLocale, sourceCount: translatedSources.length }
    });
    return clone(message);
  }

  recordEmailMessage(
    context: RequestContext,
    input: Pick<EmailMessage, "accountId" | "direction" | "from" | "to" | "subject" | "bodyText"> &
      Partial<Pick<EmailMessage, "threadId" | "cc" | "bcc" | "bodyHtml" | "attachments" | "aiAssisted" | "aiPurpose" | "aiSourceMessageId" | "aiSources" | "aiGeneratedAt" | "externalMessageId" | "clientRequestId" | "status" | "sendAttemptedAt" | "scheduledSendAt" | "sentAt" | "receivedAt" | "trackingEnabled" | "trackingId" | "trackingEvents" | "inboundMetadata" | "groupSendMode" | "createdById">> & {
        recordId?: string;
        skipAutoLink?: boolean;
      }
  ): EmailMessage {
    requirePermission(context, "crm.write");
    const account = this.assertEmailAccount(context, input.accountId);
    const normalizedExternalMessageId = input.externalMessageId?.trim() || undefined;
    const normalizedClientRequestId = input.clientRequestId?.trim() || undefined;
    const createdById = input.createdById ?? context.user.id;
    if (normalizedExternalMessageId) {
      const existing = (this.data.emailMessages ?? []).find(
        (candidate) =>
          candidate.workspaceId === context.workspaceId &&
          candidate.accountId === account.id &&
          candidate.externalMessageId === normalizedExternalMessageId
      );
      if (existing) {
        return clone(existing);
      }
    }
    if (normalizedClientRequestId) {
      const existing = (this.data.emailMessages ?? []).find(
        (candidate) =>
          candidate.workspaceId === context.workspaceId &&
          candidate.accountId === account.id &&
          candidate.direction === input.direction &&
          candidate.createdById === createdById &&
          candidate.clientRequestId === normalizedClientRequestId
      );
      if (existing) {
        return clone(existing);
      }
    }
    const now = stamp();
    const requestedRecordId = input.recordId ? this.assertVisibleRecordById(context, input.recordId).id : undefined;
    const autoRecordId = requestedRecordId ?? (input.skipAutoLink ? undefined : this.findRecordIdByEmailParticipants(context, account.emailAddress, [input.from, ...input.to, ...(input.cc ?? [])]));
    const thread = input.threadId
      ? this.assertEmailThread(context, input.threadId)
      : (!input.skipAutoLink ? this.findMatchingEmailThread(context, account.id, account.emailAddress, input.subject, [input.from, ...input.to, ...(input.cc ?? [])], autoRecordId) : undefined) ??
        this.createEmailThreadForMessage(context, account.id, { ...input, recordId: autoRecordId }, now);
    const aiSourceMessageId = input.aiSourceMessageId?.trim() || undefined;
    if (aiSourceMessageId) {
      this.getEmailMessage(context, aiSourceMessageId);
    }
    assertEmailOutboundAiPurpose(input.direction, input.aiAssisted, input.aiPurpose, input.aiGeneratedAt);
    if (input.aiAssisted) {
      requirePermission(context, "ai.use");
    }
    const aiSources = input.aiAssisted ? this.assertVisibleEmailAiSources(context, input.aiSources) : [];
    const settings = this.ensureEmailAiSettings(context.workspaceId);
    if (input.aiAssisted && settings.requireSourceLinks && aiSources.length === 0) {
      throw new Error("AI assisted email requires at least one visible source");
    }
    const trackingEnabled = input.direction === "outbound" && input.trackingEnabled === true;
    const trackingId = trackingEnabled ? input.trackingId?.trim() || createEmailTrackingId() : undefined;
    const message: EmailMessage = {
      id: createId("email_message"),
      workspaceId: context.workspaceId,
      threadId: thread.id,
      accountId: account.id,
      direction: input.direction,
      status: input.status ?? (input.direction === "inbound" ? "received" : "draft"),
      from: normalizeEmailAddress(input.from),
      to: input.to.map(normalizeEmailAddress),
      cc: input.cc?.map(normalizeEmailAddress),
      bcc: input.bcc?.map(normalizeEmailAddress),
      subject: normalizeRequiredText(input.subject, "Email subject"),
      bodyText: normalizeRequiredText(input.bodyText, "Email body"),
      bodyHtml: trackingEnabled ? appendEmailTrackingHtml(input.bodyHtml, trackingId!) : input.bodyHtml,
      attachments: normalizeEmailAttachments(input.attachments),
      aiAssisted: input.aiAssisted || undefined,
      aiPurpose: input.aiPurpose,
      aiSourceMessageId,
      aiSources: aiSources.length ? aiSources : undefined,
      aiGeneratedAt: input.aiGeneratedAt,
      externalMessageId: normalizedExternalMessageId,
      clientRequestId: normalizedClientRequestId,
      failureReason: input.status === "failed" ? "Delivery failed" : undefined,
      sendAttemptedAt: input.sendAttemptedAt ?? (input.status === "sending" ? now : undefined),
      scheduledSendAt: input.scheduledSendAt,
      sentAt: input.sentAt,
      receivedAt: input.receivedAt,
      trackingEnabled: trackingEnabled || undefined,
      trackingId,
      trackingEvents: input.trackingEvents,
      inboundMetadata: input.inboundMetadata,
      groupSendMode: input.groupSendMode || undefined,
      createdById,
      createdAt: now
    };
    (this.data.emailMessages ??= []).push(message);
    this.updateEmailThreadFromMessage(thread, message, autoRecordId);
    if (message.direction === "inbound" && message.status === "received" && canRunEmailClassification(context, settings) && context.role.permissions.includes("crm.read")) {
      this.updateEmailThreadState(context, thread.id, { category: classifyEmailCategory(message) });
    }
    if (thread.recordId) {
      this.createActivity(context, {
        recordId: thread.recordId,
        type: "email",
        title: message.subject,
        body: message.bodyText
      });
    }
    this.writeAuditLog(context, "create", "email_message", message.id, {
      summary: `Recorded ${message.direction} email ${message.subject}`,
      details: {
        accountId: account.id,
        threadId: thread.id,
        status: message.status,
        attachmentCount: message.attachments?.length ?? 0,
        aiAssisted: message.aiAssisted ?? false,
        aiPurpose: message.aiPurpose,
        aiSourceMessageId: message.aiSourceMessageId,
        aiSourceCount: message.aiSources?.length ?? 0
      }
    });
    this.triggerEmailAutomations(context, message);
    return clone(message);
  }

  queueEmailMessage(
    context: RequestContext,
    input: Pick<EmailMessage, "accountId" | "to" | "subject" | "bodyText"> &
      Partial<Pick<EmailMessage, "threadId" | "cc" | "bcc" | "bodyHtml" | "attachments" | "aiAssisted" | "aiPurpose" | "aiSourceMessageId" | "aiSources" | "aiGeneratedAt" | "clientRequestId" | "scheduledSendAt" | "trackingEnabled" | "groupSendMode">> & { recordId?: string; skipAutoLink?: boolean }
  ): EmailMessage {
    requirePermission(context, "crm.write");
    const account = this.assertEmailAccount(context, input.accountId);
    if (!account.sendEnabled || account.status === "disabled") {
      throw new Error("Email account is not enabled for sending");
    }
    return this.recordEmailMessage(context, {
      ...input,
      direction: "outbound",
      from: account.emailAddress,
      status: "queued"
    });
  }

  listKnowledgeArticles(context: RequestContext, activeOnly = true): KnowledgeArticle[] {
    requirePermission(context, "crm.read");
    return clone(
      (this.data.knowledgeArticles ?? [])
        .filter((article) => article.workspaceId === context.workspaceId && (!activeOnly || article.active))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    );
  }

  getKnowledgeArticle(context: RequestContext, articleId: string): KnowledgeArticle {
    requirePermission(context, "crm.read");
    const article = (this.data.knowledgeArticles ?? []).find((candidate) => candidate.id === articleId && candidate.workspaceId === context.workspaceId);
    if (!article) {
      throw new Error("Knowledge article not found");
    }
    return clone(article);
  }

  createKnowledgeArticle(context: RequestContext, input: Pick<KnowledgeArticle, "title" | "body"> & Partial<Pick<KnowledgeArticle, "tags" | "active">>): KnowledgeArticle {
    requirePermission(context, "crm.admin");
    const now = stamp();
    const article: KnowledgeArticle = {
      id: createId("knowledge"),
      workspaceId: context.workspaceId,
      title: normalizeRequiredText(input.title, "Knowledge title"),
      body: normalizeRequiredText(input.body, "Knowledge body"),
      tags: input.tags?.map((tag) => tag.trim()).filter(Boolean) ?? [],
      active: input.active ?? true,
      createdById: context.user.id,
      createdAt: now,
      updatedAt: now
    };
    (this.data.knowledgeArticles ??= []).push(article);
    this.writeAuditLog(context, "create", "knowledge_article", article.id, {
      summary: `Created knowledge article ${article.title}`,
      details: { tags: article.tags, active: article.active }
    });
    return clone(article);
  }

  updateKnowledgeArticle(context: RequestContext, articleId: string, input: Partial<Pick<KnowledgeArticle, "title" | "body" | "tags" | "active">>): KnowledgeArticle {
    requirePermission(context, "crm.admin");
    const article = (this.data.knowledgeArticles ?? []).find((candidate) => candidate.id === articleId && candidate.workspaceId === context.workspaceId);
    if (!article) {
      throw new Error("Knowledge article not found");
    }
    if (input.title !== undefined) article.title = normalizeRequiredText(input.title, "Knowledge title");
    if (input.body !== undefined) article.body = normalizeRequiredText(input.body, "Knowledge body");
    if (input.tags !== undefined) article.tags = input.tags.map((tag) => tag.trim()).filter(Boolean);
    if (input.active !== undefined) article.active = input.active;
    article.updatedAt = stamp();
    this.writeAuditLog(context, "update", "knowledge_article", article.id, {
      summary: `Updated knowledge article ${article.title}`,
      details: { tags: article.tags, active: article.active }
    });
    return clone(article);
  }

  deleteKnowledgeArticle(context: RequestContext, articleId: string): void {
    requirePermission(context, "crm.admin");
    this.updateKnowledgeArticle(context, articleId, { active: false });
  }

  listTalkMessages(context: RequestContext, target: TalkMessageTargetInput): TalkMessage[] {
    requirePermission(context, "ai.use");
    this.assertTalkTargetAccess(context, target);
    return clone(
      (this.data.talkMessages ?? [])
        .filter((message) => message.workspaceId === context.workspaceId && talkMessageMatchesTarget(message, target))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .slice(-200)
    );
  }

  createTalkMessage(
    context: RequestContext,
    input: TalkMessageTargetInput & Pick<TalkMessage, "role" | "content"> & Partial<Pick<TalkMessage, "sources" | "knowledgeArticleId">>
  ): TalkMessage {
    requirePermission(context, "ai.use");
    this.assertTalkTargetAccess(context, input);
    if (input.knowledgeArticleId) {
      this.getKnowledgeArticle(context, input.knowledgeArticleId);
    }
    const now = stamp();
    const message: TalkMessage = {
      id: createId("talk"),
      workspaceId: context.workspaceId,
      targetType: input.type,
      objectKey: input.type === "record" ? input.objectKey : undefined,
      recordId: input.type === "record" ? input.recordId : undefined,
      threadId: input.type === "email_thread" ? input.threadId : undefined,
      role: input.role,
      content: normalizeRequiredText(input.content, "Talk message"),
      sources: normalizeTalkSources(input.sources),
      knowledgeArticleId: input.knowledgeArticleId,
      createdById: context.user.id,
      createdAt: now
    };
    (this.data.talkMessages ??= []).push(message);
    return clone(message);
  }

  markTalkMessageKnowledgeArticle(context: RequestContext, messageId: string, knowledgeArticleId: string): TalkMessage {
    requirePermission(context, "ai.use");
    this.getKnowledgeArticle(context, knowledgeArticleId);
    const message = (this.data.talkMessages ?? []).find((candidate) => candidate.id === messageId && candidate.workspaceId === context.workspaceId);
    if (!message) {
      throw new Error("Talk message not found");
    }
    message.knowledgeArticleId = knowledgeArticleId;
    return clone(message);
  }

  deleteTalkMessage(context: RequestContext, messageId: string): void {
    requirePermission(context, "ai.use");
    const messages = this.data.talkMessages ?? [];
    const index = messages.findIndex((candidate) => candidate.id === messageId && candidate.workspaceId === context.workspaceId);
    if (index === -1) {
      throw new Error("Talk message not found");
    }
    messages.splice(index, 1);
  }

  listMediaAssets(context: RequestContext): MediaAsset[] {
    requirePermission(context, "crm.read");
    return clone(
      (this.data.mediaAssets ?? [])
        .filter((asset) => asset.workspaceId === context.workspaceId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 200)
    );
  }

  createMediaAsset(context: RequestContext, input: Pick<MediaAsset, "name" | "contentType" | "size" | "contentBase64">): MediaAsset {
    requirePermission(context, "crm.write");
    const now = stamp();
    const asset: MediaAsset = {
      id: createId("media"),
      workspaceId: context.workspaceId,
      name: normalizeRequiredText(input.name, "Media name"),
      contentType: input.contentType,
      size: input.size,
      contentBase64: input.contentBase64,
      createdById: context.user.id,
      createdAt: now,
      updatedAt: now
    };
    (this.data.mediaAssets ??= []).push(asset);
    this.writeAuditLog(context, "create", "media_asset", asset.id, {
      summary: `Created media asset ${asset.name}`,
      details: { contentType: asset.contentType, size: asset.size }
    });
    return clone(asset);
  }

  updateMediaAsset(context: RequestContext, assetId: string, patch: Partial<Pick<MediaAsset, "name" | "contentType" | "size" | "contentBase64">>): MediaAsset {
    requirePermission(context, "crm.write");
    const asset = (this.data.mediaAssets ?? []).find((candidate) => candidate.id === assetId && candidate.workspaceId === context.workspaceId);
    if (!asset) {
      throw new Error("Media asset not found");
    }
    if (patch.name !== undefined) {
      asset.name = normalizeRequiredText(patch.name, "Media name");
    }
    if (patch.contentType !== undefined) {
      asset.contentType = patch.contentType;
    }
    if (patch.size !== undefined) {
      asset.size = patch.size;
    }
    if (patch.contentBase64 !== undefined) {
      asset.contentBase64 = patch.contentBase64;
    }
    asset.updatedAt = stamp();
    this.writeAuditLog(context, "update", "media_asset", asset.id, {
      summary: `Updated media asset ${asset.name}`,
      details: { contentType: asset.contentType, size: asset.size }
    });
    return clone(asset);
  }

  deleteMediaAsset(context: RequestContext, assetId: string): void {
    requirePermission(context, "crm.write");
    const assets = this.data.mediaAssets ?? [];
    const index = assets.findIndex((candidate) => candidate.id === assetId && candidate.workspaceId === context.workspaceId);
    if (index === -1) {
      throw new Error("Media asset not found");
    }
    const [asset] = assets.splice(index, 1);
    this.writeAuditLog(context, "delete", "media_asset", asset.id, {
      summary: `Deleted media asset ${asset.name}`,
      details: { contentType: asset.contentType, size: asset.size }
    });
  }

  getEmailAiSettings(context: RequestContext): EmailAiSettings {
    requirePermission(context, "crm.read");
    return publicEmailAiSettings(this.ensureEmailAiSettings(context.workspaceId));
  }

  updateEmailAiSettings(context: RequestContext, patch: Partial<Omit<EmailAiSettings, "workspaceId" | "updatedAt">>): EmailAiSettings {
    requirePermission(context, "ai.admin");
    const settings = this.ensureEmailAiSettings(context.workspaceId);
    if (patch.features) {
      settings.features = normalizeEmailAiFeatures({ ...settings.features, ...patch.features });
    }
    if (patch.agents !== undefined) {
      settings.agents = normalizeAiAgentSettings(patch.agents);
    } else {
      settings.agents = normalizeAiAgentSettings(settings.agents);
    }
    if (patch.providerConfig !== undefined) {
      settings.providerConfig = mergeAiProviderConfigSecrets(normalizeAiProviderConfig(settings.providerConfig), patch.providerConfig);
    } else {
      settings.providerConfig = normalizeAiProviderConfig(settings.providerConfig);
    }
    if (patch.defaultLocale !== undefined) settings.defaultLocale = normalizeRequiredText(patch.defaultLocale, "Default locale");
    if (patch.requireSourceLinks !== undefined) settings.requireSourceLinks = patch.requireSourceLinks;
    if (patch.maxHistoryMessages !== undefined) settings.maxHistoryMessages = normalizeIntegerLimit(patch.maxHistoryMessages, 1, 20);
    if (patch.maxKnowledgeArticles !== undefined) settings.maxKnowledgeArticles = normalizeIntegerLimit(patch.maxKnowledgeArticles, 0, 20);
    if (patch.maxContextChars !== undefined) settings.maxContextChars = normalizeIntegerLimit(patch.maxContextChars, 1000, 20000);
    settings.updatedAt = stamp();
    this.writeAuditLog(context, "update", "email_ai_settings", context.workspaceId, {
      summary: "Updated email AI settings",
      details: { features: settings.features, provider: settings.providerConfig.provider }
    });
    return publicEmailAiSettings(settings);
  }

  getEmailAiProviderConfig(context: RequestContext): AiProviderConfig {
    requirePermission(context, "ai.use");
    return normalizeAiProviderConfig(this.ensureEmailAiSettings(context.workspaceId).providerConfig);
  }

  getEmailSyncSettings(context: RequestContext): EmailSyncSettings {
    requirePermission(context, "crm.admin");
    return clone(this.ensureEmailSyncSettings(context.workspaceId));
  }

  updateEmailSyncSettings(context: RequestContext, patch: Partial<Omit<EmailSyncSettings, "workspaceId" | "updatedAt">>): EmailSyncSettings {
    requirePermission(context, "crm.admin");
    const settings = this.ensureEmailSyncSettings(context.workspaceId);
    if (patch.enabled !== undefined) settings.enabled = patch.enabled;
    if (patch.mode === "interval" || patch.mode === "daily") settings.mode = patch.mode;
    if (patch.intervalMinutes !== undefined) settings.intervalMinutes = normalizeIntegerLimit(patch.intervalMinutes, 1, 1440);
    if (patch.dailyAt !== undefined) settings.dailyAt = normalizeDailyTime(patch.dailyAt);
    if (patch.limit !== undefined) settings.limit = normalizeIntegerLimit(patch.limit, 1, 100);
    settings.updatedAt = stamp();
    this.writeAuditLog(context, "update", "email_sync_settings", context.workspaceId, {
      summary: "Updated email sync schedule settings",
      details: { enabled: settings.enabled, mode: settings.mode, intervalMinutes: settings.intervalMinutes, dailyAt: settings.dailyAt, limit: settings.limit }
    });
    return clone(settings);
  }

  buildEmailAssistantContext(
    context: RequestContext,
    input: Pick<EmailAssistantInput, "purpose" | "targetLocale"> & { recordId?: string; objectKey?: string; threadId?: string; sourceMessageId?: string }
  ) {
    requirePermission(context, "ai.use");
    const sourceMessage = input.sourceMessageId ? this.getEmailMessage(context, input.sourceMessageId) : undefined;
    const thread = input.threadId
      ? this.assertEmailThread(context, input.threadId)
      : sourceMessage
        ? this.assertEmailThread(context, sourceMessage.threadId)
        : undefined;
    if (sourceMessage && thread && sourceMessage.threadId !== thread.id) {
      throw new Error("Source email message does not belong to this thread");
    }
    assertEmailAiRecordThreadAlignment(input.recordId, thread);
    const recordId = input.recordId ?? thread?.recordId;
    const record = recordId
      ? input.objectKey
        ? this.getRecord(context, input.objectKey, recordId)
        : this.data.records.find((candidate) => candidate.id === recordId && candidate.workspaceId === context.workspaceId && this.canAccessRecord(context, candidate))
      : undefined;
    const fields = record ? this.listFieldDefinitions(context, record.objectKey) : [];
    const activities = record ? this.listActivities(context, record.id) : [];
    const messages = thread ? this.listEmailMessages(context, thread.id) : [];
    return buildEmailAssistantContext({
      settings: this.getEmailAiSettings(context),
      purpose: input.purpose,
      record,
      fields,
      activities,
      thread,
      messages,
      sourceMessage,
      knowledgeArticles: this.listKnowledgeArticles(context),
      targetLocale: input.targetLocale
    });
  }

  recordEmailAiGeneration(context: RequestContext, input: EmailAiGenerationAuditInput): void {
    requirePermission(context, "ai.use");
    this.writeAuditLog(context, "create", "email_ai_generation", input.threadId ?? input.sourceMessageId ?? input.recordId, {
      summary: `${input.enabled ? "Generated" : "Skipped"} email AI ${input.purpose}`,
      details: {
        purpose: input.purpose,
        enabled: input.enabled,
        recordId: input.recordId,
        threadId: input.threadId,
        sourceMessageId: input.sourceMessageId,
        sourceCount: input.sourceCount,
        sourceLabels: input.sourceLabels?.slice(0, 10),
        targetLocale: input.targetLocale,
        userPromptLength: input.userPromptLength ?? 0,
        sourceTextLength: input.sourceTextLength ?? 0,
        resultTextLength: input.resultTextLength ?? 0,
        contextCharCount: input.contextCharCount ?? 0,
        maxContextChars: input.maxContextChars ?? 0,
        modelPromptChars: input.modelPromptChars ?? 0,
        contextTruncated: input.contextTruncated ?? false,
        outputTruncated: input.outputTruncated ?? false,
        generationMode: input.generationMode,
        providerError: normalizeEmailAiProviderError(input.providerError),
        suggestedSubjectProvided: input.suggestedSubjectProvided ?? false,
        persisted: input.persisted,
        automationFailed: input.automationFailed ?? false,
        errorMessage: input.errorMessage
      }
    });
  }

  deliverWebhookEvent(context: RequestContext, event: WebhookEvent, data: Record<string, unknown>): WebhookDelivery[] {
    const webhooks = ((this.data.webhooks ?? []) as StoredWebhookEndpoint[]).filter(
      (webhook) => webhook.workspaceId === context.workspaceId && webhook.active && webhook.events.includes(event)
    );

    return webhooks.map((webhook) => this.recordStoreWebhookDelivery(context, webhook, event, data));
  }

  listTeams(context: RequestContext): Team[] {
    requirePermission(context, "crm.read");
    return clone(this.data.teams.filter((team) => team.workspaceId === context.workspaceId).sort((left, right) => left.name.localeCompare(right.name)));
  }

  createTeam(context: RequestContext, input: Pick<Team, "name">): Team {
    requirePermission(context, "crm.admin");
    const name = normalizeTeamName(input.name);
    this.assertTeamNameAvailable(context, name);

    const team: Team = {
      id: createId("team"),
      workspaceId: context.workspaceId,
      name
    };
    this.data.teams.push(team);
    this.writeAuditLog(context, "create", "team", team.id, {
      summary: `Created team ${team.name}`,
      details: { name: team.name }
    });
    return clone(team);
  }

  updateTeam(context: RequestContext, id: string, patch: Partial<Pick<Team, "name">>): Team {
    requirePermission(context, "crm.admin");
    const team = this.data.teams.find((candidate) => candidate.id === id && candidate.workspaceId === context.workspaceId);
    if (!team) {
      throw new Error("Team not found");
    }
    const name = normalizeTeamName(patch.name ?? team.name);
    if (name !== team.name) {
      this.assertTeamNameAvailable(context, name, id);
    }

    team.name = name;
    this.writeAuditLog(context, "update", "team", team.id, {
      summary: `Updated team ${team.name}`,
      details: { name: team.name }
    });
    return clone(team);
  }

  deleteTeam(context: RequestContext, id: string): void {
    requirePermission(context, "crm.admin");
    const team = this.data.teams.find((candidate) => candidate.id === id && candidate.workspaceId === context.workspaceId);
    if (!team) {
      throw new Error("Team not found");
    }

    const assignedUsers = this.data.users.filter((user) => user.workspaceId === context.workspaceId && user.teamId === id);
    if (assignedUsers.length > 0) {
      throw new Error(`Team is assigned to ${assignedUsers.length} users and cannot be deleted`);
    }

    this.data.teams = this.data.teams.filter((candidate) => candidate.id !== id);
    this.writeAuditLog(context, "delete", "team", team.id, {
      summary: `Deleted team ${team.name}`,
      details: { name: team.name }
    });
  }

  listRoles(context: RequestContext): Role[] {
    requirePermission(context, "crm.admin");
    return clone(this.data.roles.filter((role) => role.workspaceId === context.workspaceId).sort((left, right) => left.name.localeCompare(right.name)));
  }

  createRole(context: RequestContext, input: Pick<Role, "name" | "permissions">): Role {
    requirePermission(context, "crm.admin");
    const data = normalizeRoleInput(input);
    this.assertRoleNameAvailable(context, data.name);

    const role: Role = {
      id: createId("role"),
      workspaceId: context.workspaceId,
      name: data.name,
      permissions: data.permissions
    };
    this.data.roles.push(role);
    this.writeAuditLog(context, "create", "role", role.id, {
      summary: `Created role ${role.name}`,
      details: { name: role.name, permissions: role.permissions }
    });
    return clone(role);
  }

  updateRole(context: RequestContext, id: string, patch: Partial<Pick<Role, "name" | "permissions">>): Role {
    requirePermission(context, "crm.admin");
    const role = this.data.roles.find((candidate) => candidate.id === id && candidate.workspaceId === context.workspaceId);
    if (!role) {
      throw new Error("Role not found");
    }

    const data = normalizeRoleInput({
      name: patch.name ?? role.name,
      permissions: patch.permissions ?? role.permissions
    });
    if (data.name !== role.name) {
      this.assertRoleNameAvailable(context, data.name, id);
    }
    if (role.permissions.includes("crm.admin") && !data.permissions.includes("crm.admin")) {
      this.assertWorkspaceKeepsAdminUser(context, id);
    }

    Object.assign(role, data);
    this.writeAuditLog(context, "update", "role", role.id, {
      summary: `Updated role ${role.name}`,
      details: { patch: data }
    });
    return clone(role);
  }

  deleteRole(context: RequestContext, id: string): void {
    requirePermission(context, "crm.admin");
    const role = this.data.roles.find((candidate) => candidate.id === id && candidate.workspaceId === context.workspaceId);
    if (!role) {
      throw new Error("Role not found");
    }

    const assignedUsers = this.data.users.filter((user) => user.workspaceId === context.workspaceId && user.roleId === id);
    if (assignedUsers.length > 0) {
      throw new Error(`Role is assigned to ${assignedUsers.length} users and cannot be deleted`);
    }

    this.data.roles = this.data.roles.filter((candidate) => candidate.id !== id);
    this.writeAuditLog(context, "delete", "role", role.id, {
      summary: `Deleted role ${role.name}`,
      details: { name: role.name, permissions: role.permissions }
    });
  }

  listAuditLogs(context: RequestContext, query: AuditLogQuery = {}): AuditLog[] {
    requirePermission(context, "crm.admin");
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize, { defaultSize: AUDIT_DEFAULT_PAGE_SIZE, maxSize: AUDIT_EXPORT_MAX_PAGE_SIZE });
    return clone(
      this.data.auditLogs
        .filter((log) => log.workspaceId === context.workspaceId)
        .filter((log) => (query.action ? log.action === query.action : true))
        .filter((log) => (query.entityType ? log.entityType === query.entityType : true))
        .filter((log) => (query.objectKey ? log.objectKey === query.objectKey : true))
        .filter((log) => (query.actorId ? log.actorId === query.actorId : true))
        .filter((log) =>
          query.q ? `${log.summary} ${log.entityType} ${log.entityId ?? ""}`.toLowerCase().includes(query.q.toLowerCase()) : true
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice((page - 1) * pageSize, page * pageSize)
    );
  }

  exportAuditLogsCsv(context: RequestContext, query: AuditLogQuery = {}): string {
    requirePermission(context, "crm.admin");
    const logs = this.listAuditLogs(context, { ...query, page: 1, pageSize: 1000 });
    const headers = ["id", "createdAt", "action", "entityType", "entityId", "objectKey", "actorId", "summary", "details"];
    return buildCsv(
      headers,
      logs.map((log) => ({
        id: log.id,
        createdAt: log.createdAt,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        objectKey: log.objectKey,
        actorId: log.actorId,
        summary: log.summary,
        details: log.details
      }))
    );
  }

  getDashboardSummary(context: RequestContext): DashboardSummary {
    requirePermission(context, "crm.read");
    const records = this.data.records.filter((record) => record.workspaceId === context.workspaceId && this.canAccessRecord(context, record));
    const recordCounts = records.reduce<Record<string, number>>((counts, record) => {
      counts[record.objectKey] = (counts[record.objectKey] ?? 0) + 1;
      return counts;
    }, {});
    const deals = records
      .filter((record) => record.objectKey === "deals")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const visibleActivities = this.listActivities(context);
    const openTasks = visibleActivities
      .filter((activity) => activity.type === "task" && !activity.completedAt && !activity.archivedAt)
      .sort((left, right) => (left.dueAt ?? left.createdAt).localeCompare(right.dueAt ?? right.createdAt));

    return clone({
      recordCounts,
      totalPipeline: deals.reduce((sum, deal) => sum + Number(deal.data.amount ?? 0), 0),
      openTaskCount: openTasks.length,
      deals: deals.slice(0, 50),
      openTasks: openTasks.slice(0, 50),
      recentActivities: visibleActivities.slice(0, 100)
    });
  }

  listObjectDefinitions(context: RequestContext): ObjectDefinition[] {
    requirePermission(context, "crm.read");
    return clone(this.data.objectDefinitions.filter((object) => object.workspaceId === context.workspaceId));
  }

  createObjectDefinition(context: RequestContext, input: Pick<ObjectDefinition, "key" | "label" | "pluralLabel" | "description" | "icon">): ObjectDefinition {
    requirePermission(context, "crm.admin");
    if (!/^[a-z][a-z0-9-]*s$/.test(input.key)) {
      throw new Error("对象 key 必须是小写复数形式，例如 partners");
    }

    if (this.data.objectDefinitions.some((object) => object.workspaceId === context.workspaceId && object.key === input.key)) {
      throw new Error("对象 key 已存在");
    }

    const object: ObjectDefinition = {
      id: createId("obj"),
      workspaceId: context.workspaceId,
      key: input.key,
      label: input.label,
      pluralLabel: input.pluralLabel,
      description: input.description,
      icon: input.icon,
      isSystem: false,
      createdAt: stamp(),
      updatedAt: stamp()
    };
    this.data.objectDefinitions.push(object);
    this.writeAuditLog(context, "create", "object_definition", object.id, {
      objectKey: object.key,
      summary: `Created object definition ${object.key}`,
      details: { label: object.label, pluralLabel: object.pluralLabel }
    });
    return clone(object);
  }

  updateObjectDefinition(context: RequestContext, id: string, patch: Partial<Pick<ObjectDefinition, "label" | "pluralLabel" | "description" | "icon">>): ObjectDefinition {
    requirePermission(context, "crm.admin");
    const object = this.data.objectDefinitions.find((candidate) => candidate.id === id && candidate.workspaceId === context.workspaceId);
    if (!object) {
      throw new Error("对象不存在");
    }
    Object.assign(object, patch, { updatedAt: stamp() });
    this.writeAuditLog(context, "update", "object_definition", object.id, {
      objectKey: object.key,
      summary: `Updated object definition ${object.key}`,
      details: { patch }
    });
    return clone(object);
  }

  deleteObjectDefinition(context: RequestContext, id: string): void {
    requirePermission(context, "crm.admin");
    const object = this.data.objectDefinitions.find((candidate) => candidate.id === id && candidate.workspaceId === context.workspaceId);
    if (!object) {
      throw new Error("对象不存在");
    }
    if (object.isSystem) {
      throw new Error("系统对象不能删除");
    }
    this.assertObjectCanBeDeleted(context, object);
    this.data.objectDefinitions = this.data.objectDefinitions.filter((candidate) => candidate.id !== id);
    this.data.fieldDefinitions = this.data.fieldDefinitions.filter((field) => field.objectKey !== object.key);
    this.data.relationDefinitions = this.data.relationDefinitions.filter(
      (relation) => relation.fromObjectKey !== object.key && relation.toObjectKey !== object.key
    );
    this.data.pipelines = this.data.pipelines.filter((pipeline) => pipeline.objectKey !== object.key);
    this.data.savedViews = this.data.savedViews.filter((view) => view.objectKey !== object.key);
    this.data.records = this.data.records.filter((record) => record.objectKey !== object.key);
    this.writeAuditLog(context, "delete", "object_definition", id, {
      objectKey: object.key,
      summary: `Deleted object definition ${object.key}`,
      details: { key: object.key }
    });
  }

  listFieldDefinitions(context: RequestContext, objectKey?: string): FieldDefinition[] {
    requirePermission(context, "crm.read");
    return clone(
      this.data.fieldDefinitions
        .filter((field) => field.workspaceId === context.workspaceId && (!objectKey || field.objectKey === objectKey))
        .sort((a, b) => a.position - b.position)
    );
  }

  createFieldDefinition(context: RequestContext, input: Omit<FieldDefinition, "id" | "workspaceId" | "isSystem" | "position"> & { position?: number }): FieldDefinition {
    requirePermission(context, "crm.admin");
    assertValidFieldDefinition(input);
    this.assertObject(context, input.objectKey);
    this.assertFieldReferenceTarget(context, input);

    if (this.data.fieldDefinitions.some((field) => field.workspaceId === context.workspaceId && field.objectKey === input.objectKey && field.key === input.key)) {
      throw new Error("字段 key 已存在");
    }

    const nextPosition = input.position ?? this.data.fieldDefinitions.filter((field) => field.objectKey === input.objectKey).length + 1;
    const field: FieldDefinition = {
      ...input,
      id: createId("field"),
      workspaceId: context.workspaceId,
      isSystem: false,
      position: nextPosition
    };
    this.data.fieldDefinitions.push(field);
    this.writeAuditLog(context, "create", "field_definition", field.id, {
      objectKey: field.objectKey,
      summary: `Created field ${field.objectKey}.${field.key}`,
      details: { key: field.key, type: field.type, required: field.required }
    });
    return clone(field);
  }

  updateFieldDefinition(
    context: RequestContext,
    id: string,
    patch: Partial<Pick<FieldDefinition, "label" | "required" | "unique" | "options" | "defaultValue" | "position">>
  ): FieldDefinition {
    requirePermission(context, "crm.admin");
    const field = this.data.fieldDefinitions.find((candidate) => candidate.id === id && candidate.workspaceId === context.workspaceId);
    if (!field) {
      throw new Error("字段不存在");
    }

    const nextField = { ...field, ...patch };
    assertValidFieldDefinition(nextField);
    this.assertFieldReferenceTarget(context, nextField);
    this.assertFieldCompatibleWithRecords(context, nextField);
    Object.assign(field, patch);
    this.writeAuditLog(context, "update", "field_definition", field.id, {
      objectKey: field.objectKey,
      summary: `Updated field ${field.objectKey}.${field.key}`,
      details: { patch }
    });
    return clone(field);
  }

  deleteFieldDefinition(context: RequestContext, id: string): void {
    requirePermission(context, "crm.admin");
    const field = this.data.fieldDefinitions.find((candidate) => candidate.id === id && candidate.workspaceId === context.workspaceId);
    if (!field) {
      throw new Error("字段不存在");
    }
    if (field.isSystem) {
      throw new Error("系统字段不能删除");
    }
    this.assertFieldCanBeDeleted(context, field);
    this.data.fieldDefinitions = this.data.fieldDefinitions.filter((candidate) => candidate.id !== id);
    this.writeAuditLog(context, "delete", "field_definition", id, {
      objectKey: field.objectKey,
      summary: `Deleted field ${field.objectKey}.${field.key}`,
      details: { key: field.key }
    });
  }

  listRelationDefinitions(context: RequestContext): RelationDefinition[] {
    requirePermission(context, "crm.read");
    return clone(
      this.data.relationDefinitions
        .filter((relation) => relation.workspaceId === context.workspaceId)
        .sort((left, right) => left.key.localeCompare(right.key))
    );
  }

  createRelationDefinition(context: RequestContext, input: Omit<RelationDefinition, "id" | "workspaceId">): RelationDefinition {
    requirePermission(context, "crm.admin");
    this.assertObject(context, input.fromObjectKey);
    this.assertObject(context, input.toObjectKey);
    if (this.data.relationDefinitions.some((relation) => relation.workspaceId === context.workspaceId && relation.key === input.key)) {
      throw new Error("关系 key 已存在");
    }

    const relation: RelationDefinition = {
      ...input,
      id: createId("relation"),
      workspaceId: context.workspaceId
    };
    this.data.relationDefinitions.push(relation);
    this.writeAuditLog(context, "create", "relation_definition", relation.id, {
      summary: `Created relation ${relation.key}`,
      details: { fromObjectKey: relation.fromObjectKey, toObjectKey: relation.toObjectKey, cardinality: relation.cardinality }
    });
    return clone(relation);
  }

  updateRelationDefinition(
    context: RequestContext,
    id: string,
    patch: Partial<Omit<RelationDefinition, "id" | "workspaceId">>
  ): RelationDefinition {
    requirePermission(context, "crm.admin");
    const relation = this.data.relationDefinitions.find((candidate) => candidate.id === id && candidate.workspaceId === context.workspaceId);
    if (!relation) {
      throw new Error("关系不存在");
    }

    if (patch.fromObjectKey) {
      this.assertObject(context, patch.fromObjectKey);
    }
    if (patch.toObjectKey) {
      this.assertObject(context, patch.toObjectKey);
    }
    if (
      patch.key &&
      this.data.relationDefinitions.some(
        (candidate) => candidate.workspaceId === context.workspaceId && candidate.id !== id && candidate.key === patch.key
      )
    ) {
      throw new Error("关系 key 已存在");
    }

    const nextRelation = { ...relation, ...patch };
    if (nextRelation.fromObjectKey !== relation.fromObjectKey || nextRelation.toObjectKey !== relation.toObjectKey) {
      this.assertRelationCanBeDeleted(context, relation);
    }

    Object.assign(relation, patch);
    this.writeAuditLog(context, "update", "relation_definition", relation.id, {
      summary: `Updated relation ${relation.key}`,
      details: { patch }
    });
    return clone(relation);
  }

  deleteRelationDefinition(context: RequestContext, id: string): void {
    requirePermission(context, "crm.admin");
    const relation = this.data.relationDefinitions.find((candidate) => candidate.id === id && candidate.workspaceId === context.workspaceId);
    if (!relation) {
      throw new Error("关系不存在");
    }
    this.assertRelationCanBeDeleted(context, relation);
    this.data.relationDefinitions = this.data.relationDefinitions.filter((candidate) => candidate.id !== id);
    this.writeAuditLog(context, "delete", "relation_definition", id, {
      summary: `Deleted relation ${relation.key}`,
      details: { key: relation.key }
    });
  }

  listRecords(context: RequestContext, objectKey: string): CrmRecord[] {
    requirePermission(context, "crm.read");
    this.assertObject(context, objectKey);
    return clone(
      this.data.records.filter(
        (record) => record.workspaceId === context.workspaceId && record.objectKey === objectKey && this.canAccessRecord(context, record)
      )
    );
  }

  queryRecords(context: RequestContext, objectKey: string, query: RecordListQuery = {}): RecordListResult {
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize, { defaultSize: RECORD_DEFAULT_PAGE_SIZE, maxSize: RECORD_MAX_PAGE_SIZE });
    const view = buildQueryView(context.workspaceId, objectKey, query);
    const sorted = this.listRecords(context, objectKey)
      .filter((record) => matchesSavedView(record, view))
      .filter((record) => matchesRecordSearch(record, query.q))
      .sort((left, right) => (query.sort ? compareRecords(left, right, query.sort) : right.updatedAt.localeCompare(left.updatedAt)));
    const total = sorted.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, pageCount);
    const start = (safePage - 1) * pageSize;

    return clone({
      records: sorted.slice(start, start + pageSize),
      total,
      page: safePage,
      pageSize,
      pageCount,
      query: normalizeRecordListQuery(query, safePage, pageSize)
    });
  }

  exportRecordsCsv(context: RequestContext, objectKey: string, query: RecordListQuery = {}): string {
    requirePermission(context, "crm.read");
    this.assertObject(context, objectKey);
    const fields = this.listFieldDefinitions(context, objectKey);
    const result = this.queryRecords(context, objectKey, { ...query, page: 1, pageSize: 200 });
    const headers = ["id", "title", "stageKey", "ownerId", "createdAt", "updatedAt", ...fields.map((field) => field.key)];
    return buildCsv(
      headers,
      result.records.map((record) => ({
        id: record.id,
        title: record.title,
        stageKey: record.stageKey,
        ownerId: record.ownerId,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        ...record.data
      }))
    );
  }

  exportImportTemplateCsv(context: RequestContext, objectKey: string): string {
    requirePermission(context, "crm.import");
    this.assertObject(context, objectKey);
    const fields = this.listFieldDefinitions(context, objectKey);
    const headers = ["title", ...fields.map((field) => field.key)];
    return buildCsv(headers, [buildImportTemplateExampleRow(fields)]);
  }

  exportImportTemplateFieldGuideCsv(context: RequestContext, objectKey: string): string {
    requirePermission(context, "crm.import");
    this.assertObject(context, objectKey);
    const fields = this.listFieldDefinitions(context, objectKey);
    const objects = this.listObjectDefinitions(context);
    return buildImportTemplateFieldGuideCsv(fields, objects);
  }

  getRecord(context: RequestContext, objectKey: string, recordId: string): CrmRecord {
    requirePermission(context, "crm.read");
    const record = this.data.records.find((candidate) => candidate.workspaceId === context.workspaceId && candidate.objectKey === objectKey && candidate.id === recordId);
    if (!record || !this.canAccessRecord(context, record)) {
      throw new Error("记录不存在");
    }
    return clone(record);
  }

  createRecord(context: RequestContext, objectKey: string, input: Pick<CrmRecord, "title" | "data" | "stageKey" | "ownerId">): CrmRecord {
    requirePermission(context, "crm.write");
    this.assertObject(context, objectKey);
    const fields = this.listFieldDefinitions(context, objectKey);
    const existing = this.listRecordsForValidation(context, objectKey);
    const data = objectKey === "quotes" ? normalizeQuoteRecordData(input.data, this.listRecordsForValidation(context, "currencies")) : input.data;
    if (objectKey === "quotes") {
      validateQuoteRecordData(data, this.listRecordsForValidation(context, "products"));
    }
    validateRecordPayload(fields, data, existing);
    this.assertRecordReferences(context, fields, data, true);

    const record: CrmRecord = {
      id: createId("record"),
      workspaceId: context.workspaceId,
      objectKey,
      title: input.title,
      stageKey: input.stageKey,
      ownerId: canManageAllRecords(context) ? input.ownerId ?? context.user.id : context.user.id,
      data,
      createdAt: stamp(),
      updatedAt: stamp()
    };
    this.data.records.push(record);
    this.writeAuditLog(context, "create", "record", record.id, {
      objectKey,
      summary: `Created ${objectKey} record ${record.title}`,
      details: { title: record.title, ownerId: record.ownerId, stageKey: record.stageKey }
    });
    this.deliverWebhookEvent(context, "record.created", {
      recordId: record.id,
      objectKey: record.objectKey,
      title: record.title,
      ownerId: record.ownerId
    });
    return clone(record);
  }

  updateRecord(context: RequestContext, objectKey: string, recordId: string, patch: Partial<Pick<CrmRecord, "title" | "data" | "stageKey" | "ownerId">>): CrmRecord {
    requirePermission(context, "crm.write");
    const record = this.data.records.find((candidate) => candidate.workspaceId === context.workspaceId && candidate.objectKey === objectKey && candidate.id === recordId);
    if (!record || !this.canAccessRecord(context, record)) {
      throw new Error("记录不存在");
    }
    const previousStageKey = record.stageKey;
    const mergedData = { ...record.data, ...(patch.data ?? {}) };
    const nextData = objectKey === "quotes" ? normalizeQuoteRecordData(mergedData, this.listRecordsForValidation(context, "currencies")) : mergedData;
    const fields = this.listFieldDefinitions(context, objectKey);
    if (objectKey === "quotes") {
      validateQuoteRecordData(nextData, this.listRecordsForValidation(context, "products"));
    }
    validateRecordPayload(fields, nextData, this.listRecordsForValidation(context, objectKey), recordId);
    this.assertRecordReferences(context, fields, nextData, true);
    Object.assign(record, { ...patch, ownerId: canManageAllRecords(context) ? patch.ownerId ?? record.ownerId : record.ownerId }, { data: nextData, updatedAt: stamp() });
    if (objectKey === "deals" && patch.stageKey !== undefined && patch.stageKey !== previousStageKey) {
      this.data.activities.push({
        id: createId("activity"),
        workspaceId: context.workspaceId,
        recordId,
        type: "stage_change",
        title: `Stage changed: ${previousStageKey ?? "none"} -> ${patch.stageKey ?? "none"}`,
        actorId: context.user.id,
        createdAt: stamp()
      });
    }
    this.writeAuditLog(context, "update", "record", record.id, {
      objectKey,
      summary: `Updated ${objectKey} record ${record.title}`,
      details: { patch, previousStageKey, nextStageKey: record.stageKey }
    });
    this.deliverWebhookEvent(context, "record.updated", {
      recordId: record.id,
      objectKey: record.objectKey,
      title: record.title,
      previousStageKey,
      nextStageKey: record.stageKey,
      ownerId: record.ownerId
    });
    return clone(record);
  }

  deleteRecord(context: RequestContext, objectKey: string, recordId: string): void {
    requirePermission(context, "crm.write");
    const record = this.getRecord(context, objectKey, recordId);
    this.data.records = this.data.records.filter((record) => !(record.workspaceId === context.workspaceId && record.objectKey === objectKey && record.id === recordId));
    this.data.activities = this.data.activities.filter((activity) => activity.recordId !== recordId);
    this.writeAuditLog(context, "delete", "record", recordId, {
      objectKey,
      summary: `Deleted ${objectKey} record ${record.title}`,
      details: { title: record.title }
    });
    this.deliverWebhookEvent(context, "record.deleted", {
      recordId,
      objectKey,
      title: record.title
    });
  }

  listPipelines(context: RequestContext): Pipeline[] {
    requirePermission(context, "crm.read");
    return clone(this.data.pipelines.filter((pipeline) => pipeline.workspaceId === context.workspaceId));
  }

  createPipeline(context: RequestContext, input: Omit<Pipeline, "id" | "workspaceId">): Pipeline {
    requirePermission(context, "crm.admin");
    this.assertObject(context, input.objectKey);
    if (input.isDefault) {
      this.data.pipelines.forEach((pipeline) => {
        if (pipeline.workspaceId === context.workspaceId && pipeline.objectKey === input.objectKey) {
          pipeline.isDefault = false;
        }
      });
    }
    const pipeline: Pipeline = { ...input, id: createId("pipeline"), workspaceId: context.workspaceId };
    this.data.pipelines.push(pipeline);
    this.writeAuditLog(context, "create", "pipeline", pipeline.id, {
      objectKey: pipeline.objectKey,
      summary: `Created pipeline ${pipeline.name}`,
      details: { objectKey: pipeline.objectKey, isDefault: pipeline.isDefault, stages: pipeline.stages.map((stage) => stage.key) }
    });
    return clone(pipeline);
  }

  updatePipeline(
    context: RequestContext,
    id: string,
    patch: Partial<Omit<Pipeline, "id" | "workspaceId">>
  ): Pipeline {
    requirePermission(context, "crm.admin");
    const pipeline = this.data.pipelines.find((candidate) => candidate.id === id && candidate.workspaceId === context.workspaceId);
    if (!pipeline) {
      throw new Error("管道不存在");
    }
    const objectKey = patch.objectKey ?? pipeline.objectKey;
    this.assertObject(context, objectKey);
    const nextPipeline: Pipeline = { ...pipeline, ...patch, objectKey };
    this.assertPipelineChangeSafe(context, pipeline, nextPipeline);

    if (patch.isDefault) {
      this.data.pipelines.forEach((candidate) => {
        if (candidate.workspaceId === context.workspaceId && candidate.objectKey === objectKey) {
          candidate.isDefault = false;
        }
      });
    }

    Object.assign(pipeline, patch);
    this.writeAuditLog(context, "update", "pipeline", pipeline.id, {
      objectKey,
      summary: `Updated pipeline ${pipeline.name}`,
      details: { patch }
    });
    return clone(pipeline);
  }

  deletePipeline(context: RequestContext, id: string): void {
    requirePermission(context, "crm.admin");
    const pipeline = this.data.pipelines.find((candidate) => candidate.id === id && candidate.workspaceId === context.workspaceId);
    if (!pipeline) {
      throw new Error("管道不存在");
    }
    this.assertPipelineCanBeDeleted(context, pipeline);
    this.data.pipelines = this.data.pipelines.filter((candidate) => candidate.id !== id);
    this.writeAuditLog(context, "delete", "pipeline", id, {
      objectKey: pipeline.objectKey,
      summary: `Deleted pipeline ${pipeline.name}`,
      details: { name: pipeline.name }
    });
  }

  listActivities(context: RequestContext, recordId?: string): Activity[] {
    requirePermission(context, "crm.read");
    if (recordId) {
      const record = this.data.records.find((candidate) => candidate.id === recordId && candidate.workspaceId === context.workspaceId);
      if (record && !this.canAccessRecord(context, record)) {
        return [];
      }
    }
    return clone(
      this.data.activities
        .filter((activity) => activity.workspaceId === context.workspaceId && (!recordId || activity.recordId === recordId))
        .filter((activity) => {
          if (!activity.recordId) {
            return canManageAllRecords(context) || activity.actorId === context.user.id;
          }
          const record = this.data.records.find((candidate) => candidate.id === activity.recordId && candidate.workspaceId === context.workspaceId);
          return Boolean(record && this.canAccessRecord(context, record));
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    );
  }

  getActivity(context: RequestContext, activityId: string): Activity {
    requirePermission(context, "crm.read");
    const activity = this.listActivities(context).find((candidate) => candidate.id === activityId);
    if (!activity) {
      throw new Error("Activity not found");
    }
    return clone(activity);
  }

  createActivity(context: RequestContext, input: Omit<Activity, "id" | "workspaceId" | "createdAt" | "actorId">): Activity {
    requirePermission(context, "crm.write");
    if (input.recordId) {
      const record = this.data.records.find((candidate) => candidate.id === input.recordId && candidate.workspaceId === context.workspaceId);
      if (!record || !this.canAccessRecord(context, record)) {
        throw new Error("Record not found");
      }
    }
    const activity: Activity = {
      ...input,
      id: createId("activity"),
      workspaceId: context.workspaceId,
      actorId: context.user.id,
      createdAt: stamp()
    };
    this.data.activities.push(activity);
    this.writeAuditLog(context, "create", "activity", activity.id, {
      summary: `Created ${activity.type} activity ${activity.title}`,
      details: { recordId: activity.recordId, type: activity.type, title: activity.title }
    });
    this.deliverWebhookEvent(context, "activity.created", {
      activityId: activity.id,
      recordId: activity.recordId,
      type: activity.type,
      title: activity.title
    });
    return clone(activity);
  }

  updateActivity(
    context: RequestContext,
    activityId: string,
    patch: Partial<Pick<Activity, "title" | "body">> & { dueAt?: string | null; completedAt?: string | null; archivedAt?: string | null }
  ): Activity {
    requirePermission(context, "crm.write");
    const activity = this.data.activities.find((candidate) => candidate.id === activityId && candidate.workspaceId === context.workspaceId);
    if (!activity) {
      throw new Error("Activity not found");
    }
    if (activity.recordId) {
      const record = this.data.records.find((candidate) => candidate.id === activity.recordId && candidate.workspaceId === context.workspaceId);
      if (!record || !this.canAccessRecord(context, record)) {
        throw new Error("Activity not found");
      }
    } else if (!canManageAllRecords(context) && activity.actorId !== context.user.id) {
      throw new Error("Activity not found");
    }

    if (patch.title !== undefined) {
      activity.title = patch.title;
    }
    if (patch.body !== undefined) {
      activity.body = patch.body;
    }
    if (patch.dueAt !== undefined) {
      activity.dueAt = patch.dueAt ?? undefined;
    }
    if (patch.completedAt !== undefined) {
      activity.completedAt = patch.completedAt ?? undefined;
    }
    if (patch.archivedAt !== undefined) {
      activity.archivedAt = patch.archivedAt ?? undefined;
    }
    this.writeAuditLog(context, "update", "activity", activity.id, {
      summary: `Updated activity ${activity.title}`,
      details: { patch, recordId: activity.recordId, type: activity.type }
    });
    return clone(activity);
  }

  deleteActivity(context: RequestContext, activityId: string): void {
    requirePermission(context, "crm.write");
    const index = this.data.activities.findIndex((candidate) => candidate.id === activityId && candidate.workspaceId === context.workspaceId);
    if (index === -1) {
      throw new Error("Activity not found");
    }
    const activity = this.data.activities[index];
    if (activity.recordId) {
      const record = this.data.records.find((candidate) => candidate.id === activity.recordId && candidate.workspaceId === context.workspaceId);
      if (!record || !this.canAccessRecord(context, record)) {
        throw new Error("Activity not found");
      }
    } else if (!canManageAllRecords(context) && activity.actorId !== context.user.id) {
      throw new Error("Activity not found");
    }
    this.data.activities.splice(index, 1);
    this.writeAuditLog(context, "delete", "activity", activity.id, {
      summary: `Deleted activity ${activity.title}`,
      details: { recordId: activity.recordId, type: activity.type, title: activity.title }
    });
  }

  listSavedViews(context: RequestContext, objectKey?: string): SavedView[] {
    requirePermission(context, "crm.read");
    return clone(this.data.savedViews.filter((view) => view.workspaceId === context.workspaceId && (!objectKey || view.objectKey === objectKey)));
  }

  createSavedView(context: RequestContext, input: Omit<SavedView, "id" | "workspaceId">): SavedView {
    requirePermission(context, "crm.admin");
    this.assertObject(context, input.objectKey);
    this.assertSavedViewFields(context, input);
    if (input.isDefault) {
      this.data.savedViews.forEach((view) => {
        if (view.workspaceId === context.workspaceId && view.objectKey === input.objectKey) {
          view.isDefault = false;
        }
      });
    }

    const view: SavedView = {
      ...input,
      id: createId("view"),
      workspaceId: context.workspaceId
    };
    this.data.savedViews.push(view);
    this.writeAuditLog(context, "create", "saved_view", view.id, {
      objectKey: view.objectKey,
      summary: `Created saved view ${view.name}`,
      details: { columns: view.columns, filters: view.filters, sort: view.sort, isDefault: view.isDefault }
    });
    return clone(view);
  }

  updateSavedView(
    context: RequestContext,
    id: string,
    patch: Partial<Omit<SavedView, "id" | "workspaceId">>
  ): SavedView {
    requirePermission(context, "crm.admin");
    const view = this.data.savedViews.find((candidate) => candidate.id === id && candidate.workspaceId === context.workspaceId);
    if (!view) {
      throw new Error("视图不存在");
    }
    const objectKey = patch.objectKey ?? view.objectKey;
    this.assertObject(context, objectKey);
    this.assertSavedViewFields(context, { ...view, ...patch, objectKey });
    if (patch.isDefault) {
      this.data.savedViews.forEach((candidate) => {
        if (candidate.workspaceId === context.workspaceId && candidate.objectKey === objectKey) {
          candidate.isDefault = false;
        }
      });
    }

    Object.assign(view, patch);
    this.writeAuditLog(context, "update", "saved_view", view.id, {
      objectKey,
      summary: `Updated saved view ${view.name}`,
      details: { patch }
    });
    return clone(view);
  }

  deleteSavedView(context: RequestContext, id: string): void {
    requirePermission(context, "crm.admin");
    const view = this.data.savedViews.find((candidate) => candidate.id === id && candidate.workspaceId === context.workspaceId);
    if (!view) {
      throw new Error("视图不存在");
    }
    this.data.savedViews = this.data.savedViews.filter((candidate) => candidate.id !== id);
    this.writeAuditLog(context, "delete", "saved_view", id, {
      objectKey: view.objectKey,
      summary: `Deleted saved view ${view.name}`,
      details: { name: view.name }
    });
  }

  importCsv(
    context: RequestContext,
    objectKey: string,
    csv: string,
    strategy: CsvImportStrategy = "skip-invalid",
    mapping?: CsvImportMapping
  ): CsvImportResult {
    requirePermission(context, "crm.import");
    const preview = this.previewCsvImport(context, objectKey, csv, mapping);
    const created: CrmRecord[] = [];
    const updated: CrmRecord[] = [];
    const errors: string[] = [];
    const aborted = strategy === "all-or-nothing" && (preview.errorRows > 0 || preview.conflictRows > 0);

    if (!aborted) {
      preview.rows.forEach((row) => {
        if (row.status === "ready") {
          const data = coerceRow(row.values, this.listFieldDefinitions(context, objectKey));
          created.push(this.createRecord(context, objectKey, { title: row.title, data }));
          return;
        }

        if (row.status === "conflict" && strategy === "update-existing") {
          const existingRecordId = getSingleConflictRecordId(row.conflicts);
          if (existingRecordId) {
            const data = coerceRow(row.values, this.listFieldDefinitions(context, objectKey));
            updated.push(this.updateRecord(context, objectKey, existingRecordId, { title: row.title, data }));
            return;
          }
        }

        errors.push(...formatCsvImportRowIssues(row));
      });
    } else {
      errors.push(...preview.errors);
    }

    this.writeAuditLog(context, "import", "csv_import", undefined, {
      objectKey,
      summary: `Imported CSV into ${objectKey}: ${created.length} created, ${updated.length} updated, ${errors.length} failed${aborted ? " (aborted)" : ""}`,
      details: { totalRows: preview.totalRows, created: created.length, updated: updated.length, errors: errors.length, conflicts: preview.conflictRows, strategy, aborted }
    });

    return { created, updated, errors, strategy, aborted, preview };
  }

  listImportJobs(context: RequestContext, objectKey?: string): CsvImportJob[] {
    requirePermission(context, "crm.import");
    return clone(
      this.data.importJobs
        .filter((job) => job.workspaceId === context.workspaceId && (!objectKey || job.objectKey === objectKey))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 50)
    );
  }

  exportImportJobIssuesCsv(context: RequestContext, jobId: string): string {
    requirePermission(context, "crm.import");
    return buildCsvImportIssuesCsv(this.findImportJob(context, jobId));
  }

  listImportPresets(context: RequestContext, objectKey?: string): ImportPreset[] {
    requirePermission(context, "crm.import");
    return clone(
      this.data.importPresets
        .filter((preset) => preset.workspaceId === context.workspaceId && (!objectKey || preset.objectKey === objectKey))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    );
  }

  createImportPreset(
    context: RequestContext,
    input: { objectKey: string; name: string; strategy?: CsvImportStrategy; mapping?: CsvImportMapping }
  ): ImportPreset {
    requirePermission(context, "crm.import");
    this.assertObject(context, input.objectKey);
    const fields = this.listFieldDefinitions(context, input.objectKey);
    const mapping = normalizeCsvImportMapping(input.mapping);
    assertCsvImportMappingTargets(fields, mapping);
    const name = normalizeImportPresetName(input.name);
    const strategy = input.strategy ?? "skip-invalid";
    if (this.data.importPresets.some((preset) => preset.workspaceId === context.workspaceId && preset.objectKey === input.objectKey && preset.name === name)) {
      throw new Error(`Import preset ${name} already exists for ${input.objectKey}`);
    }

    const preset: ImportPreset = {
      id: createId("preset"),
      workspaceId: context.workspaceId,
      objectKey: input.objectKey,
      name,
      strategy,
      mapping,
      createdById: context.user.id,
      createdAt: stamp(),
      updatedAt: stamp()
    };
    this.data.importPresets.push(preset);
    this.writeAuditLog(context, "import", "import_preset", preset.id, {
      objectKey: preset.objectKey,
      summary: `Created import preset ${preset.name} for ${preset.objectKey}`,
      details: { strategy: preset.strategy, mapping: preset.mapping ?? {} }
    });
    return clone(preset);
  }

  updateImportPreset(
    context: RequestContext,
    id: string,
    patch: Partial<Pick<ImportPreset, "name" | "strategy" | "mapping">>
  ): ImportPreset {
    requirePermission(context, "crm.import");
    const preset = this.data.importPresets.find((candidate) => candidate.workspaceId === context.workspaceId && candidate.id === id);
    if (!preset) {
      throw new Error("Import preset not found");
    }
    const fields = this.listFieldDefinitions(context, preset.objectKey);
    const mapping = patch.mapping === undefined ? preset.mapping : normalizeCsvImportMapping(patch.mapping);
    assertCsvImportMappingTargets(fields, mapping);
    const nextName = patch.name === undefined ? preset.name : normalizeImportPresetName(patch.name);
    if (
      this.data.importPresets.some(
        (candidate) =>
          candidate.id !== preset.id &&
          candidate.workspaceId === context.workspaceId &&
          candidate.objectKey === preset.objectKey &&
          candidate.name === nextName
      )
    ) {
      throw new Error(`Import preset ${nextName} already exists for ${preset.objectKey}`);
    }

    Object.assign(preset, {
      name: nextName,
      strategy: patch.strategy ?? preset.strategy,
      mapping,
      updatedAt: stamp()
    });
    this.writeAuditLog(context, "import", "import_preset", preset.id, {
      objectKey: preset.objectKey,
      summary: `Updated import preset ${preset.name} for ${preset.objectKey}`,
      details: { strategy: preset.strategy, mapping: preset.mapping ?? {} }
    });
    return clone(preset);
  }

  deleteImportPreset(context: RequestContext, id: string): void {
    requirePermission(context, "crm.import");
    const preset = this.data.importPresets.find((candidate) => candidate.workspaceId === context.workspaceId && candidate.id === id);
    if (!preset) {
      throw new Error("Import preset not found");
    }
    this.data.importPresets = this.data.importPresets.filter((candidate) => candidate.id !== id);
    this.writeAuditLog(context, "delete", "import_preset", id, {
      objectKey: preset.objectKey,
      summary: `Deleted import preset ${preset.name} for ${preset.objectKey}`,
      details: { name: preset.name, strategy: preset.strategy }
    });
  }

  getImportJobQueueSummary(context: RequestContext): ImportJobQueueSummary {
    requirePermission(context, "crm.admin");
    const jobs = this.data.importJobs
      .filter((job) => job.workspaceId === context.workspaceId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const countStatus = (status: CsvImportJob["status"]) => jobs.filter((job) => job.status === status).length;
    const recentFailures = jobs
      .filter((job) => job.status === "failed")
      .sort((left, right) => (right.completedAt ?? right.createdAt).localeCompare(left.completedAt ?? left.createdAt))
      .slice(0, 5);

    return clone({
      total: jobs.length,
      queued: countStatus("queued"),
      processing: countStatus("processing"),
      completed: countStatus("completed"),
      failed: countStatus("failed"),
      cancelled: countStatus("cancelled"),
      deadLettered: this.data.auditLogs.filter(
        (log) =>
          log.workspaceId === context.workspaceId &&
          log.action === "import" &&
          log.entityType === "import_job" &&
          log.summary.toLowerCase().includes("dead letter")
      ).length,
      lastUpdatedAt: jobs[0]?.createdAt,
      recentJobs: jobs.slice(0, 10),
      recentFailures
    });
  }

  createCsvImportJob(
    context: RequestContext,
    input: { objectKey: string; csv: string; strategy?: CsvImportStrategy; mapping?: CsvImportMapping; presetId?: string; presetName?: string }
  ): CsvImportJob {
    const job = this.createQueuedCsvImportJob(context, input);
    return this.runCsvImportJob(context, job.id, input);
  }

  createQueuedCsvImportJob(
    context: RequestContext,
    input: { objectKey: string; csv: string; strategy?: CsvImportStrategy; mapping?: CsvImportMapping; presetId?: string; presetName?: string }
  ): CsvImportJob {
    requirePermission(context, "crm.import");
    const strategy = input.strategy ?? "skip-invalid";
    if (!this.data.objectDefinitions.some((object) => object.workspaceId === context.workspaceId && object.key === input.objectKey)) {
      throw new Error(`Object ${input.objectKey} not found`);
    }
    const mapping = normalizeCsvImportMapping(input.mapping);
    const job: StoredCsvImportJob = {
      id: createId("import"),
      workspaceId: context.workspaceId,
      objectKey: input.objectKey,
      status: "queued",
      strategy,
      totalRows: 0,
      createdCount: 0,
      errorCount: 0,
      aborted: false,
      sourcePayload: {
        objectKey: input.objectKey,
        csv: input.csv,
        strategy,
        ...(mapping ? { mapping } : {}),
        ...(input.presetId ? { presetId: input.presetId } : {}),
        ...(input.presetName ? { presetName: input.presetName } : {})
      },
      requestedById: context.user.id,
      createdAt: stamp()
    };
    this.data.importJobs.push(job);
    return clone(job);
  }

  cancelCsvImportJob(context: RequestContext, jobId: string): CsvImportJob {
    requirePermission(context, "crm.import");
    const job = this.findImportJob(context, jobId);
    if (job.status !== "queued") {
      throw new Error("Only queued import jobs can be cancelled");
    }

    Object.assign(job, {
      status: "cancelled" as const,
      completedAt: stamp()
    });
    this.writeAuditLog(context, "import", "import_job", job.id, {
      objectKey: job.objectKey,
      summary: `Cancelled CSV import job for ${job.objectKey}`,
      details: { previousStatus: "queued" }
    });
    return clone(job);
  }

  createRetryCsvImportJob(context: RequestContext, jobId: string): { job: CsvImportJob; payload: CsvImportJobSourcePayload } {
    return this.createCopiedImportJob(context, jobId, ["failed", "cancelled"]);
  }

  createRerunCsvImportJob(context: RequestContext, jobId: string): { job: CsvImportJob; payload: CsvImportJobSourcePayload } {
    return this.createCopiedImportJob(context, jobId, ["completed", "failed", "cancelled"]);
  }

  markCsvImportJobFailedFromWorker(workspaceId: string, jobId: string, objectKey: string, message: string): CsvImportJob | undefined {
    const job = this.data.importJobs.find((candidate) => candidate.id === jobId && candidate.workspaceId === workspaceId) as StoredCsvImportJob | undefined;
    if (!job || job.status === "completed" || job.status === "cancelled") {
      return undefined;
    }

    Object.assign(job, {
      status: "failed" as const,
      errorMessage: message,
      completedAt: stamp()
    });
    this.data.auditLogs.push({
      id: createId("audit"),
      workspaceId,
      action: "import",
      entityType: "import_job",
      entityId: jobId,
      objectKey,
      summary: `CSV import job moved to dead letter queue for ${objectKey}: ${message}`,
      details: { error: message, source: "worker" },
      createdAt: stamp()
    });
    return clone(job);
  }

  runCsvImportJob(
    context: RequestContext,
    jobId: string,
    input: { objectKey: string; csv: string; strategy?: CsvImportStrategy; mapping?: CsvImportMapping; presetId?: string; presetName?: string }
  ): CsvImportJob {
    requirePermission(context, "crm.import");
    const strategy = input.strategy ?? "skip-invalid";
    const job = this.findImportJob(context, jobId);
    if (job.status === "cancelled") {
      return clone(job);
    }
    if (job.status !== "queued") {
      throw new Error("Only queued import jobs can be processed");
    }

    Object.assign(job, {
      status: "processing" as const,
      startedAt: stamp()
    });

    try {
      const result = this.importCsv(context, input.objectKey, input.csv, strategy, input.mapping);
      Object.assign(job, {
        status: "completed" as const,
        totalRows: result.preview.totalRows,
        createdCount: result.created.length,
        errorCount: result.errors.length,
        aborted: result.aborted,
        preview: result.preview,
        result,
        completedAt: stamp()
      });
      this.writeAuditLog(context, "import", "import_job", job.id, {
        objectKey: input.objectKey,
        summary: `Completed CSV import job for ${input.objectKey}: ${result.created.length} created, ${result.errors.length} failed`,
        details: { strategy, totalRows: result.preview.totalRows, created: result.created.length, errors: result.errors.length, aborted: result.aborted }
      });
      this.deliverWebhookEvent(context, "import.completed", {
        jobId: job.id,
        objectKey: job.objectKey,
        totalRows: job.totalRows,
        createdCount: job.createdCount,
        errorCount: job.errorCount,
        aborted: job.aborted,
        strategy: job.strategy
      });
    } catch (error) {
      Object.assign(job, {
        status: "failed" as const,
        errorMessage: error instanceof Error ? error.message : "Import job failed",
        completedAt: stamp()
      });
      this.writeAuditLog(context, "import", "import_job", job.id, {
        objectKey: input.objectKey,
        summary: `Failed CSV import job for ${input.objectKey}: ${job.errorMessage}`,
        details: { strategy, error: job.errorMessage }
      });
      this.deliverWebhookEvent(context, "import.failed", {
        jobId: job.id,
        objectKey: job.objectKey,
        errorMessage: job.errorMessage,
        strategy: job.strategy
      });
    }

    return clone(job);
  }

  private recordStoreWebhookDelivery(
    context: RequestContext,
    webhook: StoredWebhookEndpoint,
    event: WebhookEvent,
    data: Record<string, unknown>,
    attempts = 1
  ): WebhookDelivery {
    const now = stamp();
    const requestBody = {
      id: `evt_${Date.now()}`,
      event,
      createdAt: now,
      data
    };
    const delivery: WebhookDelivery = {
      id: createId("webhook_delivery"),
      workspaceId: context.workspaceId,
      webhookId: webhook.id,
      event,
      status: "success",
      attempts,
      requestBody,
      responseStatus: 200,
      responseBody: "store delivery",
      createdAt: now,
      deliveredAt: now
    };
    (this.data.webhookDeliveries ??= []).push(delivery);
    webhook.lastDeliveredAt = now;
    webhook.updatedAt = now;
    this.writeAuditLog(context, "create", "webhook_delivery", delivery.id, {
      summary: `Delivered webhook ${webhook.name}: success`,
      details: { webhookId: webhook.id, event: delivery.event, status: delivery.status, responseStatus: delivery.responseStatus }
    });
    return clone(delivery);
  }

  private findImportJob(context: RequestContext, jobId: string): StoredCsvImportJob {
    const job = this.data.importJobs.find((candidate) => candidate.id === jobId && candidate.workspaceId === context.workspaceId) as StoredCsvImportJob | undefined;
    if (!job) {
      throw new Error("Import job not found");
    }
    return job;
  }

  private createCopiedImportJob(
    context: RequestContext,
    jobId: string,
    allowedStatuses: Array<"completed" | "failed" | "cancelled">
  ): { job: CsvImportJob; payload: CsvImportJobSourcePayload } {
    requirePermission(context, "crm.import");
    const source = this.findImportJob(context, jobId);
    if (!allowedStatuses.includes(source.status as "completed" | "failed" | "cancelled")) {
      throw new Error(`Import job with status ${source.status} cannot be copied`);
    }
    if (!source.sourcePayload?.csv.trim()) {
      throw new Error("Import job cannot be retried because its source CSV is missing");
    }

    const payload = source.sourcePayload;
    const job = this.createQueuedCsvImportJob(context, payload);
    this.writeAuditLog(context, "import", "import_job", job.id, {
      objectKey: payload.objectKey,
      summary: `Created CSV import job from ${source.id}`,
      details: { sourceJobId: source.id, sourceStatus: source.status, strategy: payload.strategy }
    });
    return { job, payload };
  }

  private importCsvLegacy(context: RequestContext, objectKey: string, csv: string): { created: CrmRecord[]; errors: string[] } {
    const rows = parseCsv(csv);
    const created: CrmRecord[] = [];
    const errors: string[] = [];

    rows.forEach((row, index) => {
      try {
        const title = String(row.title ?? row.name ?? "").trim();
        if (!title) {
          throw new Error("缺少 title/name 列");
        }
        const data = coerceRow(row, this.listFieldDefinitions(context, objectKey));
        created.push(this.createRecord(context, objectKey, { title, data }));
      } catch (error) {
        errors.push(`第 ${index + 2} 行: ${error instanceof Error ? error.message : "导入失败"}`);
      }
    });

    return { created, errors };
  }

  previewCsvImport(context: RequestContext, objectKey: string, csv: string, mapping?: CsvImportMapping): CsvImportPreview {
    requirePermission(context, "crm.import");
    this.assertObject(context, objectKey);
    const rows = parseCsv(csv);
    const headers = splitCsvLine(csv.trim().split(/\r?\n/)[0] ?? "");
    const normalizedMapping = normalizeCsvImportMapping(mapping);
    const fields = this.listFieldDefinitions(context, objectKey);
    assertCsvImportMappingTargets(fields, normalizedMapping);
    const existing = this.listRecordsForValidation(context, objectKey);
    const errors: string[] = [];
    const previewRows: CsvImportPreview["rows"] = [];
    const draftRecords: CrmRecord[] = [];
    const conflicts: CsvImportConflict[] = [];
    let creatableRows = 0;

    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const rowErrors: string[] = [];
      const rowConflicts: CsvImportConflict[] = [];
      let title = "";

      try {
        const mappedRow = applyCsvImportMapping(row, normalizedMapping);
        title = String(mappedRow.title ?? mappedRow.name ?? "").trim();
        if (!title) {
          throw new Error("Missing title or name column");
        }
        const data = coerceRow(mappedRow, fields);
        rowConflicts.push(...findCsvImportConflicts(rowNumber, fields, data, existing));
        validateRecordPayload(fields, data, draftRecords);
        this.assertRecordReferences(context, fields, data, true);
        if (rowConflicts.length === 0) {
          draftRecords.push({
            id: `csv-row-${rowNumber}`,
            workspaceId: context.workspaceId,
            objectKey,
            title,
            ownerId: context.user.id,
            data,
            createdAt: stamp(),
            updatedAt: stamp()
          });
          creatableRows += 1;
        }
      } catch (error) {
        rowErrors.push(error instanceof Error ? error.message : "Import failed");
      }

      errors.push(...rowErrors.map((item) => `Row ${rowNumber}: ${item}`));
      errors.push(...rowConflicts.map((conflict) => formatCsvImportConflict(conflict)));
      conflicts.push(...rowConflicts);
      previewRows.push({
        rowNumber,
        title,
        status: rowErrors.length > 0 ? "error" : rowConflicts.length > 0 ? "conflict" : "ready",
        errors: rowErrors,
        conflicts: rowConflicts,
        values: applyCsvImportMapping(row, normalizedMapping)
      });
    });

    return {
      headers,
      totalRows: rows.length,
      creatableRows,
      errorRows: previewRows.filter((row) => row.status === "error").length,
      conflictRows: previewRows.filter((row) => row.status === "conflict").length,
      errors,
      conflicts,
      mappedFields: fields
        .filter((field) => headers.includes(field.key) || Object.values(normalizedMapping ?? {}).includes(field.key))
        .map((field) => ({ key: field.key, label: field.label, type: field.type })),
      unmappedHeaders: headers.filter(
        (header) =>
          !isIgnoredCsvImportHeader(header) &&
          !normalizedMapping?.[header] &&
          !fields.some((field) => field.key === header)
      ),
      rows: previewRows
    };
  }

  private assertObjectCanBeDeleted(context: RequestContext, object: ObjectDefinition): void {
    const recordCount = this.listRecordsForValidation(context, object.key).length;
    if (recordCount > 0) {
      throw new Error(`${object.key} cannot be deleted because it still has ${recordCount} records`);
    }

    const inboundField = this.data.fieldDefinitions.find(
      (field) =>
        field.workspaceId === context.workspaceId &&
        field.objectKey !== object.key &&
        field.type === "reference" &&
        field.options?.some((option) => option.value === object.key)
    );
    if (inboundField) {
      throw new Error(`${object.key} cannot be deleted because field ${inboundField.objectKey}.${inboundField.key} still references it`);
    }

    const relation = this.data.relationDefinitions.find(
      (candidate) => candidate.workspaceId === context.workspaceId && (candidate.fromObjectKey === object.key || candidate.toObjectKey === object.key)
    );
    if (relation) {
      throw new Error(`${object.key} cannot be deleted because relation ${relation.key} still uses it`);
    }
  }

  private listRecordsForValidation(context: RequestContext, objectKey: string): CrmRecord[] {
    return clone(this.data.records.filter((record) => record.workspaceId === context.workspaceId && record.objectKey === objectKey));
  }

  private assertRelationCanBeDeleted(context: RequestContext, relation: RelationDefinition): void {
    const referenceFields = this.data.fieldDefinitions.filter(
      (field) =>
        field.workspaceId === context.workspaceId &&
        field.type === "reference" &&
        ((field.objectKey === relation.fromObjectKey && field.options?.some((option) => option.value === relation.toObjectKey)) ||
          (field.objectKey === relation.toObjectKey && field.options?.some((option) => option.value === relation.fromObjectKey)))
    );

    for (const field of referenceFields) {
      const recordUsingRelation = this.listRecordsForValidation(context, field.objectKey).find((record) => !isBlankValue(record.data[field.key]));
      if (recordUsingRelation) {
        throw new Error(`${relation.key} cannot be deleted because record ${recordUsingRelation.id} still uses field ${field.objectKey}.${field.key}`);
      }
    }
  }

  private assertPipelineCanBeDeleted(context: RequestContext, pipeline: Pipeline): void {
    const recordUsingPipeline = this.listRecordsForValidation(context, pipeline.objectKey).find((record) => !isBlankValue(record.stageKey));
    if (recordUsingPipeline) {
      throw new Error(`${pipeline.name} cannot be deleted because record ${recordUsingPipeline.id} still uses a pipeline stage`);
    }
  }

  private assertPipelineChangeSafe(context: RequestContext, current: Pipeline, next: Pipeline): void {
    const currentStageKeys = new Set(current.stages.map((stage) => stage.key));
    const nextStageKeys = new Set((next.stages ?? current.stages).map((stage) => stage.key));
    const removedStageKeys = [...currentStageKeys].filter((stageKey) => !nextStageKeys.has(stageKey));

    if (next.objectKey !== current.objectKey) {
      const recordUsingPipeline = this.listRecordsForValidation(context, current.objectKey).find((record) => !isBlankValue(record.stageKey));
      if (recordUsingPipeline) {
        throw new Error(`${current.name} cannot change object because record ${recordUsingPipeline.id} still uses a pipeline stage`);
      }
    }

    if (removedStageKeys.length > 0) {
      const recordUsingRemovedStage = this.listRecordsForValidation(context, current.objectKey).find(
        (record) => typeof record.stageKey === "string" && removedStageKeys.includes(record.stageKey)
      );
      if (recordUsingRemovedStage) {
        throw new Error(`${current.name} cannot remove stage ${recordUsingRemovedStage.stageKey} because record ${recordUsingRemovedStage.id} still uses it`);
      }
    }
  }

  private assertFieldReferenceTarget(context: RequestContext, field: Pick<FieldDefinition, "type" | "options" | "label">): void {
    if (field.type !== "reference") {
      return;
    }

    const targetObjectKey = field.options?.[0]?.value;
    if (!targetObjectKey) {
      throw new Error(`${field.label} must configure a referenced object`);
    }
    this.assertObject(context, targetObjectKey);
  }

  private assertFieldCompatibleWithRecords(context: RequestContext, field: FieldDefinition): void {
    const records = this.listRecordsForValidation(context, field.objectKey);
    const values = records.map((record) => record.data[field.key]).filter((value) => !isBlankValue(value));

    if (field.required && values.length < records.length) {
      throw new Error(`${field.label} cannot be required because existing records have empty values`);
    }

    if (field.unique) {
      const seen = new Map<string, string>();
      for (const record of records) {
        const value = record.data[field.key];
        if (isBlankValue(value)) {
          continue;
        }

        const normalized = normalizeGovernedValue(value);
        const duplicateRecordId = seen.get(normalized);
        if (duplicateRecordId) {
          throw new Error(`${field.label} cannot be unique because records ${duplicateRecordId} and ${record.id} already share a value`);
        }
        seen.set(normalized, record.id);
      }
    }

    if (field.type === "select") {
      const allowed = new Set((field.options ?? []).map((option) => option.value));
      const invalidRecord = records.find((record) => {
        const value = record.data[field.key];
        return !isBlankValue(value) && (typeof value !== "string" || !allowed.has(value));
      });
      if (invalidRecord) {
        throw new Error(`${field.label} options would invalidate existing record ${invalidRecord.id}`);
      }
    }

    if (field.type === "reference" || field.type === "user") {
      for (const record of records) {
        this.assertRecordReferences(context, [field], record.data, false);
      }
    }
  }

  private assertFieldCanBeDeleted(context: RequestContext, field: FieldDefinition): void {
    const recordUsingField = this.listRecordsForValidation(context, field.objectKey).find((record) => !isBlankValue(record.data[field.key]));
    if (recordUsingField) {
      throw new Error(`${field.label} cannot be deleted because record ${recordUsingField.id} still has data`);
    }

    const viewUsingField = this.data.savedViews.find(
      (view) =>
        view.workspaceId === context.workspaceId &&
        view.objectKey === field.objectKey &&
        (view.columns.includes(field.key) || view.sort?.field === field.key || view.filters?.some((filter) => filter.field === field.key))
    );
    if (viewUsingField) {
      throw new Error(`${field.label} cannot be deleted because saved view ${viewUsingField.name} still uses it`);
    }
  }

  private assertRecordReferences(context: RequestContext, fields: FieldDefinition[], data: Record<string, unknown>, requireVisibleRecord: boolean): void {
    for (const field of fields) {
      const value = data[field.key];
      if (isBlankValue(value)) {
        continue;
      }

      if (field.type === "user") {
        const exists = this.data.users.some((user) => user.workspaceId === context.workspaceId && user.id === value);
        if (!exists) {
          throw new Error(`${field.label} references a missing user`);
        }
      }

      if (field.type === "reference") {
        const targetObjectKey = field.options?.[0]?.value;
        if (!targetObjectKey || typeof value !== "string") {
          throw new Error(`${field.label} references an invalid record`);
        }

        const targetRecord = this.data.records.find(
          (record) => record.workspaceId === context.workspaceId && record.objectKey === targetObjectKey && record.id === value
        );
        if (!targetRecord || (requireVisibleRecord && !this.canAccessRecord(context, targetRecord))) {
          throw new Error(`${field.label} references a missing record`);
        }
      }
    }
  }

  private assertObject(context: RequestContext, objectKey: string): void {
    const exists = this.data.objectDefinitions.some((object) => object.workspaceId === context.workspaceId && object.key === objectKey);
    if (!exists) {
      throw new Error(`对象不存在: ${objectKey}`);
    }
  }

  private assertSavedViewFields(context: RequestContext, view: Pick<SavedView, "objectKey" | "columns" | "filters" | "sort">): void {
    const fieldKeys = new Set(this.listFieldDefinitions(context, view.objectKey).map((field) => field.key));
    const columnKeys = new Set(["title", "ownerId", "stageKey", ...fieldKeys]);
    const queryKeys = new Set(["title", "ownerId", "stageKey", "createdAt", "updatedAt", ...fieldKeys]);

    for (const column of view.columns) {
      if (!columnKeys.has(column)) {
        throw new ApiError(400, "VALIDATION_ERROR", `Saved view references unknown column ${column}`);
      }
    }

    for (const filter of view.filters ?? []) {
      if (!queryKeys.has(filter.field)) {
        throw new ApiError(400, "VALIDATION_ERROR", `Saved view references unknown filter field ${filter.field}`);
      }
    }

    if (view.sort?.field && !queryKeys.has(view.sort.field)) {
      throw new ApiError(400, "VALIDATION_ERROR", `Saved view references unknown sort field ${view.sort.field}`);
    }
  }

  private assertRoleNameAvailable(context: RequestContext, name: string, currentRoleId?: string): void {
    const duplicate = this.data.roles.some(
      (role) => role.workspaceId === context.workspaceId && role.name === name && role.id !== currentRoleId
    );
    if (duplicate) {
      throw new Error("Role name already exists");
    }
  }

  private assertTeamNameAvailable(context: RequestContext, name: string, currentTeamId?: string): void {
    const duplicate = this.data.teams.some(
      (team) => team.workspaceId === context.workspaceId && team.name === name && team.id !== currentTeamId
    );
    if (duplicate) {
      throw new Error("Team name already exists");
    }
  }

  private assertWorkspaceKeepsAdminUser(context: RequestContext, demotedRoleId: string): void {
    const hasOtherAdminUser = this.data.users.some((user) => {
      if (user.workspaceId !== context.workspaceId || user.roleId === demotedRoleId) {
        return false;
      }
      const role = this.data.roles.find((candidate) => candidate.id === user.roleId && candidate.workspaceId === context.workspaceId);
      return Boolean(role?.permissions.includes("crm.admin"));
    });
    if (!hasOtherAdminUser) {
      throw new Error("At least one user must keep crm.admin permission");
    }
  }

  private assertWorkspaceKeepsAdminUserAfterUserRoleChange(context: RequestContext, changedUserId: string): void {
    const hasOtherAdminUser = this.data.users.some((user) => {
      if (user.workspaceId !== context.workspaceId || user.id === changedUserId) {
        return false;
      }
      const role = this.data.roles.find((candidate) => candidate.id === user.roleId && candidate.workspaceId === context.workspaceId);
      return Boolean(role?.permissions.includes("crm.admin"));
    });
    if (!hasOtherAdminUser) {
      throw new Error("At least one user must keep crm.admin permission");
    }
  }

  private normalizeUserInput(
    context: RequestContext,
    input: Pick<User, "email" | "name" | "roleId"> & Pick<Partial<User>, "teamId">
  ): Pick<User, "email" | "name" | "roleId"> & Pick<Partial<User>, "teamId"> {
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();
    const roleId = input.roleId.trim();
    const teamId = input.teamId?.trim() || undefined;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("User email must be valid");
    }
    if (!name) {
      throw new Error("User name is required");
    }

    const role = this.data.roles.some((candidate) => candidate.id === roleId && candidate.workspaceId === context.workspaceId);
    if (!role) {
      throw new Error("Role not found");
    }
    if (teamId) {
      const team = this.data.teams.some((candidate) => candidate.id === teamId && candidate.workspaceId === context.workspaceId);
      if (!team) {
        throw new Error("Team not found");
      }
    }

    return { email, name, roleId, teamId };
  }

  private canAccessRecord(context: RequestContext, record: CrmRecord): boolean {
    const owner = record.ownerId ? this.data.users.find((user) => user.id === record.ownerId && user.workspaceId === context.workspaceId) : undefined;
    return canAccessRecordOwner(context, record.ownerId, owner?.teamId);
  }

  private ensureEmailAiSettings(workspaceId: string): EmailAiSettings {
    const settings = (this.data.emailAiSettings ??= []).find((candidate) => candidate.workspaceId === workspaceId);
    if (settings) {
      settings.agents = normalizeAiAgentSettings(settings.agents);
      settings.features = normalizeEmailAiFeatures(settings.features);
      settings.providerConfig = normalizeAiProviderConfig(settings.providerConfig);
      return settings;
    }
    const created = createDefaultEmailAiSettings(workspaceId, stamp());
    this.data.emailAiSettings.push(created);
    return created;
  }

  private ensureEmailSyncSettings(workspaceId: string): EmailSyncSettings {
    const settings = (this.data.emailSyncSettings ??= []).find((candidate) => candidate.workspaceId === workspaceId);
    if (settings) {
      settings.mode = settings.mode === "daily" ? "daily" : "interval";
      settings.intervalMinutes = normalizeIntegerLimit(settings.intervalMinutes, 1, 1440);
      settings.dailyAt = normalizeDailyTime(settings.dailyAt);
      settings.limit = normalizeIntegerLimit(settings.limit, 1, 100);
      return settings;
    }
    const created: EmailSyncSettings = {
      workspaceId,
      enabled: true,
      mode: "interval",
      intervalMinutes: 5,
      dailyAt: "03:00",
      limit: 25,
      updatedAt: stamp()
    };
    this.data.emailSyncSettings.push(created);
    return created;
  }

  private ensureDefaultEmailSignatures(context: RequestContext): void {
    const signatures = (this.data.emailSignatures ??= []);
    if (signatures.some((signature) => signature.workspaceId === context.workspaceId)) {
      return;
    }
    const now = stamp();
    signatures.push(
      {
        id: `email_signature_default_${context.workspaceId}`,
        workspaceId: context.workspaceId,
        name: "默认签名",
        bodyText: "Best regards,\n{{senderEmail}}",
        bodyHtml: "<p>Best regards,<br>{{senderEmail}}</p>",
        isDefault: true,
        active: true,
        createdById: context.user.id,
        createdAt: now,
        updatedAt: now
      },
      {
        id: `email_signature_cn_sales_${context.workspaceId}`,
        workspaceId: context.workspaceId,
        name: "中文商务签名",
        bodyText: "谢谢，\n{{senderEmail}}",
        bodyHtml: "<p>谢谢，<br>{{senderEmail}}</p>",
        isDefault: false,
        active: true,
        createdById: context.user.id,
        createdAt: now,
        updatedAt: now
      }
    );
  }

  private clearDefaultEmailSignatures(workspaceId: string, accountId: string | null, exceptSignatureId?: string): void {
    for (const signature of this.data.emailSignatures ?? []) {
      if (
        signature.workspaceId === workspaceId &&
        (signature.accountId ?? null) === accountId &&
        signature.isDefault &&
        signature.id !== exceptSignatureId
      ) {
        signature.isDefault = false;
        signature.updatedAt = stamp();
      }
    }
  }

  private normalizeEmailSignatureAccountId(context: RequestContext, accountId?: string | null): string | null {
    const normalized = accountId?.trim();
    if (!normalized) {
      return null;
    }
    this.assertEmailAccount(context, normalized);
    return normalized;
  }

  private assertEmailSignature(context: RequestContext, signatureId: string): EmailSignature {
    const signature = (this.data.emailSignatures ?? []).find((candidate) => candidate.id === signatureId && candidate.workspaceId === context.workspaceId);
    if (!signature) {
      throw new Error("Email signature not found");
    }
    return signature;
  }

  private assertEmailAccount(context: RequestContext, accountId: string): EmailAccount {
    const account = (this.data.emailAccounts ?? []).find((candidate) => candidate.id === accountId && candidate.workspaceId === context.workspaceId);
    if (!account) {
      throw new Error("Email account not found");
    }
    return account;
  }

  private assertEmailAccountEmailAvailable(context: RequestContext, emailAddress: string, exceptAccountId?: string): void {
    const existing = (this.data.emailAccounts ?? []).find(
      (account) =>
        account.workspaceId === context.workspaceId &&
        account.id !== exceptAccountId &&
        account.emailAddress.toLowerCase() === emailAddress.toLowerCase()
    );
    if (existing) {
      throw new Error("Email account address already exists");
    }
  }

  private assertEmailThread(context: RequestContext, threadId: string): EmailThread {
    const thread = (this.data.emailThreads ?? []).find((candidate) => candidate.id === threadId && candidate.workspaceId === context.workspaceId);
    if (!thread || !this.canAccessEmailThread(context, thread)) {
      throw new Error("Email thread not found");
    }
    return thread;
  }

  private assertTalkTargetAccess(context: RequestContext, target: TalkMessageTargetInput): void {
    if (target.type === "record") {
      this.getRecord(context, target.objectKey, target.recordId);
      return;
    }
    this.assertEmailThread(context, target.threadId);
  }

  private mergeEmailThreadState(context: RequestContext, thread: EmailThread): EmailThread {
    const state = (this.data.emailThreadStates ?? []).find(
      (candidate) => candidate.workspaceId === context.workspaceId && candidate.threadId === thread.id && candidate.userId === context.user.id
    );
    return {
      ...thread,
      archived: state?.archived ?? false,
      category: normalizeEmailThreadCategory(state?.category),
      deleted: state?.deleted ?? false,
      important: state?.important ?? false,
      labels: normalizeEmailThreadLabels(state?.labels),
      read: state?.read ?? false,
      snoozedUntil: state?.snoozedUntil,
      starred: state?.starred ?? false
    };
  }

  private canAccessEmailThread(context: RequestContext, thread: EmailThread): boolean {
    if (canManageAllRecords(context)) {
      return true;
    }
    if (thread.recordId) {
      const record = this.data.records.find((candidate) => candidate.id === thread.recordId && candidate.workspaceId === context.workspaceId);
      return Boolean(record && this.canAccessRecord(context, record));
    }
    return (this.data.emailMessages ?? []).some(
      (message) => message.workspaceId === context.workspaceId && message.threadId === thread.id && message.createdById === context.user.id
    );
  }

  private assertVisibleRecordById(context: RequestContext, recordId: string): CrmRecord {
    const record = this.data.records.find((candidate) => candidate.id === recordId && candidate.workspaceId === context.workspaceId);
    if (!record || !this.canAccessRecord(context, record)) {
      throw new Error("记录不存在");
    }
    return record;
  }

  private assertVisibleEmailAiSources(context: RequestContext, sources: unknown): NonNullable<EmailThread["aiAnalysisSources"]> {
    const normalizedSources = normalizeEmailAiSources(sources);
    for (const source of normalizedSources) {
      if (source.recordId) {
        this.assertVisibleRecordById(context, source.recordId);
      }
      if (source.messageId) {
        this.getEmailMessage(context, source.messageId);
      }
      if (source.activityId && !this.listActivities(context).some((activity) => activity.id === source.activityId)) {
        throw new Error("Activity not found");
      }
      if (
        source.knowledgeArticleId &&
        !(this.data.knowledgeArticles ?? []).some((article) => article.id === source.knowledgeArticleId && article.workspaceId === context.workspaceId)
      ) {
        throw new Error("Knowledge article not found");
      }
    }
    return normalizedSources;
  }

  private findMatchingEmailThread(context: RequestContext, accountId: string, accountEmail: string, subject: string, participants: string[], recordId?: string): EmailThread | undefined {
    const normalizedSubject = normalizeEmailSubject(subject);
    if (!normalizedSubject) {
      return undefined;
    }
    const accountAddress = normalizeEmailAddress(accountEmail);
    const participantSet = new Set(participants.map(normalizeEmailAddress).filter((email) => email !== accountAddress));
    return (this.data.emailThreads ?? [])
      .filter((thread) => thread.workspaceId === context.workspaceId && thread.accountId === accountId && (!recordId || !thread.recordId || thread.recordId === recordId))
      .sort((left, right) => (emailThreadTime(right).localeCompare(emailThreadTime(left))))
      .find((thread) => {
        if (normalizeEmailSubject(thread.subject) !== normalizedSubject) {
          return false;
        }
        if (recordId && thread.recordId === recordId) {
          return true;
        }
        return thread.participantEmails.some((email) => {
          const normalized = normalizeEmailAddress(email);
          return normalized !== accountAddress && participantSet.has(normalized);
        });
      });
  }

  private findRecordIdByEmailParticipants(context: RequestContext, accountEmail: string, participants: string[]): string | undefined {
    const accountAddress = normalizeEmailAddress(accountEmail);
    const emails = Array.from(new Set(participants.map((participant) => normalizeEmailAddress(participant)).filter((email) => email !== accountAddress)));
    return this.data.records
      .filter((record) => record.workspaceId === context.workspaceId && record.objectKey === "contacts" && this.canAccessRecord(context, record))
      .find((record) => emails.some((email) => recordDataHasEmail(record.data, email)))?.id;
  }

  private createEmailThreadForMessage(
    context: RequestContext,
    accountId: string,
    input: Pick<EmailMessage, "from" | "to" | "subject"> & { recordId?: string },
    now: string
  ): EmailThread {
    const thread: EmailThread = {
      id: createId("email_thread"),
      workspaceId: context.workspaceId,
      accountId,
      subject: normalizeRequiredText(input.subject, "Email subject"),
      participantEmails: Array.from(new Set([input.from, ...input.to].map(normalizeEmailAddress))),
      recordId: input.recordId,
      createdAt: now,
      updatedAt: now
    };
    (this.data.emailThreads ??= []).push(thread);
    return thread;
  }

  private updateEmailThreadFromMessage(thread: EmailThread, message: EmailMessage, recordId?: string): void {
    const settings = this.ensureEmailAiSettings(thread.workspaceId);
    thread.subject = thread.subject || message.subject;
    thread.participantEmails = Array.from(new Set([...thread.participantEmails, message.from, ...message.to, ...(message.cc ?? [])].map(normalizeEmailAddress)));
    thread.recordId = recordId ?? thread.recordId;
    thread.lastMessageAt = emailMessageTime(message);
    thread.updatedAt = stamp();
    if (!settings.features.auto_summarize) {
      thread.summary = summarizeEmailThread((this.data.emailMessages ?? []).filter((candidate) => candidate.threadId === thread.id));
      thread.summaryUpdatedAt = stamp();
    } else if (!thread.summaryUpdatedAt) {
      thread.summary = summarizeEmailThread((this.data.emailMessages ?? []).filter((candidate) => candidate.threadId === thread.id));
    }
  }

  private triggerEmailAutomations(context: RequestContext, message: EmailMessage): void {
    const settings = this.ensureEmailAiSettings(context.workspaceId);
    scheduleEmailAutomationsBestEffort(
      context,
      this,
      {
        runEmailTranslateJob: (automationContext, payload) => translateEmailMessage(automationContext, this, payload),
        runEmailAnalyzeJob: (automationContext, payload) => analyzeEmailThreadWithAi(automationContext, this, payload),
        runEmailSummarizeJob: (automationContext, payload) => summarizeEmailThreadWithAi(automationContext, this, payload)
      },
      message,
      settings
    );
  }

  private writeAuditLog(
    context: RequestContext,
    action: AuditAction,
    entityType: string,
    entityId: string | undefined,
    input: Pick<AuditLog, "summary"> & Pick<Partial<AuditLog>, "objectKey" | "details">
  ): void {
    this.data.auditLogs.push({
      id: createId("audit"),
      workspaceId: context.workspaceId,
      actorId: context.user.id,
      action,
      entityType,
      entityId,
      objectKey: input.objectKey,
      summary: input.summary,
      details: input.details,
      createdAt: stamp()
    });
  }
}

export function getCrmStore(): CrmStore {
  const globalStore = globalThis as GlobalStore;
  globalStore.__crmStore ??= new CrmStore();
  return globalStore.__crmStore;
}

function parseCsv(csv: string): Array<Record<string, string>> {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    throw new Error("CSV 至少需要表头和一行数据");
  }

  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return headers.reduce<Record<string, string>>((row, header, index) => {
      row[header] = values[index] ?? "";
      return row;
    }, {});
  });
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function normalizeRequiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function talkMessageMatchesTarget(message: TalkMessage, target: TalkMessageTargetInput): boolean {
  return target.type === "record"
    ? message.targetType === "record" && message.objectKey === target.objectKey && message.recordId === target.recordId
    : message.targetType === "email_thread" && message.threadId === target.threadId;
}

function normalizeTalkSources(sources: TalkMessage["sources"] = []): TalkMessage["sources"] {
  return sources
    .map((source) => ({
      label: source.label.trim().slice(0, 200),
      objectKey: source.objectKey?.trim() || undefined,
      recordId: source.recordId?.trim() || undefined,
      messageId: source.messageId?.trim() || undefined,
      knowledgeArticleId: source.knowledgeArticleId?.trim() || undefined
    }))
    .filter((source) => source.label);
}

function normalizeEmailAddress(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Email address must be valid");
  }
  return email;
}

function recordDataHasEmail(data: unknown, emailAddress: string): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return false;
  }
  const normalizedEmail = normalizeEmailAddress(emailAddress);
  const record = data as Record<string, unknown>;
  const contactMethods = Array.isArray(record.contactMethods) ? record.contactMethods : [];
  const methodEmails = contactMethods.flatMap((method) => {
    if (!method || typeof method !== "object" || Array.isArray(method)) {
      return [];
    }
    const methodRecord = method as Record<string, unknown>;
    return typeof methodRecord.value === "string" && (methodRecord.type === "email" || methodRecord.value.includes("@")) ? [methodRecord.value] : [];
  });
  const fieldEmails = Object.entries(record).flatMap(([key, value]) => {
    if (typeof value !== "string") {
      return [];
    }
    if (!key.toLowerCase().includes("email") && !value.includes("@")) {
      return [];
    }
    return [value];
  });
  return [...methodEmails, ...fieldEmails].some((value) =>
    value
      .split(/[,\s;]+/)
      .map((candidate) => {
        try {
          return normalizeEmailAddress(candidate);
        } catch {
          return "";
        }
      })
      .includes(normalizedEmail)
  );
}

function normalizeEmailSubject(value: string): string {
  return value
    .trim()
    .replace(/^(\s*(re|fw|fwd)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeIntegerLimit(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizeDailyTime(value: string): string {
  const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? `${match[1]}:${match[2]}` : "03:00";
}

function emailMessageTime(message: EmailMessage): string {
  return message.receivedAt ?? message.sentAt ?? message.createdAt;
}

function emailThreadTime(thread: EmailThread): string {
  return thread.lastMessageAt ?? thread.updatedAt;
}

const DEFAULT_EMAIL_SEND_CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
const MIN_EMAIL_SEND_CLAIM_TIMEOUT_MS = 60 * 1000;

function emailSendClaimStaleBefore(now = new Date()): Date {
  return new Date(now.getTime() - emailSendClaimTimeoutMs());
}

function emailSendClaimTimeoutMs(): number {
  const configured = Number(process.env.EMAIL_SEND_CLAIM_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_EMAIL_SEND_CLAIM_TIMEOUT_MS;
  }
  return Math.max(MIN_EMAIL_SEND_CLAIM_TIMEOUT_MS, Math.floor(configured));
}

function isEmailSendClaimStale(sendAttemptedAt: string | undefined, staleBefore: Date): boolean {
  if (!sendAttemptedAt) {
    return true;
  }
  const attemptedAt = new Date(sendAttemptedAt);
  return Number.isNaN(attemptedAt.getTime()) || attemptedAt < staleBefore;
}

function summarizeEmailThread(messages: EmailMessage[]): string {
  const ordered = messages.filter(isEmailMessageCommittedForSummary).sort((left, right) => emailMessageTime(left).localeCompare(emailMessageTime(right)));
  const latest = ordered.slice(-5).map((message) => `${message.direction}: ${message.subject} (${message.status})`).join("; ");
  return latest || "No email messages yet.";
}

function isEmailMessageCommittedForSummary(message: EmailMessage): boolean {
  return message.direction === "inbound" ? message.status === "received" : message.status === "sent";
}

function normalizeEmailAttachments(value: unknown): EmailAttachment[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const attachments = value
    .map((item): EmailAttachment | undefined => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const attachment = item as Partial<EmailAttachment>;
      const fileName = typeof attachment.fileName === "string" ? attachment.fileName.trim() : "";
      if (!fileName) {
        return undefined;
      }
      return {
        ...(typeof attachment.id === "string" && attachment.id.trim() ? { id: attachment.id.trim() } : {}),
        fileName,
        contentType: typeof attachment.contentType === "string" && attachment.contentType.trim() ? attachment.contentType.trim() : "application/octet-stream",
        size: Number.isFinite(Number(attachment.size)) ? Math.max(0, Math.floor(Number(attachment.size))) : 0,
        ...(typeof attachment.contentBase64 === "string" && attachment.contentBase64.trim() ? { contentBase64: attachment.contentBase64.trim() } : {}),
        ...(typeof attachment.contentId === "string" && attachment.contentId.trim() ? { contentId: attachment.contentId.trim() } : {}),
        ...(attachment.disposition === "inline" ? { disposition: "inline" as const } : attachment.disposition === "attachment" ? { disposition: "attachment" as const } : {}),
        ...(typeof attachment.providerMessageId === "string" && attachment.providerMessageId.trim() ? { providerMessageId: attachment.providerMessageId.trim() } : {}),
        ...(typeof attachment.providerAttachmentId === "string" && attachment.providerAttachmentId.trim() ? { providerAttachmentId: attachment.providerAttachmentId.trim() } : {}),
        ...(typeof attachment.externalUrl === "string" && attachment.externalUrl.trim() ? { externalUrl: attachment.externalUrl.trim() } : {})
      };
    })
    .filter((attachment): attachment is EmailAttachment => Boolean(attachment));
  return attachments.length ? attachments : undefined;
}

function normalizeEmailAiSources(value: unknown): NonNullable<EmailThread["aiAnalysisSources"]> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((source) => {
      if (!source || typeof source !== "object") {
        return undefined;
      }
      const item = source as Record<string, unknown>;
      const label = typeof item.label === "string" ? item.label.trim() : "";
      if (!label) {
        return undefined;
      }
      return {
        label,
        ...(typeof item.recordId === "string" && item.recordId.trim() ? { recordId: item.recordId.trim() } : {}),
        ...(typeof item.activityId === "string" && item.activityId.trim() ? { activityId: item.activityId.trim() } : {}),
        ...(typeof item.messageId === "string" && item.messageId.trim() ? { messageId: item.messageId.trim() } : {}),
        ...(typeof item.knowledgeArticleId === "string" && item.knowledgeArticleId.trim() ? { knowledgeArticleId: item.knowledgeArticleId.trim() } : {})
      };
    })
    .filter((source): source is NonNullable<EmailThread["aiAnalysisSources"]>[number] => Boolean(source))
    .slice(0, 20);
}

function normalizeEmailThreadCategory(value: unknown): EmailThread["category"] {
  return value === "primary" || value === "promotions" || value === "social" || value === "updates" ? value : undefined;
}

function classifyEmailCategory(message: EmailMessage): NonNullable<EmailThread["category"]> {
  const text = `${message.from} ${message.subject} ${message.bodyText}`.toLowerCase();
  if (/(unsubscribe|sale|discount|coupon|offer|promo|promotion|limited time|shop|store|newsletter|marketing|广告|促销|优惠|折扣|订阅)/.test(text)) {
    return "promotions";
  }
  if (/(linkedin|facebook|instagram|twitter|x\.com|wechat|whatsapp|social|follower|connection|commented|liked|社交|关注|评论|点赞)/.test(text)) {
    return "social";
  }
  if (/(receipt|invoice|statement|security|alert|notification|update|verify|verification|password|billing|report|system|提醒|通知|更新|账单|验证|安全)/.test(text)) {
    return "updates";
  }
  return "primary";
}

function normalizeEmailThreadLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .filter((label): label is string => typeof label === "string")
        .map((label) => label.trim())
        .filter(Boolean)
        .map((label) => label.slice(0, 40))
    )
  ).slice(0, 20);
}

function assertEmailOutboundAiPurpose(
  direction: EmailMessage["direction"],
  aiAssisted: boolean | undefined,
  aiPurpose: EmailMessage["aiPurpose"],
  aiGeneratedAt?: string
): void {
  if (direction !== "outbound" || !aiAssisted) {
    return;
  }
  if (!aiPurpose) {
    throw new Error("AI assisted outbound email requires aiPurpose");
  }
  if (aiPurpose !== "draft" && aiPurpose !== "translate") {
    throw new Error("AI assisted outbound email purpose must be draft or translate");
  }
  if (!aiGeneratedAt || Number.isNaN(Date.parse(aiGeneratedAt))) {
    throw new Error("AI assisted outbound email requires aiGeneratedAt");
  }
}

function assertEmailAiRecordThreadAlignment(recordId: string | undefined, thread: EmailThread | undefined): void {
  if (!recordId || !thread?.recordId) {
    return;
  }
  if (recordId !== thread.recordId) {
    throw new Error("Email AI context record does not match the selected thread");
  }
}

function coerceRow(row: Record<string, string>, fields: FieldDefinition[]): Record<string, unknown> {
  return fields.reduce<Record<string, unknown>>((data, field) => {
    if (!(field.key in row)) {
      return data;
    }
    const raw = row[field.key];
    if (raw === "") {
      return data;
    }

    if (field.type === "number" || field.type === "currency") {
      data[field.key] = Number(raw);
    } else if (field.type === "boolean") {
      data[field.key] = ["true", "1", "yes", "是"].includes(raw.toLowerCase());
    } else {
      data[field.key] = raw;
    }
    return data;
  }, {});
}

function buildImportTemplateExampleRow(fields: FieldDefinition[]): Record<string, unknown> {
  return {
    title: "Example record",
    ...Object.fromEntries(fields.map((field) => [field.key, importTemplateExampleValue(field)]))
  };
}

const importTemplateFieldGuideHeaders = [
  "column",
  "label",
  "type",
  "required",
  "unique",
  "defaultValue",
  "allowedValues",
  "referenceObject",
  "exampleValue",
  "notes"
];

function buildImportTemplateFieldGuideCsv(fields: FieldDefinition[], objects: ObjectDefinition[]): string {
  return buildCsv(importTemplateFieldGuideHeaders, [
    {
      column: "title",
      label: "名称",
      type: "text",
      required: "yes",
      unique: "no",
      defaultValue: "",
      allowedValues: "",
      referenceObject: "",
      exampleValue: "Example record",
      notes: "Record title; required for every import row."
    },
    ...fields.map((field) => buildImportTemplateFieldGuideRow(field, objects))
  ]);
}

function buildImportTemplateFieldGuideRow(field: FieldDefinition, objects: ObjectDefinition[]): Record<string, unknown> {
  return {
    column: field.key,
    label: field.label,
    type: field.type,
    required: field.required ? "yes" : "no",
    unique: field.unique ? "yes" : "no",
    defaultValue: formatImportTemplateGuideValue(field.defaultValue),
    allowedValues: field.type === "select" ? formatImportTemplateGuideOptions(field) : "",
    referenceObject: field.type === "reference" ? formatImportTemplateGuideReference(field, objects) : "",
    exampleValue: importTemplateExampleValue(field),
    notes: importTemplateFieldGuideNotes(field)
  };
}

function formatImportTemplateGuideOptions(field: FieldDefinition): string {
  return (field.options ?? []).map((option) => `${option.label}=${option.value}`).join("; ");
}

function formatImportTemplateGuideReference(field: FieldDefinition, objects: ObjectDefinition[]): string {
  const objectKey = field.options?.[0]?.value ?? "";
  const object = objects.find((candidate) => candidate.key === objectKey);
  return object ? `${object.label} (${object.key})` : objectKey;
}

function formatImportTemplateGuideValue(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function importTemplateFieldGuideNotes(field: FieldDefinition): string {
  if (field.type === "select") return "Use one of the allowed values, not the display label.";
  if (field.type === "reference") return "Use the target CRM record id.";
  if (field.type === "user") return "Use an active user id.";
  if (field.type === "boolean") return "Accepted true values include true, 1, yes, y.";
  if (field.type === "date") return "Use YYYY-MM-DD.";
  if (field.type === "number" || field.type === "currency") return "Use digits without thousands separators.";
  return "";
}

function importTemplateExampleValue(field: FieldDefinition): string {
  if (field.defaultValue !== undefined && field.defaultValue !== null && field.defaultValue !== "") {
    return String(field.defaultValue);
  }
  if (field.type === "number") return "100";
  if (field.type === "currency") return "1000";
  if (field.type === "date") return "2026-01-31";
  if (field.type === "boolean") return "true";
  if (field.type === "select") return field.options?.[0]?.value ?? "";
  if (field.type === "user") return "user-id";
  if (field.type === "reference") return "record-id";
  return "";
}

function isBlankValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function normalizeGovernedValue(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : JSON.stringify(value);
}

function normalizeCsvImportMapping(mapping?: CsvImportMapping): CsvImportMapping | undefined {
  if (!mapping) {
    return undefined;
  }
  const normalized = Object.fromEntries(
    Object.entries(mapping)
      .map(([header, target]) => [header.trim(), target.trim()])
      .filter(([header, target]) => header && target)
  );
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeImportPresetName(name: string): string {
  const normalized = name.trim();
  if (!normalized) {
    throw new Error("Import preset name is required");
  }
  return normalized;
}

function isIgnoredCsvImportHeader(header: string): boolean {
  return ["title", "name", "rowNumber", "status", "issues"].includes(header);
}

function applyCsvImportMapping(row: Record<string, string>, mapping?: CsvImportMapping): Record<string, string> {
  if (!mapping) {
    return row;
  }

  return Object.entries(row).reduce<Record<string, string>>((mappedRow, [header, value]) => {
    mappedRow[header] = value;
    const target = mapping[header];
    if (target) {
      mappedRow[target] = value;
    }
    return mappedRow;
  }, {});
}

function assertCsvImportMappingTargets(fields: FieldDefinition[], mapping?: CsvImportMapping): void {
  if (!mapping) {
    return;
  }
  const allowedTargets = new Set(["title", "name", ...fields.map((field) => field.key)]);
  const usedTargets = new Set<string>();
  for (const [header, target] of Object.entries(mapping)) {
    if (!allowedTargets.has(target)) {
      throw new Error(`CSV mapping for ${header} targets unknown field ${target}`);
    }
    if (usedTargets.has(target)) {
      throw new Error(`CSV mapping targets ${target} more than once`);
    }
    usedTargets.add(target);
  }
}

function findCsvImportConflicts(
  rowNumber: number,
  fields: FieldDefinition[],
  data: Record<string, unknown>,
  existingRecords: CrmRecord[]
): CsvImportConflict[] {
  const conflicts: CsvImportConflict[] = [];
  for (const field of fields) {
    if (!field.unique) {
      continue;
    }

    const value = data[field.key];
    if (isBlankValue(value)) {
      continue;
    }

    const normalized = normalizeGovernedValue(value);
    const existing = existingRecords.find((record) => !isBlankValue(record.data[field.key]) && normalizeGovernedValue(record.data[field.key]) === normalized);
    if (existing) {
      conflicts.push({
        rowNumber,
        fieldKey: field.key,
        fieldLabel: field.label,
        value: String(value),
        existingRecordId: existing.id,
        existingRecordTitle: existing.title
      });
    }
  }
  return conflicts;
}

function formatCsvImportConflict(conflict: CsvImportConflict): string {
  return `Row ${conflict.rowNumber}: ${conflict.fieldLabel} conflicts with existing record ${conflict.existingRecordTitle} (${conflict.existingRecordId})`;
}

function formatCsvImportRowIssues(row: CsvImportPreview["rows"][number]): string[] {
  return [...row.errors.map((error) => `Row ${row.rowNumber}: ${error}`), ...row.conflicts.map((conflict) => formatCsvImportConflict(conflict))];
}

function getSingleConflictRecordId(conflicts: CsvImportConflict[]): string | undefined {
  const ids = new Set(conflicts.map((conflict) => conflict.existingRecordId));
  return ids.size === 1 ? [...ids][0] : undefined;
}

function buildQueryView(workspaceId: string, objectKey: string, query: RecordListQuery): SavedView {
  return {
    id: "query-view",
    workspaceId,
    objectKey,
    name: "Query",
    columns: ["title"],
    filters: query.filters,
    sort: query.sort,
    isDefault: false
  };
}

function normalizeRecordListQuery(query: RecordListQuery, page: number, pageSize: number): RecordListQuery {
  return {
    page,
    pageSize,
    q: query.q?.trim() || undefined,
    filters: query.filters?.filter((filter) => filter.field && filter.value.trim()),
    sort: query.sort?.field ? query.sort : undefined,
    cursor: query.cursor?.trim() || undefined,
    keyset: Boolean(query.keyset || query.cursor),
    fields: query.fields?.filter((field) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(field))
  };
}

function normalizeEmailAccountToggles(provider: EmailAccount["provider"], toggles: Pick<EmailAccount, "syncEnabled" | "sendEnabled">): Pick<EmailAccount, "syncEnabled" | "sendEnabled"> {
  const capability = getEmailProviderCapability(provider);
  return {
    syncEnabled: capability.supportsSync ? toggles.syncEnabled : false,
    sendEnabled: capability.supportsSend ? toggles.sendEnabled : false
  };
}

function normalizeEmailAiProviderError(value: string | undefined): string | undefined {
  const normalized = value?.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 500) : undefined;
}

function publicEmailAiSettings(settings: EmailAiSettings): EmailAiSettings {
  return {
    ...clone(settings),
    providerConfig: publicAiProviderConfig(settings.providerConfig)
  };
}
