// Section label above page title, the convention used across the platform.
// Reads theme tokens rather than hard-coding colours, so it works in light,
// dark and auto.

export default function PageHeader({
  section,
  title,
  actions,
}: {
  section: string;
  title: string;
  actions?: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div
        style={{
          fontFamily: "Manrope, sans-serif",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          color: "var(--sub)",
        }}
      >
        {section}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          marginTop: 4,
        }}
      >
        <h1
          style={{
            fontFamily: "Manrope, sans-serif",
            fontSize: 26,
            fontWeight: 800,
            color: "var(--tx)",
            margin: 0,
          }}
        >
          {title}
        </h1>
        {actions}
      </div>
    </div>
  );
}
