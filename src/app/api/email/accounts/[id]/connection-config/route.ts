import type { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac";
import { getRequestContext, handleApiError, ok, withApiMetrics } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";
import { normalizeEmailConnectionConfig } from "@/lib/email/connection-config";
import type { EmailConnectionConfig, EmailInboundConnectionConfig, EmailOutboundServiceConfig } from "@/lib/crm/types";

export const dynamic = "force-dynamic";

export type SanitizedEmailConnectionConfig = {
  inbound?: Omit<EmailInboundConnectionConfig, "password" | "accessToken" | "refreshToken"> & {
    hasPassword?: boolean;
    hasAccessToken?: boolean;
    hasRefreshToken?: boolean;
  };
  outboundServices?: Array<Omit<EmailOutboundServiceConfig, "password" | "resendApiKey"> & {
    hasPassword?: boolean;
    hasResendApiKey?: boolean;
  }>;
  defaultOutboundServiceId?: string;
};

async function getApiMetricsHandler(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    requirePermission(context, "crm.admin");
    const config = await getCrmRepository().getEmailAccountConnectionConfig(context, params.id);
    return ok(config ? sanitizeEmailConnectionConfig(config) : {});
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/email/accounts/[id]/connection-config", getApiMetricsHandler);

function sanitizeEmailConnectionConfig(config: EmailConnectionConfig): SanitizedEmailConnectionConfig {
  const normalized = normalizeEmailConnectionConfig(config);
  return {
    inbound: normalized.inbound
      ? {
          syncProtocol: normalized.inbound.syncProtocol,
          imapHost: normalized.inbound.imapHost,
          imapPort: normalized.inbound.imapPort,
          imapSecure: normalized.inbound.imapSecure,
          username: normalized.inbound.username,
          mailbox: normalized.inbound.mailbox,
          mailboxMapping: normalized.inbound.mailboxMapping,
          oauthProvider: normalized.inbound.oauthProvider,
          tokenType: normalized.inbound.tokenType,
          expiresAt: normalized.inbound.expiresAt,
          scope: normalized.inbound.scope,
          hasPassword: Boolean(normalized.inbound.password),
          hasAccessToken: Boolean(normalized.inbound.accessToken),
          hasRefreshToken: Boolean(normalized.inbound.refreshToken)
        }
      : undefined,
    outboundServices: normalized.outboundServices?.map((service) => ({
      id: service.id,
      name: service.name,
      type: service.type,
      enabled: service.enabled,
      fromEmail: service.fromEmail,
      smtpHost: service.smtpHost,
      smtpPort: service.smtpPort,
      smtpSecure: service.smtpSecure,
      smtpStartTls: service.smtpStartTls,
      username: service.username,
      hasPassword: Boolean(service.password),
      hasResendApiKey: Boolean(service.resendApiKey)
    })),
    defaultOutboundServiceId: normalized.defaultOutboundServiceId
  };
}
