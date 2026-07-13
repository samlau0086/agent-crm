import { NextResponse, type NextRequest } from "next/server";
import { getRequestContext, handleApiError, withApiMetrics } from "@/lib/api";
import { renderSalesDocumentPdf } from "@/lib/crm/document-pdf";
import { getCrmRepository } from "@/lib/crm/repository";
import { salesDocumentNumberField } from "@/lib/crm/quotes";
import { renderPdfFileName } from "@/lib/crm/pdf-file-name";
import type { CrmRecord, DocumentTemplate, RequestContext } from "@/lib/crm/types";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { objectKey: string; recordId: string };
}

async function downloadPdf(request: NextRequest, { params }: RouteParams) {
  // Cloudflare Speed Brain can speculatively navigate to visible download links.
  // Avoid doing the expensive PDF work until the user actually downloads it.
  if (isPrefetchRequest(request)) {
    return new NextResponse(null, {
      status: 204,
      headers: { "Cache-Control": "private, no-store" }
    });
  }

  try {
    const context = await getRequestContext(request);
    const repository = getCrmRepository();
    const record = await repository.getRecord(context, params.objectKey, params.recordId);
    const templateId = request.nextUrl.searchParams.get("templateId");
    const template = templateId ? await repository.getDocumentTemplate(context, templateId) : await repository.getDefaultDocumentTemplate(context, params.objectKey);
    if (!template.active || template.objectKey !== params.objectKey) {
      throw new Error("PDF template is not active for this object");
    }
    const [company, contact, deal, currencyRecords, paymentTermRecords, productRecords, teams] = await Promise.all([
      getLinkedRecord(context, String(record.data.companyId ?? ""), "companies"),
      getLinkedRecord(context, String(record.data.contactId ?? ""), "contacts"),
      getLinkedRecord(context, String(record.data.dealId ?? ""), "deals"),
      repository.listRecords(context, "currencies"),
      repository.listRecords(context, "paymentterms"),
      repository.listRecords(context, "products"),
      repository.listTeams(context)
    ]);
    const pdf = await renderSalesDocumentPdf(template, {
      record,
      company,
      contact,
      deal,
      team: teams.find((team) => team.id === context.user.teamId),
      records: [...currencyRecords, ...paymentTermRecords, ...productRecords],
      workspace: { id: context.workspaceId },
      generatedAt: new Date().toISOString()
    });
    const fileName = buildPdfFileName(record, template);
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": buildContentDisposition(fileName),
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return handleApiError(error, request);
  }
}

function isPrefetchRequest(request: NextRequest): boolean {
  return [request.headers.get("sec-purpose"), request.headers.get("purpose")]
    .some((value) => value?.toLowerCase().split(/\s*;\s*/).includes("prefetch"));
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
  const documentNumber = String(record.data[salesDocumentNumberField(record.objectKey)] ?? record.id);
  return renderPdfFileName(template.fileNamePattern, { recordId: record.id, documentNumber });
}

function buildContentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^A-Za-z0-9._-]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export const GET = withApiMetrics("GET /api/records/[objectKey]/[recordId]/pdf", downloadPdf);
