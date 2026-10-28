// Placeholder for a client tab that is not built yet.
//
// The tab bar shows the full set from the outset so the shape of the module is
// visible, which means the unbuilt ones need somewhere to land. A page saying
// what is coming is honest; a 404 just looks broken.

import { Construction } from "lucide-react";
import PageHeader from "@/shared/ui/PageHeader";
import styles from "./Page.module.css";

export default function ComingSoon({
  title,
  summary,
}: {
  slug: string;
  tab: string;
  title: string;
  summary: string;
}) {
  return (
    <div>
      <PageHeader title={title} />

      <div className={`${styles.card} ${styles.pad} ${styles.narrow} ${styles.stack}`}>
        <span className={`${styles.status} ${styles["s-neutral"]}`} style={{ alignSelf: "flex-start" }}>
          <Construction size={13} aria-hidden="true" />
          Not built yet
        </span>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--tx)", margin: 0 }}>{summary}</p>
      </div>
    </div>
  );
}
