// One VAT return: drop in each company's Xero export, see the checks, the group
// return and the import file, then the representative's export after the
// import to confirm it. ?ledger=1 also ties each company's VAT control
// account in Xero to its return (it reads Xero, so it is asked for).

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import PageHeader from "@/shared/ui/PageHeader";
import VatReturnView from "@/modules/finance/components/VatReturnView";
import { fetchVatReturn, periodLabel, STATUS_LABEL } from "@/modules/finance/lib/vat";
import page from "@/modules/finance/components/Page.module.css";

export const dynamic = "force-dynamic";

export default async function VatReturnPage({ params, searchParams }: {
  params: Promise<{ slug: string; id: string }>;
  searchParams?: Promise<{ ledger?: string }>;
}) {
  const { slug, id } = await params;
  const q = (await searchParams) ?? {};
  const ledger = q.ledger === "1";
  const r = await fetchVatReturn(slug, id, ledger);
  const base = `/finance/clients/${encodeURIComponent(slug)}/vat`;
  return (
    <div className={page.wide}>
      <Link prefetch={false} className={page.back} href={base}><ArrowLeft size={14} aria-hidden="true" />VAT returns</Link>
      {!r.ok ? (
        <div className={page.error} role="alert">Could not load the return: {r.error}</div>
      ) : (
        <>
          <PageHeader title={`VAT return ${periodLabel(r.data.return.period_start, r.data.return.period_end)}`}
            sub={<>VAT {r.data.return.vat_number}{r.data.return.kind === "group" ? " (group)" : ""}. {STATUS_LABEL[r.data.return.status]}.</>} />
          <VatReturnView slug={slug} data={r.data} ledgerHref={ledger ? null : `${base}/${id}?ledger=1`} />
        </>
      )}
    </div>
  );
}
