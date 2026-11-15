// Adding a contract (15 Nov 2026): from a PDF's read (?upload=<id>), or by hand.

import Link from "next/link";
import PageHeader from "@/shared/ui/PageHeader";
import ContractForm from "@/modules/finance/components/ContractForm";
import { fetchContracts } from "@/modules/finance/lib/contracts";
import page from "@/modules/finance/components/Page.module.css";

export const dynamic = "force-dynamic";

export default async function ContractNewPage({ params: paramsPromise, searchParams: searchParamsPromise }: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ upload?: string }>;
}) {
  const { slug } = await paramsPromise;
  const q = (await searchParamsPromise) ?? {};
  const r = await fetchContracts(slug);
  const back = `/finance/clients/${encodeURIComponent(slug)}/contracts`;
  if (!r.ok || r.data.migration_missing) {
    return (
      <div>
        <Link prefetch={false} className={page.back} href={back}>&larr; Contracts</Link>
        <div className={page.error} role="alert">{r.ok ? "Contracts are waiting for a database change (migration 047)." : `Could not load: ${r.error}`}</div>
      </div>
    );
  }
  const upload = q.upload ? r.data.uploads.find((u) => u.id === q.upload && u.read_state === "read") ?? null : null;
  return (
    <div>
      <Link prefetch={false} className={page.back} href={back}>&larr; Contracts</Link>
      <PageHeader title={upload ? "Check and add a contract" : "Add a contract"}
        sub="Finance terms only: who, amounts, dates, renewal, notice and what makes each payment due." />
      {q.upload && !upload
        ? <div className={page.error} role="alert">That read is not waiting any more: it may already have been added or removed.</div>
        : <ContractForm slug={slug} companies={r.data.companies} patterns={r.data.patterns}
            proposed={upload?.proposed ?? null} uploadId={upload?.id ?? null} fileName={upload?.file_name ?? null} />}
    </div>
  );
}
