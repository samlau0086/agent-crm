import { NextResponse, type NextRequest } from "next/server";
import { getRequestContext, handleApiError, withApiMetrics } from "@/lib/api";
import { renderSalesDocumentPdf } from "@/lib/crm/document-pdf";
import { getCrmRepository } from "@/lib/crm/repository";
import { salesDocumentNumberField } from "@/lib/crm/quotes";
import type { CrmRecord, DocumentTemplate, RequestContext } from "@/lib/crm/types";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { objectKey: string; recordId: string };
}

async function downloadPdf(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    const repository = getCrmRepository();
    const record = await repository.getRecord(context, params.objectKey, params.recordId);
    const templateId = request.nextUrl.searchParams.get("templateId");
    const template = templateId ? await repository.getDocumentTemplate(context, templateId) : await repository.getDefaultDocumentTemplate(context, params.objectKey);
    if (!template.active || template.objectKey !== params.objectKey) {
      throw new Error("PDF template is not active for this object");
    }
    const [company, contact, deal, currencyRecords] = await Promise.all([
      getLinkedRecord(context, String(record.data.companyId ?? ""), "companies"),
      getLinkedRecord(context, String(record.data.contactId ?? ""), "contacts"),
      getLinkedRecord(context, String(record.data.dealId ?? ""), "deals"),
      repository.listRecords(context, "currencies")
    ]);
    const pdf = await renderSalesDocumentPdf(template, {
      record,
      company,
      contact,
      deal,
      records: currencyRecords,
      workspace: { id: context.workspaceId },
      generatedAt: new Date().toISOString()
    });
    const fileName = buildPdfFileName(record, template);
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return handleApiError(error, request);
  }
}

async function getLinkedRecord(context: RequestContext, recordId: string, objectKey: string): Promise<CrmRecord | undefined> {
  if (!recordId) {
    return undefined;
  }
  try {
    return await getCrmRepository().getRecord(context, objectKey, recordId);
  } catch {
    return undefined;
  }
}

function buildPdfFileName(record: CrmRecord, template: DocumentTemplate): string {
  const number = String(record.data[salesDocumentNumberField(record.objectKey)] ?? record.id).replace(/[^A-Za-z0-9._-]/g, "_");
  return `${template.objectKey}-${number}.pdf`;
}

export const GET = withApiMetrics("GET /api/records/[objectKey]/[recordId]/pdf", downloadPdf);
