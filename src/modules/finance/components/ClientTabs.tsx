// Client-scoped tab bar for the Finance module.
//
// Work and Setup are separated by a divider. Everything client-sensitive lives
// behind these tabs rather than at practice level.

import Link from "next/link";

const WORK = [
  { seg: "approvals", label: "Approvals" },
  { seg: "agents", label: "Agents" },
  { seg: "close", label: "Close" },
  { seg: "reports", label: "Reports" },
  { seg: "diary", label: "Diary" },
  { seg: "open-items", label: "Open items" },
];

const SETUP = [
  { seg: "xero", label: "Xero" },
  { seg: "coa", label: "Chart of accounts" },
  { seg: "settings", label: "Settings" },
];

function Tab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      style={{
        fontFamily: "Manrope, sans-serif",
        fontSize: 12.5,
        fontWeight: active ? 700 : 500,
        lineHeight: 1,
        padding: "8px 11px",
        borderRadius: 6,
        textDecoration: "none",
        whiteSpace: "nowrap",
        color: active ? "#141414" : "var(--sub)",
        background: active ? "#C5A059" : "transparent",
      }}
    >
      {label}
    </Link>
  );
}

export default function ClientTabs({
  slug,
  active,
}: {
  slug: string;
  active: string;
}) {
  const base = `/finance/clients/${slug}`;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        flexWrap: "wrap",
        borderBottom: "1px solid var(--bd)",
        paddingBottom: 10,
        marginBottom: 20,
      }}
    >
      {WORK.map((t) => (
        <Tab key={t.seg} href={`${base}/${t.seg}`} label={t.label} active={active === t.seg} />
      ))}
      <div
        style={{
          width: 1,
          height: 18,
          background: "var(--bd)",
          margin: "0 8px",
          flexShrink: 0,
        }}
      />
      {SETUP.map((t) => (
        <Tab key={t.seg} href={`${base}/${t.seg}`} label={t.label} active={active === t.seg} />
      ))}
    </div>
  );
}
