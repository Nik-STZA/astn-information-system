// One contract of a client (15 Nov 2026). ?edit=1 opens its terms for editing.

import Link from "next/link";
import PageHeader from "@/shared/ui/PageHeader";
import ContractDetail from "@/modules/finance/components/ContractDetail";
import ContractForm from "@/modules/finance/components/ContractForm";
import { fetchContract, money } from "@/modules/finance/lib/contracts";
import page from "@/modules/finance/components/Page.module.css";

export const dynamic = "force-dynamic";

export default async function ContractPage({ params: paramsPromise, searchParams: searchParamsPromise }: {
  params: Promise<{ slug: string; id: string }>;
  searchParams?: Promise<{ edit?: string }>;
}) {
  const { slug, id } = await paramsPromise;
  const q = (await searchParamsPromise) ?? {};
  const r = await fetchContract(slug, id);
  const back = `/finance/clients/${encodeURIComponent(slug)}/contracts`;
  if (!r.ok) {
    return (
      <div>
        <Link prefetch={false} className={page.back} href={back}>&larr; Contracts</Link>
        <div className={page.error} role="alert">{r.status === 404 ? "No such contract for this client." : `Could not load the contract: ${r.error}`}</div>
      </div>
    );
  }
  const c = r.data.contract;
  return (
    <div>
      <Link prefetch={false} className={page.back} href={back}>&larr; Contracts</Link>
      <PageHeader title={c.counterparty}
        sub={`${c.side === "customer" ? "Customer" : "Supplier"} · ${c.entity_name}${c.reference ? ` · ${c.reference}` : ""}${c.status !== "active" ? ` · ${c.status}` : ""}`}
        actions={c.total_value != null ? <strong style={{ fontSize: 16, fontVariantNumeric: "tabular-nums" }}>{money(c.total_value, c.currency)}</strong> : undefined} />
      {q.edit === "1" && c.status === "active"
        ? <ContractForm slug={slug} companies={r.data.companies} patterns={r.data.patterns} contract={c} />
        : <ContractDetail slug={slug} d={r.data} />}
    </div>
  );
}
