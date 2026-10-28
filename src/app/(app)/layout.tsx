import { redirect } from "next/navigation";
import { getIapEmail } from "@/lib/auth";
import Sidebar, { type SidebarClient } from "@/components/Sidebar";
import { navigationForEnvironment } from "@/app/(app)/navigation";
import { enabledModules } from "@/shared/config/features";
import { fetchFinanceClients } from "@/modules/finance/lib/api";
import { fetchMasterClients } from "@/modules/finance/lib/clients";

/**
 * Layout shared by all authenticated routes: the left sidebar beside the page.
 *
 * IAP authenticated the user at the load balancer and IAP IAM enforces the
 * allowlist; the middleware verified the assertion header. Here we read the
 * email for display in the sidebar.
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

  // The sidebar's clients, from the client master: the ones we work with
  // (engaged and internal), each with its services. Should the master not
  // answer, the finance list stands in, Finance only. A finance-api outage
  // must not take every page down with it: the list is then simply empty.
  let clients: SidebarClient[] = [];
  if (enabledModules(process.env.FEATURES).includes("finance")) {
    clients = await fetchMasterClients()
      .then((rows) => rows
        .filter((c) => c.status === "engaged" || c.status === "internal")
        .map((c) => ({
          slug: c.slug,
          name: c.name,
          services: c.services.filter((s) => s.state).map((s) => ({ service: s.service, state: s.state as "active" | "completed" })),
          complianceId: c.compliance_client_id,
        })))
      .catch(() => fetchFinanceClients().then((rows) => rows.map((c) => ({ slug: c.slug, name: c.name }))))
      .then((rows) => rows.sort((a, b) => a.name.localeCompare(b.name)))
      .catch(() => []);
  }

  return (
    <div className="app-shell">
      <Sidebar userEmail={userEmail} groups={navigationForEnvironment()} clients={clients} />
      <main className="app-main">
        <div className="page-container">{children}</div>
      </main>
    </div>
  );
}
