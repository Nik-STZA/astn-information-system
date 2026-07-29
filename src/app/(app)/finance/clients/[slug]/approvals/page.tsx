import ComingSoon from "@/modules/finance/components/ComingSoon";

export const dynamic = "force-dynamic";

export default function Page({ params }: { params: { slug: string } }) {
  return (
    <ComingSoon
      slug={params.slug}
      tab="approvals"
      title="Approvals"
      summary="The approval queue is the next phase. It will show every item waiting on a decision, grouped by state, with approve, send back and reject actions that write to the audit trail and post to Xero."
    />
  );
}
