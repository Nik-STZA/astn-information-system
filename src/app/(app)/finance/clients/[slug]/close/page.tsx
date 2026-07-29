import ComingSoon from "@/modules/finance/components/ComingSoon";

export const dynamic = "force-dynamic";

export default function Page({ params }: { params: { slug: string } }) {
  return (
    <ComingSoon
      slug={params.slug}
      tab="close"
      title="Close status"
      summary="Month-end close progress: which stage the pipeline has reached, when it was triggered and when each stage completed."
    />
  );
}
