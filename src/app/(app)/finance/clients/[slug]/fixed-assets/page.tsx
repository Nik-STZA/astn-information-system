// Route binding: reads who is signed in (src/lib/auth, which a module may not
// import) and hands it to the Finance module's page, for initials on threads.
import FixedAssetsPage from "@/modules/finance/pages/FixedAssetsPage";
import { getIapEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Page(props: { params: Promise<{ slug: string }>; searchParams?: Promise<{ company?: string; period?: string }> }) {
  return <FixedAssetsPage {...props} actorEmail={await getIapEmail()} />;
}
