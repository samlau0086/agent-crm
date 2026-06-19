import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    const csv = await getCrmRepository().exportImportJobIssuesCsv(context, params.id);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="import-${params.id}-issues.csv"`
      }
    });
  } catch (error) {
    return handleApiError(error, request);
  }
}
