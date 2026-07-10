import { fieldLabel, type OrganizationChange } from "@/lib/data/registry-shared";

type Props = {
  changes: OrganizationChange[];
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Collapsible audit trail for an organisation.
 *
 * Server component reading from organization_changes; the table is
 * append-only via RLS (only Nik can SELECT) and inserts are gated by
 * the SECURITY DEFINER trigger on organizations.
 */
export default function ChangeHistory({ changes }: Props) {
  if (changes.length === 0) {
    return (
      <div style={{
        background: "var(--pnl)", border: "1px solid var(--bd)", borderRadius: 10,
        padding: "20px 24px",
        boxShadow: "0 1px 3px rgba(26,28,30,.04), 0 1px 2px rgba(26,28,30,.03)",
      }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--tx)", margin: 0 }}>
          Change history
        </h2>
        <p style={{ fontSize: 12.5, fontWeight: 500, color: "var(--sub)", marginTop: 8 }}>
          No edits recorded for this organisation yet. The audit trail starts when you make your first change.
        </p>
      </div>
    );
  }

  return (
    <details
      open
      style={{
        background: "var(--pnl)", border: "1px solid var(--bd)", borderRadius: 10,
        padding: "20px 24px",
        boxShadow: "0 1px 3px rgba(26,28,30,.04), 0 1px 2px rgba(26,28,30,.03)",
      }}
    >
      <summary style={{
        cursor: "pointer", display: "flex", alignItems: "center",
        justifyContent: "space-between", listStyle: "none",
      }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--tx)", margin: 0 }}>
          Change history
        </h2>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--sub)" }}>
          {changes.length} {changes.length === 1 ? "entry" : "entries"} ▾
        </span>
      </summary>

      <ul style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 16, listStyle: "none", padding: 0 }}>
        {changes.map((change) => (
          <li key={change.id} style={{ borderLeft: "2px solid #C5A059", paddingLeft: 16 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--tx)" }}>
                {change.changedBy}
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--sub)" }}>
                {formatTimestamp(change.changedAt)}
              </span>
            </div>
            {change.fields.length === 0 ? (
              <p style={{ fontSize: 12.5, fontWeight: 500, color: "var(--sub)", marginTop: 4 }}>
                Saved with no field changes recorded.
              </p>
            ) : (
              <dl style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6, padding: 0 }}>
                {change.fields.map(({ field, oldValue, newValue }) => (
                  <div
                    key={field}
                    style={{
                      display: "grid", gridTemplateColumns: "10rem 1fr",
                      gap: "2px 12px", fontSize: 12.5,
                    }}
                  >
                    <dt style={{
                      fontWeight: 700, textTransform: "uppercase",
                      letterSpacing: ".04em", color: "var(--sub)",
                    }}>
                      {fieldLabel(field)}
                    </dt>
                    <dd style={{ color: "var(--tx)", wordBreak: "break-word", margin: 0 }}>
                      <span style={{ color: "#CC0000", textDecoration: "line-through", opacity: 0.8 }}>
                        {oldValue}
                      </span>
                      <span style={{ margin: "0 8px", color: "var(--sub)" }}>→</span>
                      <span style={{ color: "#2E7D32", fontWeight: 700 }}>{newValue}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
