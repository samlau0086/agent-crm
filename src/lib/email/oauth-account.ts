import type { EmailAccount, EmailConnectionConfig, RequestContext } from "@/lib/crm/types";

export type OAuthMailboxProvider = "gmail" | "outlook";

export interface OAuthEmailAccountRepository {
  listEmailAccounts(context: RequestContext): EmailAccount[] | Promise<EmailAccount[]>;
  createEmailAccount(
    context: RequestContext,
    input: Pick<EmailAccount, "name" | "emailAddress" | "provider"> &
      Partial<Pick<EmailAccount, "syncEnabled" | "sendEnabled" | "status">> & { connectionConfig?: EmailConnectionConfig }
  ): EmailAccount | Promise<EmailAccount>;
  updateEmailAccount(
    context: RequestContext,
    accountId: string,
    input: Partial<Pick<EmailAccount, "name" | "emailAddress" | "provider" | "syncEnabled" | "sendEnabled" | "status">> & {
      connectionConfig?: EmailConnectionConfig;
    }
  ): EmailAccount | Promise<EmailAccount>;
}

export interface ConnectOAuthEmailAccountInput {
  provider: OAuthMailboxProvider;
  name: string;
  emailAddress: string;
  syncEnabled: boolean;
  sendEnabled: boolean;
  connectionConfig: EmailConnectionConfig;
}

export interface ConnectOAuthEmailAccountResult {
  account: EmailAccount;
  created: boolean;
}

export function buildOAuthEmailConnectedRedirectUrl(baseUrl: string | URL, result: ConnectOAuthEmailAccountResult): URL {
  const url = new URL("/", baseUrl);
  url.searchParams.set("emailOAuth", "connected");
  url.searchParams.set("emailAccountId", result.account.id);
  url.searchParams.set("emailAccountCreated", result.created ? "true" : "false");
  return url;
}

export function buildOAuthEmailErrorRedirectUrl(baseUrl: string | URL, error: unknown): URL {
  const url = new URL("/", baseUrl);
  const message = error instanceof Error ? error.message : String(error || "OAuth authorization failed");
  url.searchParams.set("emailOAuth", "error");
  url.searchParams.set("emailOAuthError", message.slice(0, 300));
  return url;
}

export async function connectOAuthEmailAccount(
  context: RequestContext,
  repository: OAuthEmailAccountRepository,
  input: ConnectOAuthEmailAccountInput
): Promise<ConnectOAuthEmailAccountResult> {
  const normalizedEmail = input.emailAddress.trim().toLowerCase();
  const existing = (await repository.listEmailAccounts(context)).find((account) => account.emailAddress.toLowerCase() === normalizedEmail);

  if (existing) {
    return {
      account: await repository.updateEmailAccount(context, existing.id, {
        name: input.name || existing.name,
        emailAddress: normalizedEmail,
        provider: input.provider,
        status: "active",
        syncEnabled: input.syncEnabled,
        sendEnabled: input.sendEnabled,
        connectionConfig: input.connectionConfig
      }),
      created: false
    };
  }

  return {
    account: await repository.createEmailAccount(context, {
      name: input.name,
      emailAddress: normalizedEmail,
      provider: input.provider,
      status: "active",
      syncEnabled: input.syncEnabled,
      sendEnabled: input.sendEnabled,
      connectionConfig: input.connectionConfig
    }),
    created: true
  };
}
