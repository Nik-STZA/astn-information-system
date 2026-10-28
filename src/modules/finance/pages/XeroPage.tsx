// Xero connections, client scoped.
//
// Every secret on this page is masked by default and follows the reveal-toggle
// pattern in brief section 8.3. Status is derived from whether a secret exists,
// never by reading its value.

import { Link2 } from "lucide-react";
import PageHeader from "@/shared/ui/PageHeader";
import SensitiveField from "@/modules/finance/components/SensitiveField";
import OrganisationPicker from "@/modules/finance/components/OrganisationPicker";
import { fetchXeroStatus, type XeroConnection } from "@/modules/finance/lib/secrets";
import styles from "@/modules/finance/components/Page.module.css";

export const dynamic = "force-dynamic";

// Stored as ISO timestamps; shown as "16 October 2026, 16:30" (UK time).
function fmtWhen(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
  return `${day}, ${time}`;
}

function Status({ connected }: { connected: boolean }) {
  return (
    <span className={`${styles.status} ${styles[connected ? "s-green" : "s-neutral"]}`}>
      <span className={styles.dot} />
      {connected ? "Connected" : "Not connected"}
    </span>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className={styles.metaLabel}>{label}</div>
      <div className={styles.metaValue}>{value}</div>
    </div>
  );
}

function ConnectButton({ slug, conn }: { slug: string; conn: XeroConnection }) {
  return (
    <a
      href={`/api/finance/${encodeURIComponent(slug)}/xero/${encodeURIComponent(conn.slug)}/connect`}
      className={conn.connected ? "btn-secondary" : "btn-primary"}
    >
      <Link2 size={15} aria-hidden="true" />
      {conn.connected ? "Reconnect" : "Connect to Xero"}
    </a>
  );
}

function EntityCard({ slug, conn }: { slug: string; conn: XeroConnection }) {
  return (
    <section className={styles.card} aria-label={conn.name}>
      <div className={styles.cardHead} style={{ flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <h2>
            {conn.name}
            {conn.role && <span style={{ fontWeight: 400, color: "var(--sub)" }}> · {conn.role}</span>}
          </h2>
          {conn.legalName && <div className={styles.small}>{conn.legalName}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Status connected={conn.connected} />
          <ConnectButton slug={slug} conn={conn} />
        </div>
      </div>

      <div style={{ padding: "12px 16px" }}>
        <div className={styles.meta}>
          <Meta label="Xero organisation" value={conn.tenantName ?? "Not set"} />
          <Meta label="Tenant id" value={conn.tenantId ? "Recorded" : "Not recorded"} />
          <Meta label="Pipeline config" value={conn.configName ?? "-"} />
          <Meta label="Connected" value={fmtWhen(conn.connectedAt)} />
          <Meta label="Last refreshed" value={fmtWhen(conn.lastRefreshedAt)} />
        </div>

        <div style={{ margin: "12px 0 8px" }}>
          <OrganisationPicker
            slug={slug}
            entity={conn.slug}
            entityName={conn.name}
            current={conn.tenantName}
          />
        </div>

        <SensitiveField label="Client id" slug={slug} entity={conn.slug} field="client_id" available={conn.connected} />
        <SensitiveField label="Client secret" slug={slug} entity={conn.slug} field="client_secret" available={conn.connected} />
        <SensitiveField label="Refresh token" slug={slug} entity={conn.slug} field="refresh_token" available={conn.connected} />
      </div>
    </section>
  );
}

export default async function XeroPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: { connected?: string; error?: string };
}) {
  const status = await fetchXeroStatus(params.slug);

  return (
    <div>
      <PageHeader title="Xero connections" sub="Which Xero organisation each company uses, and whether the connection is live." />

      {searchParams?.connected && (
        <div className={styles.ok} role="status" style={{ marginBottom: 16 }}>
          Connected to {searchParams.connected}.
        </div>
      )}
      {searchParams?.error && (
        <div className={styles.error} role="alert" style={{ marginBottom: 16 }}>{searchParams.error}</div>
      )}

      {status.error && (
        <div className={styles.error} role="alert" style={{ marginBottom: 16 }}>
          <div className={styles.errorTitle}>Could not read the connections</div>
          {status.error}
        </div>
      )}

      {!status.appConfigured && !status.error && (
        <div className={`${styles.card} ${styles.pad} ${styles.narrow}`} style={{ fontSize: 13, lineHeight: 1.6, color: "var(--sub)", marginBottom: 16 }}>
          The practice Xero application is not configured yet. One app serves every
          client: its id and secret are stored once, and each company is then
          authorised separately to produce its own refresh token.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 980 }}>
        {status.connections.map((c) => (
          <EntityCard key={c.slug} slug={params.slug} conn={c} />
        ))}
      </div>
    </div>
  );
}
