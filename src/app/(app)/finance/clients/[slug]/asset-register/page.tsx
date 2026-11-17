// The asset register now lives on the Fixed assets page (CFO design, 18 Nov 2026).
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/finance/clients/${encodeURIComponent(slug)}/fixed-assets`);
}
