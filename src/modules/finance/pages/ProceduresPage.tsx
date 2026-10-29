// One client's procedures: STZA's standard set, how this client's rules change
// each one, and the procedures only this client has. Rules are written and
// approved here; only an approved rule reaches an agent.

import PageHeader from "@/shared/ui/PageHeader";
import ProceduresView from "@/modules/finance/components/ProceduresView";
import { fetchProcedure, fetchProcedures } from "@/modules/finance/lib/procedures";
import styles from "@/modules/finance/components/Page.module.css";

export const dynamic = "force-dynamic";

export default async function ProceduresPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: { p?: string };
}) {
  const { slug } = params;
  const name = searchParams?.p && /^[a-z0-9-]+$/.test(searchParams.p) ? searchParams.p : null;
  const [list, detail] = await Promise.all([fetchProcedures(slug), name ? fetchProcedure(slug, name) : Promise.resolve(null)]);
  const error = !list.ok ? list.error : detail && !detail.ok && detail.status !== 404 ? detail.error : null;

  return (
    <div>
      <PageHeader title="Procedures" sub="How the agents do the work for this client: STZA's standard procedures and this client's rules." />
      {error || !list.ok ? (
        <div className={styles.error} role="alert">
          <div className={styles.errorTitle}>Could not load the procedures</div>
          {/Cannot GET/i.test(error ?? "") ? "The procedures endpoints are not deployed on finance-api yet." : error}
        </div>
      ) : (
        <ProceduresView
          key={name ?? "list"}
          slug={slug}
          list={list.data}
          detail={detail?.ok ? detail.data : null}
          missing={Boolean(name && detail && !detail.ok)}
        />
      )}
    </div>
  );
}
