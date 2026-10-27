"use client";

// Light, Dark or System (follows the device). Stored as "light", "dark" or
// "auto" under stza-theme, which the root layout's inline script applies
// before first paint.

import { useEffect, useState } from "react";

type Theme = "auto" | "light" | "dark";

const OPTIONS: Array<{ value: Theme; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "auto", label: "System" },
];

export default function ThemeToggle() {
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

  return (
    <div role="group" aria-label="Appearance" className="seg" style={{ width: "100%" }}>
      {OPTIONS.map((o) => (
        <button key={o.value} type="button" onClick={() => apply(o.value)} aria-pressed={theme === o.value}
          className={theme === o.value ? "seg-on" : undefined} style={{ flex: "1 1 0" }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
