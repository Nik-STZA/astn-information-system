import type { Config } from "tailwindcss";

/**
 * Tailwind configuration for the AfricanSTN information system.
 *
 * Brand tokens follow STZA Brand Guidelines v1.0 exactly:
 *   - Primary: Brand Dark #1A1C1E, Brand Gold #C5A059
 *   - Secondary: Warm Grey #8E9196, Near Black #0F1113, Warm Light #F5F0E8, Gold Border #D4C5A9
 *   - Functional: Alert Red #CC0000, Warning Amber #CC7700, Success Green #2E7D32
 *
 * Typography: Calibri per brand guidelines, with documented web fallback chain.
 *
 * All UI elements should reference these tokens rather than hard-code colour values,
 * so future brand updates require only this file to change.
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
        // Functional colours
        "alert-red": "#CC0000",
        "warning-amber": "#CC7700",
        "success-green": "#2E7D32",
      },
      fontFamily: {
        // Calibri per brand guidelines, with documented fallback chain
        sans: ["Calibri", "Segoe UI", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["Consolas", "Monaco", "Courier New", "monospace"],
      },
      // Brand type scale adapted for screen (memo Section 2.2)
      fontSize: {
        // Document scale converted to web sizes
        "display": ["32px", { lineHeight: "1.2", fontWeight: "700" }],
        "h1-app": ["24px", { lineHeight: "1.3", fontWeight: "700" }],
        "h2-app": ["18px", { lineHeight: "1.4", fontWeight: "700" }],
        "h3-app": ["14px", { lineHeight: "1.4", fontWeight: "700" }],
        "body-app": ["14px", { lineHeight: "1.5", fontWeight: "400" }],
        "body-table": ["15px", { lineHeight: "1.5", fontWeight: "400" }],
        "caption": ["12px", { lineHeight: "1.4", fontWeight: "400" }],
        "tag": ["11px", { lineHeight: "1.3", fontWeight: "700" }],
      },
      borderRadius: {
        // Brand uses subtle rounding per the "Buttons" guidance
        "brand": "6px",
        "brand-lg": "8px",
      },
      boxShadow: {
        "brand-card": "0 1px 3px rgba(26, 28, 30, 0.06), 0 1px 2px rgba(26, 28, 30, 0.04)",
        "brand-card-hover": "0 4px 12px rgba(26, 28, 30, 0.08), 0 2px 4px rgba(26, 28, 30, 0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
