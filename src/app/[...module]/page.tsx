import { CrmPage } from "@/app/crm-page";

export const dynamic = "force-dynamic";

type ModulePageProps = {
  params: {
    module?: string[];
  };
};

export default async function ModulePage({ params }: ModulePageProps) {
  return <CrmPage moduleSegments={params.module ?? []} />;
}
