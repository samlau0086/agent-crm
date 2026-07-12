import { NextResponse, type NextRequest } from "next/server";
import { getRequestContext, handleApiError, parseJson, withApiMetrics } from "@/lib/api";
import { documentTemplatePreviewSchema } from "@/lib/crm/api-schemas";
import { renderSalesDocumentPdf } from "@/lib/crm/document-pdf";
import { getCrmRepository } from "@/lib/crm/repository";
import type { CrmRecord, RequestContext } from "@/lib/crm/types";

export const dynamic = "force-dynamic";

async function previewTemplate(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, documentTemplatePreviewSchema);
    const repository = getCrmRepository();
    const record = await repository.getRecord(context, body.objectKey, body.recordId);
    const [company, contact, deal, currencyRecords, paymentTermRecords, productRecords, teams] = await Promise.all([
      getLinkedRecord(context, String(record.data.companyId ?? ""), "companies"),
      getLinkedRecord(context, String(record.data.contactId ?? ""), "contacts"),
      getLinkedRecord(context, String(record.data.dealId ?? ""), "deals"),
      repository.listRecords(context, "currencies"),
      repository.listRecords(context, "paymentterms"),
      repository.listRecords(context, "products"),
      repository.listTeams(context)
    ]);
    const now = new Date().toISOString();
    const pdf = await renderSalesDocumentPdf({
      id: "preview", workspaceId: context.workspaceId, objectKey: body.objectKey, name: "Preview", active: true, isDefault: false,
      templateJson: body.templateJson, createdById: context.user.id, createdAt: now, updatedAt: now
    }, {
      record, company, contact, deal,
      team: teams.find((team) => team.id === context.user.teamId),
      records: [...currencyRecords, ...paymentTermRecords, ...productRecords],
      workspace: { id: context.workspaceId }, generatedAt: now
    });
    return new NextResponse(pdf, { status: 200, headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error, request);
  }
}

async function getLinkedRecord(context: RequestContext, recordId: string, objectKey: string): Promise<CrmRecord | undefined> {
  if (!recordId) return undefined;
  try { return await getCrmRepository().getRecord(context, objectKey, recordId); } catch { return undefined; }
}

export const POST = withApiMetrics("POST /api/document-templates/preview", previewTemplate);
