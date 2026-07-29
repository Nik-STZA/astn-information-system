import { redirect } from "next/navigation";
import { getIapEmail } from "@/lib/auth";
import TopNav from "@/components/TopNav";
import { navigationForEnvironment } from "@/app/(app)/navigation";

/**
 * Layout shared by all authenticated routes.
 *
 * IAP authenticated the user at the load balancer and IAP IAM enforces the
 * allowlist; the middleware verified the assertion header. Here we read the
 * email for display in the navbar.
 */
export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const userEmail = getIapEmail();
  if (!userEmail) {
    // Middleware should have 403'd already; never render unauthenticated.
    redirect("/blocked");
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--pg)" }}>
      <TopNav userEmail={userEmail} groups={navigationForEnvironment()} />
      <main className="page-container">{children}</main>
    </div>
  );
}
