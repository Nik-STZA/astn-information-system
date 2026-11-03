// Route binding. The page lives in the Finance module; the signed-in person is
// read here, because a module does not import from src/lib.
import ClosePage from "@/modules/finance/pages/ClosePage";
import { getIapEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const actorEmail = await getIapEmail();
  return <ClosePage params={params} searchParams={searchParams} actorEmail={actorEmail} />;
}
