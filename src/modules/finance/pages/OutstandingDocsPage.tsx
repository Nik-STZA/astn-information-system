// Outstanding documents, client scoped (Nik, 10 Nov 2026): transactions the
// client has not supported with a document, carried as open items in the close
// and listed in the management pack. Reports are dropped on the page in a
// batch, read into lines, and accepted onto the register.

import PageHeader from "@/shared/ui/PageHeader";
import OutstandingDocsView from "@/modules/finance/components/OutstandingDocsView";
import { fetchOutstandingDocs } from "@/modules/finance/lib/outstanding-docs";
import page from "@/modules/finance/components/Page.module.css";

export const dynamic = "force-dynamic";

export default async function OutstandingDocsPage({ params: paramsPromise, searchParams: searchParamsPromise }: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ view?: string }>;
}) {
  const { slug } = await paramsPromise;
  const q = (await searchParamsPromise) ?? {};
  const view = q.view === "accept" || q.view === "closed" ? q.view : "open";
  const r = await fetchOutstandingDocs(slug, view === "closed");
  return (
    <div>
      <PageHeader title="Outstanding documents"
        sub="Transactions the client has not supported with an invoice, receipt or contract. Carried in the close until the document comes or the CFO closes them; they never block a sign-off." />
      {!r.ok ? (
        <div className={page.error} role="alert">Could not load outstanding documents: {/Cannot GET/i.test(r.error) ? "the endpoint is not deployed on finance-api yet." : r.error}</div>
      ) : (
        <OutstandingDocsView slug={slug} data={r.data} companies={r.data.companies ?? []} view={view} />
      )}
    </div>
  );
}
