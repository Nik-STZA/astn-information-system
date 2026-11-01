import ComingSoon from "@/modules/finance/components/ComingSoon";

export const dynamic = "force-dynamic";

export default async function Page(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  return (
    <ComingSoon
      slug={params.slug}
      tab="settings"
      title="Settings"
      summary="Client specific finance configuration: materiality thresholds, cash floor and close cadence."
    />
  );
}
