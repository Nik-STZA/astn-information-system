// The month's management pack commentary (migration 063): drafted by FP&A or
// the FC, edited here in place, approved by the CFO, read by the pack build.

import PageHeader from "@/shared/ui/PageHeader";
import CommentaryView from "@/modules/finance/components/CommentaryView";
import { fetchCommentary } from "@/modules/finance/lib/commentary";
import { defaultPeriod, isPeriod } from "@/modules/finance/lib/recs";
import page from "@/modules/finance/components/Page.module.css";

export const dynamic = "force-dynamic";

export default async function CommentaryPage({ params: paramsPromise, searchParams: searchParamsPromise }: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ period?: string }>;
}) {
  const { slug } = await paramsPromise;
  const asked = (await searchParamsPromise)?.period;
  const period = isPeriod(asked) ? asked as string : defaultPeriod();
  const r = await fetchCommentary(slug, period);

  return (
    <div className={page.wide}>
      <PageHeader title="Pack commentary"
        sub="The month's commentary for the management pack. Edit the words in place; the figures beside them are for reading. The pack uses the month only once you approve it." />
      {!r.ok ? (
        <div className={page.error} role="alert">
          Could not load the commentary: {/Cannot GET/i.test(r.error) ? "the endpoint is not deployed on finance-api yet." : r.error}
        </div>
      ) : r.data.migration_missing ? (
        <div className={`${page.card} ${page.empty}`}>Pack commentary is built but not switched on: migration 063 has not been applied to the database yet.</div>
      ) : (
        <CommentaryView slug={slug} data={r.data} />
      )}
    </div>
  );
}
