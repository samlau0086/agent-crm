export interface EmailOAuthConnectedNotice {
  status: "connected";
  accountId: string;
  created: boolean;
  message: string;
}

export interface EmailOAuthErrorNotice {
  status: "error";
  error: string;
  message: string;
}

export type EmailOAuthCallbackNotice = EmailOAuthConnectedNotice | EmailOAuthErrorNotice;

export function readEmailOAuthCallbackNotice(search: string | URLSearchParams): EmailOAuthCallbackNotice | undefined {
  const params = typeof search === "string" ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search) : search;
  const status = params.get("emailOAuth");
  if (status === "connected") {
    return readEmailOAuthConnectedNotice(params);
  }
  if (status === "error") {
    const error = params.get("emailOAuthError")?.trim() || "OAuth authorization failed";
    return {
      status: "error",
      error,
      message: `邮箱 OAuth 授权失败：${error}`
    };
  }
  return undefined;
}

export function readEmailOAuthConnectedNotice(search: string | URLSearchParams): EmailOAuthConnectedNotice | undefined {
  const params = typeof search === "string" ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search) : search;
  if (params.get("emailOAuth") !== "connected") {
    return undefined;
  }
  const accountId = params.get("emailAccountId")?.trim();
  if (!accountId) {
    return undefined;
  }
  const created = params.get("emailAccountCreated") === "true";
  return {
    status: "connected",
    accountId,
    created,
    message: created ? "邮箱 OAuth 授权完成，已创建邮箱账户" : "邮箱 OAuth 授权完成，已更新邮箱连接"
  };
}
