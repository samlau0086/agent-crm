import { CrmPage } from "@/app/crm-page";

export const dynamic = "force-dynamic";

type ModulePageProps = {
  params: {
    module?: string[];
  };
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function ModulePage({ params, searchParams = {} }: ModulePageProps) {
  return <CrmPage moduleSegments={params.module ?? []} searchParams={searchParams} />;
}
