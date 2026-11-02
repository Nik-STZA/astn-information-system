// Approvals is now part of Review, which lists its folder items with the bills,
// reconciliations and journals waiting on a person. A bookmark to Approvals
// lands on Review. The board itself stays for what Review links to: one folder
// item (?item=REF), and the whole board with its upcoming and finished items
// (?board=1).
import { redirect } from "next/navigation";
import ApprovalsPage from "@/modules/finance/pages/ApprovalsPage";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ item?: string; board?: string }>;
}) {
  const { slug } = await params;
  const q = await searchParams;
  if (!q.item && !q.board) redirect(`/finance/clients/${encodeURIComponent(slug)}/review?kind=approvals`);
  return <ApprovalsPage params={params} />;
}
