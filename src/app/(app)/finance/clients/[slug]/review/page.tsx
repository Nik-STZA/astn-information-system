// Route binding. The page lives in the Finance module; the signed-in person is
// read here, because a module does not import from src/lib.
import ReviewPage from "@/modules/finance/pages/ReviewPage";
import { getIapEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const actorEmail = await getIapEmail();
  return <ReviewPage params={params} actorEmail={actorEmail} />;
}
