import type { EmailProviderType } from "@/lib/crm/types";

export type OAuthEmailProviderType = "gmail" | "outlook";

export interface EmailProviderCapability {
  key: EmailProviderType;
  label: string;
  connectionKind: "smtp_imap" | "oauth" | "custom";
  supportsSend: boolean;
  supportsSync: boolean;
  supportsAttachments: boolean;
  supportsOAuth: boolean;
  oauthEnvPrefix?: "GMAIL" | "OUTLOOK";
  defaultAuthUrl?: string;
  defaultTokenUrl?: string;
  defaultScope?: string;
  description: string;
}

export interface EmailProviderSetupVisibility {
  showSmtpImapFields: boolean;
  showOAuthFields: boolean;
  canStartOAuth: boolean;
}

export type OAuthEmailProviderCapability = EmailProviderCapability & {
  key: OAuthEmailProviderType;
  oauthEnvPrefix: "GMAIL" | "OUTLOOK";
  defaultAuthUrl: string;
  defaultTokenUrl: string;
  defaultScope: string;
};

export const emailProviderCapabilities = {
  smtp_imap: {
    key: "smtp_imap",
    label: "SMTP/IMAP",
    connectionKind: "smtp_imap",
    supportsSend: true,
    supportsSync: true,
    supportsAttachments: true,
    supportsOAuth: false,
    description: "Standards-based mailbox adapter using SMTP for sending and IMAP for sync."
  },
  gmail: {
    key: "gmail",
    label: "Gmail",
    connectionKind: "oauth",
    supportsSend: true,
    supportsSync: true,
    supportsAttachments: true,
    supportsOAuth: true,
    oauthEnvPrefix: "GMAIL",
    defaultAuthUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    defaultTokenUrl: "https://oauth2.googleapis.com/token",
    defaultScope: "https://mail.google.com/",
    description: "Gmail API adapter with OAuth token refresh, send, sync, and attachment download."
  },
  outlook: {
    key: "outlook",
    label: "Outlook",
    connectionKind: "oauth",
    supportsSend: true,
    supportsSync: true,
    supportsAttachments: true,
    supportsOAuth: true,
    oauthEnvPrefix: "OUTLOOK",
    defaultAuthUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    defaultTokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    defaultScope: "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send offline_access",
    description: "Microsoft Graph adapter with OAuth token refresh, send, sync, and attachment download."
  },
  custom: {
    key: "custom",
    label: "Custom",
    connectionKind: "custom",
    supportsSend: false,
    supportsSync: false,
    supportsAttachments: false,
    supportsOAuth: false,
    description: "Reserved extension slot for private mailbox connectors implemented behind the provider adapter."
  }
} satisfies Record<EmailProviderType, EmailProviderCapability>;

export const oauthEmailProviderKeys = ["gmail", "outlook"] as const satisfies readonly OAuthEmailProviderType[];

export function getEmailProviderCapability(provider: EmailProviderType): EmailProviderCapability {
  return emailProviderCapabilities[provider];
}

export function listEmailProviderCapabilities(): EmailProviderCapability[] {
  return Object.values(emailProviderCapabilities);
}

export function isOAuthEmailProvider(provider: EmailProviderType): provider is OAuthEmailProviderType {
  return getEmailProviderCapability(provider).supportsOAuth;
}

export function getEmailProviderSetupVisibility(provider: EmailProviderType): EmailProviderSetupVisibility {
  const capability = getEmailProviderCapability(provider);
  return {
    showSmtpImapFields: capability.connectionKind === "smtp_imap",
    showOAuthFields: capability.supportsOAuth,
    canStartOAuth: capability.supportsOAuth
  };
}

export function getOAuthEmailProviderCapability(provider: OAuthEmailProviderType): OAuthEmailProviderCapability {
  const capability = getEmailProviderCapability(provider);
  if (!capability.supportsOAuth || !capability.oauthEnvPrefix || !capability.defaultAuthUrl || !capability.defaultTokenUrl || !capability.defaultScope) {
    throw new Error(`${provider} is not configured as an OAuth email provider`);
  }
  return capability as OAuthEmailProviderCapability;
}
