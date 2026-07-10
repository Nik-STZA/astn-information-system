"use client";

import { useEffect, useState } from "react";

type Theme = "auto" | "light" | "dark";

const LABELS: Record<Theme, string> = {
  auto: "Auto",
  light: "Light",
  dark: "Dark",
};

const ICONS: Record<Theme, string> = {
  auto: "◐",
  light: "☀",
  dark: "☾",
};

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("auto");

  /* Sync from DOM on mount (the inline script already set data-theme) */
  useEffect(() => {
    const stored = document.documentElement.getAttribute("data-theme");
    if (stored === "light" || stored === "dark" || stored === "auto") {
      setTheme(stored);
    }
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("stza-theme", next);
    } catch {
      /* localStorage unavailable — graceful fallback */
    }
  }

  return (
    <div
      style={{
        display: "inline-flex",
        borderRadius: 6,
        border: "1px solid rgba(255,255,255,.12)",
        overflow: "hidden",
      }}
    >
      {(["auto", "light", "dark"] as Theme[]).map((t) => {
        const active = theme === t;
        return (
          <button
            key={t}
            onClick={() => apply(t)}
            title={`${LABELS[t]} theme`}
            style={{
              fontFamily: "'Manrope', sans-serif",
              fontSize: 10,
              fontWeight: active ? 700 : 500,
              lineHeight: 1,
              padding: "5px 8px",
              border: "none",
              cursor: "pointer",
              color: active ? "#141414" : "#8E9196",
              background: active ? "#C5A059" : "transparent",
              transition: "color .15s, background .15s",
            }}
            onMouseEnter={(e) => {
              if (!active) {
                e.currentTarget.style.color = "#F4F1EA";
                e.currentTarget.style.background = "rgba(255,255,255,.06)";
              }
            }}
            onMouseLeave={(e) => {
              if (!active) {
                e.currentTarget.style.color = "#8E9196";
                e.currentTarget.style.background = "transparent";
              }
            }}
          >
            {ICONS[t]}
          </button>
        );
      })}
    </div>
  );
}
