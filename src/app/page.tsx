import { CrmPage } from "@/app/crm-page";

export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function Home({ searchParams = {} }: HomePageProps) {
  return <CrmPage searchParams={searchParams} />;
}
