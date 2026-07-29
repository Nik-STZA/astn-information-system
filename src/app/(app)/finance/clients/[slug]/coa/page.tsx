import ComingSoon from "@/modules/finance/components/ComingSoon";

export const dynamic = "force-dynamic";

export default function Page({ params }: { params: { slug: string } }) {
  return (
    <ComingSoon
      slug={params.slug}
      tab="coa"
      title="Chart of accounts"
      summary="A searchable view of the account mapping already imported for this client. Read only: to change a mapping, edit the source file and re-run the import."
    />
  );
}
