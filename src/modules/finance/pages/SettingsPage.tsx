// Client settings. Financial: the asset registers the client keeps, under the
// client's own names (migration 052). The rest of the client's finance
// configuration (materiality, cash floor, close cadence) is not built yet.

import PageHeader from "@/shared/ui/PageHeader";
import { fetchRegisterSettings } from "@/modules/finance/lib/asset-register";
import RegisterNames from "@/modules/finance/components/RegisterNames";
import styles from "@/modules/finance/components/Page.module.css";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await fetchRegisterSettings(slug);
  const registers = r.ok ? r.data.groupings.filter((g) => g.enabled) : [];
  return (
    <div>
      <PageHeader title="Settings" sub="This client's finance configuration." />
      <section className={`${styles.card} ${styles.pad} ${styles.narrow} ${styles.stack}`} aria-label="Financial">
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Financial</h2>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Asset registers</h3>
        {!r.ok && r.status !== 503 && <div className={styles.error} role="alert">Could not read the asset registers: {r.error}</div>}
        {r.ok && registers.length === 0 && <p className={styles.small} style={{ margin: 0 }}>This client keeps no asset register in os.stza.io.</p>}
        {registers.length > 0 && (
          <>
            <p className={styles.small} style={{ margin: 0 }}>
              What this client calls each register. The name shows on the Fixed assets page and in the workbook. Leave it empty to use the standard name.
            </p>
            <RegisterNames slug={slug} registers={registers} />
          </>
        )}
        <p className={styles.small} style={{ margin: 0, color: "var(--sub)" }}>Still to come here: materiality thresholds, the cash floor and the close cadence.</p>
      </section>
    </div>
  );
}
