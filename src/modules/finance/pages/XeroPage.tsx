// Xero connections, client scoped.
//
// Every secret on this page is masked by default and follows the reveal-toggle
// pattern in brief section 8.3. Status is derived from whether a secret exists,
// never by reading its value.

import PageHeader from "@/shared/ui/PageHeader";
import ClientTabs from "@/modules/finance/components/ClientTabs";
import SensitiveField from "@/modules/finance/components/SensitiveField";
import OrganisationPicker from "@/modules/finance/components/OrganisationPicker";
import { fetchXeroStatus, type XeroConnection } from "@/modules/finance/lib/secrets";

export const dynamic = "force-dynamic";

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "Manrope, sans-serif",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: ".04em",
        textTransform: "uppercase",
        color: connected ? "var(--success-green)" : "var(--sub)",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: connected ? "var(--success-green)" : "transparent",
          border: connected ? "none" : "1px solid var(--sub)",
        }}
      />
      {connected ? "Connected" : "Not connected"}
    </span>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontFamily: "Manrope, sans-serif",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: ".07em",
          textTransform: "uppercase",
          color: "var(--sub)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "Manrope, sans-serif",
          fontSize: 12.5,
          color: "var(--tx)",
          marginTop: 2,
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function ConnectButton({ slug, conn }: { slug: string; conn: XeroConnection }) {
  return (
    <a
      href={`/api/finance/${encodeURIComponent(slug)}/xero/${encodeURIComponent(conn.slug)}/connect`}
      style={{
        fontFamily: "Manrope, sans-serif",
        fontSize: 12,
        fontWeight: 700,
        padding: "7px 14px",
        borderRadius: 6,
        textDecoration: "none",
        whiteSpace: "nowrap",
        color: conn.connected ? "var(--sub)" : "#141414",
        background: conn.connected ? "transparent" : "#C5A059",
        border: conn.connected ? "1px solid var(--bd)" : "1px solid #C5A059",
      }}
    >
      {conn.connected ? "Reconnect" : "Connect to Xero"}
    </a>
  );
}

function EntityCard({ slug, conn }: { slug: string; conn: XeroConnection }) {
  return (
    <section
      style={{
        background: "var(--pnl)",
        border: "1px solid var(--bd)",
        borderRadius: 10,
        padding: "16px 18px",
        marginBottom: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "Manrope, sans-serif",
              fontSize: 15,
              fontWeight: 800,
              color: "var(--tx)",
            }}
          >
            {conn.name}
            {conn.role && (
              <span style={{ fontWeight: 500, fontSize: 12, color: "var(--sub)" }}>
                {" "}
                · {conn.role}
              </span>
            )}
          </div>
          {conn.legalName && (
            <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 12, color: "var(--sub)" }}>
              {conn.legalName}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <StatusDot connected={conn.connected} />
          <ConnectButton slug={slug} conn={conn} />
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
          marginBottom: 6,
        }}
      >
        <Meta label="Xero organisation" value={conn.tenantName ?? "not set"} />
        <Meta label="Tenant id" value={conn.tenantId ? "recorded" : "not recorded"} />
        <Meta label="Pipeline config" value={conn.configName ?? "-"} />
        <Meta label="Connected" value={conn.connectedAt ?? "-"} />
        <Meta label="Last refreshed" value={conn.lastRefreshedAt ?? "-"} />
      </div>

      <div style={{ margin: "12px 0 4px" }}>
        <OrganisationPicker
          slug={slug}
          entity={conn.slug}
          entityName={conn.name}
          current={conn.tenantName}
        />
      </div>

      <SensitiveField
        label="Client id"
        slug={slug}
        entity={conn.slug}
        field="client_id"
        available={conn.connected}
      />
      <SensitiveField
        label="Client secret"
        slug={slug}
        entity={conn.slug}
        field="client_secret"
        available={conn.connected}
      />
      <SensitiveField
        label="Refresh token"
        slug={slug}
        entity={conn.slug}
        field="refresh_token"
        available={conn.connected}
      />
    </section>
  );
}

function Banner({ tone, children }: { tone: "good" | "bad"; children: React.ReactNode }) {
  const colour = tone === "good" ? "var(--success-green)" : "var(--warning-amber)";
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 8,
        border: `1px solid ${colour}`,
        color: colour,
        fontFamily: "Manrope, sans-serif",
        fontSize: 13,
        marginBottom: 18,
      }}
    >
      {children}
    </div>
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
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: "32px 24px" }}>
      <PageHeader section="STZA · Finance" title="Xero connections" />
      <ClientTabs slug={params.slug} active="xero" />

      {searchParams?.connected && (
        <Banner tone="good">Connected to {searchParams.connected}.</Banner>
      )}
      {searchParams?.error && <Banner tone="bad">{searchParams.error}</Banner>}

      {status.error && (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 8,
            border: "1px solid var(--warning-amber)",
            color: "var(--warning-amber)",
            fontFamily: "Manrope, sans-serif",
            fontSize: 13,
            marginBottom: 18,
          }}
        >
          {status.error}
        </div>
      )}

      {!status.appConfigured && !status.error && (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 8,
            border: "1px dashed var(--empty-border)",
            background: "var(--empty-bg)",
            color: "var(--sub)",
            fontFamily: "Manrope, sans-serif",
            fontSize: 13,
            lineHeight: 1.6,
            marginBottom: 18,
          }}
        >
          The practice Xero application is not configured yet. One app serves every
          client: its id and secret are stored once, and each entity is then
          authorised separately to produce its own refresh token.
        </div>
      )}

      {status.connections.map((c) => (
        <EntityCard key={c.slug} slug={params.slug} conn={c} />
      ))}
    </div>
  );
}
