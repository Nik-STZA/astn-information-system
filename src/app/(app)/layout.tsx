import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAllowed } from "@/lib/allowlist";
import TopNav from "@/components/TopNav";

/**
 * Layout shared by all authenticated routes.
 *
 * The middleware also enforces the auth check, but this layout enforces it
 * a second time as defence in depth and as the place that fetches the
 * session for the navbar.
 */
export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  if (!isAllowed(session.user.email)) {
    redirect("/blocked");
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--pg)" }}>
      <TopNav userEmail={session.user.email!} />
      <main className="page-container">{children}</main>
    </div>
  );
}
