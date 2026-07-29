import ComingSoon from "@/modules/finance/components/ComingSoon";

export const dynamic = "force-dynamic";

export default function Page({ params }: { params: { slug: string } }) {
  return (
    <ComingSoon
      slug={params.slug}
      tab="reports"
      title="Reports"
      summary="An archive of past management packs and board packs, with the period each covers."
    />
  );
}
