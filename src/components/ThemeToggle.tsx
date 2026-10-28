"use client";

// Light, Dark or System (follows the device), as three icons. Stored as
// "light", "dark" or "auto" under stza-theme, which the root layout's inline
// script applies before first paint. In the collapsed sidebar it is one icon
// that steps through the three.

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";

type Theme = "auto" | "light" | "dark";

const OPTIONS: Array<{ value: Theme; label: string; icon: LucideIcon }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "auto", label: "System (follows the device)", icon: Monitor },
];

const box: React.CSSProperties = {
  display: "inline-flex", gap: 2, padding: 3, border: "1px solid var(--bd)", borderRadius: 999, background: "var(--pg)",
};
const btn = (on: boolean): React.CSSProperties => ({
  width: 32, height: 28, border: 0, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center",
  cursor: "pointer", background: on ? "var(--tx)" : "transparent", color: on ? "var(--pnl)" : "var(--sub)",
});

export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>("auto");

  // Sync from the DOM on mount (the inline script already set data-theme).
  useEffect(() => {
    const stored = document.documentElement.getAttribute("data-theme");
    if (stored === "light" || stored === "dark" || stored === "auto") setTheme(stored);
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("stza-theme", next);
    } catch {
      /* localStorage unavailable: the choice lasts this page only */
    }
  }

  if (compact) {
    const i = OPTIONS.findIndex((o) => o.value === theme);
    const cur = OPTIONS[i < 0 ? 2 : i];
    const next = OPTIONS[(i + 1) % OPTIONS.length];
    const Icon = cur.icon;
    return (
      <button type="button" onClick={() => apply(next.value)} style={{ ...btn(false), width: 44, height: 36, alignSelf: "center" }}
        aria-label={`Appearance: ${cur.label}. Switch to ${next.label}`} title={`Appearance: ${cur.label}`}>
        <Icon size={16} aria-hidden="true" />
      </button>
    );
  }

  return (
    <div role="group" aria-label="Appearance" style={{ ...box, alignSelf: "flex-start", marginLeft: 4 }}>
      {OPTIONS.map((o) => {
        const Icon = o.icon;
        const on = theme === o.value;
        return (
          <button key={o.value} type="button" onClick={() => apply(o.value)} aria-pressed={on} aria-label={o.label} title={o.label} style={btn(on)}>
            <Icon size={16} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
