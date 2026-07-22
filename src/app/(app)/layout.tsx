import { redirect } from "next/navigation";
import { AUTH_MODE, getIapEmail } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAllowed } from "@/lib/allowlist";
import TopNav from "@/components/TopNav";

/**
 * Layout shared by all authenticated routes.
 *
 * IAP mode: the load balancer's Identity-Aware Proxy authenticated the user
 * and IAP IAM enforces the allowlist — the middleware verified the assertion
 * header; here we just read the email for display.
 *
 * Supabase mode (legacy Netlify): the middleware also enforces the auth
 * check, but this layout enforces it a second time as defence in depth and
 * fetches the session for the navbar.
 */
export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let userEmail: string;

  if (AUTH_MODE === "iap") {
    const email = getIapEmail();
    if (!email) {
      // Middleware should have 403'd already; never render unauthenticated.
      redirect("/blocked");
    }
    userEmail = email;
  } else {
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
    userEmail = session.user.email!;
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--pg)" }}>
      <TopNav userEmail={userEmail} authMode={AUTH_MODE} />
      <main className="page-container">{children}</main>
    </div>
  );
}
