import Link from "next/link";
import RegistryCandidateCard from "@/components/RegistryCandidateCard";
import RegistryCandidateSubmit from "@/components/RegistryCandidateSubmit";
import RegistryCandidatesRefresh from "@/components/RegistryCandidatesRefresh";
import styles from "@/components/RegistryCandidates.module.css";
import { fetchCandidates, fetchRegistryReference } from "@/lib/data/registry-candidates";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Organisations submitted for the registry. The registry reviewer agent checks
// each for duplicates, researches it and proposes a record; nothing is added
// until it is approved here (finance-api/lib/registry-candidates-routes.js).
export default async function RegistryCandidatesPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const view = searchParams.view === "done" ? "done" : "open";
  const [list, reference] = await Promise.all([fetchCandidates(view), fetchRegistryReference()]);
  const waiting = list.data.some((c) => c.status === "queued" || c.status === "reviewing");
  const ready = list.data.filter((c) => c.status === "proposed").length;

  return (
    <div className={styles.wrap}>
      <div>
        <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Registry candidates</h1>
        <p className={styles.intro}>
          Submit organisations you think belong in the AfricanSTN registry. The reviewer checks each one against the
          registry, researches it on the web and proposes a record with its evidence. You decide what is added.
        </p>
      </div>

      {list.migrationMissing ? (
        <div className={`${styles.message} ${styles.error}`}>
          The candidates table is not set up yet (migration 044). Submissions will fail until it is applied.
        </div>
      ) : null}
      {list.error ? <div className={`${styles.message} ${styles.error}`}>{list.error}</div> : null}

      <RegistryCandidateSubmit />

      <div className={styles.panelHead}>
        <nav className={styles.tabs} aria-label="Candidate lists">
          <Link href="/registry/candidates" className={`${styles.tab} ${view === "open" ? styles.tabOn : ""}`}>Open</Link>
          <Link href="/registry/candidates?view=done" className={`${styles.tab} ${view === "done" ? styles.tabOn : ""}`}>Decided</Link>
        </nav>
        <span className={styles.count}>
          {view === "open"
            ? `${list.data.length} open${ready ? `, ${ready} ready for you` : ""}${waiting ? ", reviewer working" : ""}`
            : `${list.data.length} most recent`}
        </span>
      </div>

      {list.data.length ? (
        <div className={styles.list}>
          {list.data.map((c) => <RegistryCandidateCard key={c.id} candidate={c} reference={reference} />)}
        </div>
      ) : (
        <div className="card-empty" style={{ padding: 16, fontSize: 13 }}>
          {view === "open" ? "Nothing open. Submit a candidate above." : "Nothing decided yet."}
        </div>
      )}

      <RegistryCandidatesRefresh active={view === "open" && waiting} />
    </div>
  );
}
