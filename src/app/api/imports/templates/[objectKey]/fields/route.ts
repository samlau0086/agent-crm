import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";


export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, { params }: { params: { objectKey: string } }) {
  try {
    const context = await getRequestContext(request);
    const csv = await getCrmRepository().exportImportTemplateFieldGuideCsv(context, params.objectKey);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${params.objectKey}-import-field-guide.csv"`
      }
    });
  } catch (error) {
    return handleApiError(error, request);
  }
}
