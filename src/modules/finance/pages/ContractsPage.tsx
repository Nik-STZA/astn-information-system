// Contracts, client scoped and ring-fenced (Nik, 15 Nov 2026): what each
// company has agreed to sell and to buy, both sides, read from their PDFs.

import Link from "next/link";
import PageHeader from "@/shared/ui/PageHeader";
import ContractsView from "@/modules/finance/components/ContractsView";
import { fetchContracts, type Side } from "@/modules/finance/lib/contracts";
import page from "@/modules/finance/components/Page.module.css";

export const dynamic = "force-dynamic";

export default async function ContractsPage({ params: paramsPromise, searchParams: searchParamsPromise }: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ side?: string; status?: string }>;
}) {
  const { slug } = await paramsPromise;
  const q = (await searchParamsPromise) ?? {};
  const side: Side | null = q.side === "customer" || q.side === "supplier" ? q.side : null;
  const r = await fetchContracts(slug, q.status === "all");
  const sideQuery = side ? `side=${side}&` : "";
  return (
    <div>
      <PageHeader title="Contracts"
        sub="What each company has agreed to sell and to buy: how it becomes revenue or cost, payments, milestones, renewals and notice dates. Finance terms only, not a legal review."
        actions={<>
          <Link prefetch={false} className="btn-secondary" href={`/finance/clients/${encodeURIComponent(slug)}/contracts/new`}>Add by hand</Link>
          <Link prefetch={false} className="btn-text" href={`/finance/clients/${encodeURIComponent(slug)}/contracts?${sideQuery}${q.status === "all" ? "" : "status=all"}`}>
            {q.status === "all" ? "Active only" : "Include ended"}
          </Link>
        </>} />
      {!r.ok ? (
        <div className={page.error} role="alert">Could not load contracts: {/Cannot GET/i.test(r.error) ? "the endpoint is not deployed on finance-api yet." : r.error}</div>
      ) : (
        <ContractsView slug={slug} data={r.data} side={side} />
      )}
    </div>
  );
}
