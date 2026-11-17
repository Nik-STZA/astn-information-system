// Route binding: reads who is signed in (src/lib/auth, which a module may not
// import) and hands it to the Finance module's page, for initials on threads.
import RecPage from "@/modules/finance/pages/RecPage";
import { getIapEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Page(props: { params: Promise<{ slug: string; id: string }> }) {
  return <RecPage {...props} actorEmail={await getIapEmail()} />;
}
