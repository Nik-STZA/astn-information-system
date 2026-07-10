import type { Config } from "tailwindcss";

/**
 * Tailwind configuration for the AfricanSTN information system.
 *
 * Reskin July 2026 — designer deliverables.
 *
 * Brand tokens:
 *   - Primary: Brand Dark #1A1C1E, Brand Gold #C5A059
 *   - Page: #EFE8DA (warm off-white), Cards: #FFFFFF with #E4D9C4 border
 *   - Empty states: #F7F2E9 bg, dashed #D9CDB4 border, #B9B2A2 muted text
 *   - Functional: Alert Red #CC0000, Warning Amber #CC7700, Success Green #2E7D32
 *   - Extended: Risk Red #B4432C, Status Blue #3E6B8E, Gold Dark #B08D3F
 *
 * Typography: Manrope (Google Fonts, 400–800).
 *
 * Theme: CSS custom properties defined in globals.css with light/dark palettes
 * from the Index design. The Tailwind tokens below are static references;
 * theme-sensitive surfaces use var(--pg), var(--pnl), var(--bd), var(--tx),
 * var(--sub), var(--cardhover) instead.
 */
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Primary brand colours
        "brand-dark": "#1A1C1E",
        "brand-gold": "#C5A059",
        // Secondary palette
        "warm-grey": "#8E9196",
        "near-black": "#0F1113",
        "warm-light": "#F5F0E8",
        "gold-border": "#D4C5A9",
        // Reskin additions
        "page-bg": "#EFE8DA",
        "card-border": "#E4D9C4",
        "empty-bg": "#F7F2E9",
        "empty-border": "#D9CDB4",
        "empty-text": "#B9B2A2",
        "gold-dark": "#B08D3F",
        "label-text": "#55524C",
        "table-header": "#F6F1E7",
        "card-hover": "#FAF6EE",
        // Functional colours
        "alert-red": "#CC0000",
        "warning-amber": "#CC7700",
        "success-green": "#2E7D32",
        // Extended functional (reskin)
        "risk-red": "#B4432C",
        "status-blue": "#3E6B8E",
        // Nav colours
        "nav-bg": "#0F1113",
        "nav-label": "#8F7A45",
        "nav-link": "#C7C4BD",
        "nav-link-hover": "#F4F1EA",
        "nav-active-bg": "#C5A059",
        "nav-active-text": "#141414",
      },
      fontFamily: {
        sans: ["Manrope", "sans-serif"],
        serif: ["Newsreader", "Georgia", "serif"],
        mono: ["Consolas", "Monaco", "Courier New", "monospace"],
      },
      fontSize: {
        // Reskin type scale from designer deliverables
        "display": ["28px", { lineHeight: "1.1", fontWeight: "800" }],
        "h1-app": ["27px", { lineHeight: "1.15", fontWeight: "800" }],
        "h2-app": ["18px", { lineHeight: "1.4", fontWeight: "700" }],
        "h3-app": ["14px", { lineHeight: "1.4", fontWeight: "700" }],
        "body-app": ["13px", { lineHeight: "1.5", fontWeight: "500" }],
        "body-table": ["13px", { lineHeight: "1.5", fontWeight: "500" }],
        "caption": ["12px", { lineHeight: "1.4", fontWeight: "500" }],
        "tag": ["11px", { lineHeight: "1.3", fontWeight: "600" }],
        "kpi": ["30px", { lineHeight: "1", fontWeight: "800" }],
        "nav-label": ["8px", { lineHeight: "1", fontWeight: "700" }],
        "nav-link": ["12px", { lineHeight: "1", fontWeight: "500" }],
      },
      borderRadius: {
        "brand": "6px",
        "brand-lg": "10px",
        "brand-xl": "12px",
      },
      boxShadow: {
        "brand-card": "0 1px 3px rgba(26, 28, 30, 0.04), 0 1px 2px rgba(26, 28, 30, 0.03)",
        "brand-card-hover": "0 4px 12px rgba(26, 28, 30, 0.06), 0 2px 4px rgba(26, 28, 30, 0.04)",
      },
      maxWidth: {
        "app": "1320px",
      },
      letterSpacing: {
        "nav": "0.17em",
      },
    },
  },
  plugins: [],
};

export default config;
