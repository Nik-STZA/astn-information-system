// A page's title, one line on what it is for, and its actions on the right,
// as on Overview and Work (redesign, 27 Oct 2026). The h1 takes the global
// heading scale; colours come from theme tokens, so it works light and dark.

export default function PageHeader({
  title,
  sub,
  actions,
}: {
  title: string;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
      <div style={{ minWidth: 0 }}>
        <h1>{title}</h1>
        {sub && <p style={{ color: "var(--sub)", fontSize: 13, margin: "4px 0 0" }}>{sub}</p>}
      </div>
      {actions && <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{actions}</div>}
    </div>
  );
}
