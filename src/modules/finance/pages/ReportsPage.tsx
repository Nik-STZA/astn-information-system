// Reports for one client.
//
// Each report is a card. A card that is not built yet says what it will do
// rather than disappearing, for the same reason the unbuilt tabs do.

import Link from "next/link";
import { FileSpreadsheet, Hourglass } from "lucide-react";
import PageHeader from "@/shared/ui/PageHeader";
import styles from "@/modules/finance/components/Page.module.css";

export const dynamic = "force-dynamic";

export default function ReportsPage({ params }: { params: { slug: string } }) {
  const base = `/finance/clients/${params.slug}/reports`;
  const live = <span className={`${styles.status} ${styles["s-green"]}`}><span className={styles.dot} />Live</span>;
  return (
    <div>
      <PageHeader title="Reports" sub="Packs and reports for this client." />

      <div className={styles.tiles}>
        <Link href={`${base}/aged-payables`} className={`${styles.card} ${styles.tile}`}>
          <div className={styles.tileHead}>
            <span className={styles.tileTitle}><Hourglass size={16} aria-hidden="true" />AP ageing</span>
            {live}
          </div>
          <p className={styles.tileText}>
            Amounts owed to suppliers by age, for a single entity or combined across the
            group, straight from Xero. Export to CSV.
          </p>
        </Link>

        <Link href={`${base}/management-pack`} className={`${styles.card} ${styles.tile}`}>
          <div className={styles.tileHead}>
            <span className={styles.tileTitle}><FileSpreadsheet size={16} aria-hidden="true" />Management pack</span>
            {live}
          </div>
          <p className={styles.tileText}>
            Build the month-end management pack and board pack for a chosen month. Saved as a
            draft to the Finance shared drive, with past builds listed here.
          </p>
        </Link>
      </div>
    </div>
  );
}
