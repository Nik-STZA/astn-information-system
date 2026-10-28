"use client";

// Chooses which Xero organisation an entity maps to.
//
// Xero offers no picker for organisations an app is already connected to, so
// the choice has to be made here. Getting it wrong points an entity at another
// company's ledger, so the current organisation is always shown, not only the
// control to change it.
//
// The list is fetched when the picker is opened rather than on page load,
// because listing organisations costs a Xero token refresh and Xero rotates
// the refresh token on every one.

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./Page.module.css";

interface Organisation {
  tenantId: string;
  tenantName: string;
}

export default function OrganisationPicker({
  slug,
  entity,
  entityName,
  current,
}: {
  slug: string;
  entity: string;
  entityName: string;
  current: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [orgs, setOrgs] = useState<Organisation[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setOpen(true);
    if (orgs) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/xero/organisations`);
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Could not load organisations");
      else setOrgs(body.data as Organisation[]);
    } catch {
      setError("Could not load organisations");
    } finally {
      setBusy(false);
    }
  }

  async function choose(tenantId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/finance/${encodeURIComponent(slug)}/xero/${encodeURIComponent(entity)}/organisation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenantId }),
        }
      );
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Could not set the organisation");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not set the organisation");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={load} className={styles.miniBtn}>
        {current ? "Change organisation" : "Choose organisation"}
      </button>
    );
  }

  return (
    <div className={styles.card} style={{ padding: "12px 14px", background: "var(--pg)", maxWidth: 420 }}>
      <div className={styles.small} style={{ marginBottom: 8 }}>
        Which Xero organisation is {entityName}?
      </div>

      {busy && !orgs && <div className={styles.small}>Loading…</div>}

      {error && <div className={styles.warn} style={{ marginBottom: 8 }}>{error}</div>}

      {orgs?.map((o) => {
        const isCurrent = o.tenantName === current;
        return (
          <button
            key={o.tenantId}
            type="button"
            disabled={busy || isCurrent}
            onClick={() => choose(o.tenantId)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              font: `${isCurrent ? 600 : 400} 13px var(--font-sans)`,
              padding: "8px 10px",
              marginBottom: 4,
              borderRadius: 8,
              border: `1px solid ${isCurrent ? "var(--brand-gold)" : "var(--bd)"}`,
              background: isCurrent ? "var(--accent-bg)" : "var(--pnl)",
              color: "var(--tx)",
              cursor: isCurrent ? "default" : "pointer",
            }}
          >
            {o.tenantName}
            {isCurrent && <span style={{ fontWeight: 400, color: "var(--sub)" }}> · current</span>}
          </button>
        );
      })}

      <button
        type="button"
        className={styles.miniBtn}
        onClick={() => { setOpen(false); setError(null); }}
        style={{ marginTop: 6 }}
      >
        Cancel
      </button>
    </div>
  );
}
