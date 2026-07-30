// The approval queue. The item's state comes from the folder it sits in, so
// nothing on this page decides where something belongs.

import { Suspense } from "react";
import PageHeader from "@/shared/ui/PageHeader";
import ClientTabs from "@/modules/finance/components/ClientTabs";
import ApprovalsBoard from "@/modules/finance/components/ApprovalsBoard";
import { fetchWipItems, type WipItemRow } from "@/modules/finance/lib/api";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage({ params }: { params: { slug: string } }) {
  let items: WipItemRow[] = [];
  let error: string | null = null;

  try {
    items = await fetchWipItems(params.slug);
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load the queue";
  }

  const awaiting = items.filter((i) => i.panel === "awaiting-decision").length;

  return (
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: "32px 24px" }}>
      <PageHeader section="STZA · Finance" title="Approvals" />
      <ClientTabs slug={params.slug} active="approvals" />

      {error ? (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 8,
            border: "1px solid var(--warning-amber)",
            color: "var(--warning-amber)",
            fontFamily: "Manrope, sans-serif",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : (
        <>
          <p
            style={{
              fontFamily: "Manrope, sans-serif",
              fontSize: 13,
              color: "var(--sub)",
              margin: "0 0 18px",
            }}
          >
            {awaiting} awaiting your decision, {items.length} in progress.
          </p>
          <Suspense fallback={null}>
            <ApprovalsBoard slug={params.slug} items={items} />
          </Suspense>
        </>
      )}
    </div>
  );
}
