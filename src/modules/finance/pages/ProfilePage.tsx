// Your profile: how you appear on threads, sign-offs and the audit trail
// (finance.people, migration 050). Initials stand in for your name on every
// entry; the name and title show on hover.

import PageHeader from "@/shared/ui/PageHeader";
import { fetchPeople } from "@/modules/finance/lib/asset-schedule";
import ProfileForm from "@/modules/finance/components/ProfileForm";
import styles from "@/modules/finance/components/Page.module.css";

export const dynamic = "force-dynamic";

export default async function ProfilePage({ actorEmail }: { actorEmail: string | null }) {
  const email = (actorEmail ?? "").toLowerCase();
  const people = await fetchPeople().catch(() => null);
  const me = people?.ok ? people.data.people.find((p) => p.email === email) : undefined;
  return (
    <div>
      <PageHeader title="Your profile" sub="How you appear on threads, sign-offs and the audit trail." />
      <section className={`${styles.card} ${styles.pad} ${styles.narrow} ${styles.stack}`} aria-label="Profile">
        <p className={styles.small} style={{ margin: 0 }}>Signed in as {email || "unknown"}. Your sign-in is managed by Google; nothing here changes it.</p>
        {people && !people.ok && people.status !== 503 && <div className={styles.error} role="alert">Could not read your profile: {people.error}</div>}
        <ProfileForm initial={{ display_name: me?.display_name ?? "", initials: me?.initials ?? "", title: me?.title ?? "" }} />
      </section>
    </div>
  );
}
