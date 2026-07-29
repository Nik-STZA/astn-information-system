import ComingSoon from "@/modules/finance/components/ComingSoon";

export const dynamic = "force-dynamic";

export default function Page({ params }: { params: { slug: string } }) {
  return (
    <ComingSoon
      slug={params.slug}
      tab="settings"
      title="Settings"
      summary="Client specific finance configuration: materiality thresholds, cash floor and close cadence."
    />
  );
}
