// Route binding: reads who is signed in (src/lib/auth, which a module may not
// import) and hands it to the Finance module's profile page.
import ProfilePage from "@/modules/finance/pages/ProfilePage";
import { getIapEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Page() {
  return <ProfilePage actorEmail={await getIapEmail()} />;
}
