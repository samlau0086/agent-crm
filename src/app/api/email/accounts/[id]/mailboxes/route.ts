import type { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac";
import { getRequestContext, handleApiError, ok, withApiMetrics } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";
import { getInboundConnectionConfig } from "@/lib/email/connection-config";
import { listImapMailboxes } from "@/lib/email/smtp-imap";

export const dynamic = "force-dynamic";

async function getApiMetricsHandler(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    requirePermission(context, "crm.admin");
    const repository = getCrmRepository();
    const account = await repository.getEmailAccount(context, params.id);
    if (account.provider !== "smtp_imap") {
      throw new Error("Mailbox listing is only available for SMTP/IMAP accounts");
    }
    const config = await repository.getEmailAccountConnectionConfig(context, params.id);
    if (!config) {
      throw new Error("Email account connection is not configured");
    }
    return ok(await listImapMailboxes(getInboundConnectionConfig(config)));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/email/accounts/[id]/mailboxes", getApiMetricsHandler);
