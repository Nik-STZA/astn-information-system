"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CONFIDENCE_BANDS, type FilterOptions } from "@/lib/data/registry-shared";

type Props = {
  options: FilterOptions;
};

const labelStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 9.5,
  lineHeight: 1,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "#8E9196",
  marginBottom: 6,
  display: "block",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  fontWeight: 500,
  fontSize: 13,
  lineHeight: 1,
  color: "#1A1C1E",
  background: "#FAF8F3",
  border: "1px solid #E4D9C4",
  borderRadius: 7,
  padding: "9px 11px",
  outline: "none",
  fontFamily: "inherit",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
  WebkitAppearance: "none",
  appearance: "none" as const,
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path d='M2 4l4 4 4-4' fill='none' stroke='%238E9196' stroke-width='1.5'/></svg>\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 11px center",
  paddingRight: 30,
};

// Verify queue only shows non-High confidence bands
const VERIFY_BANDS = CONFIDENCE_BANDS.filter((b) => b !== "High");

export default function VerifyFilters({ options }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function currentValue(key: string): string {
    return searchParams.get(key) ?? "";
  }

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete("page");
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  const anyActive =
    currentValue("country") ||
    currentValue("type") ||
    currentValue("confidence") ||
    currentValue("q");

  return (
    <div
      style={{
        background: "var(--pnl)",
        border: "1px solid var(--bd)",
        borderRadius: 12,
        padding: "16px 18px",
        boxShadow: "0 1px 3px rgba(26,28,30,.05)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.6fr 1fr 1fr 1fr",
          gap: 12,
        }}
      >
        {/* Search */}
        <div>
          <span style={labelStyle}>Search organisation</span>
          <input
            type="text"
            placeholder="Type a name…"
            defaultValue={currentValue("q")}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setFilter("q", (e.target as HTMLInputElement).value);
              }
            }}
            onBlur={(e) => {
              if (e.target.value !== currentValue("q")) {
                setFilter("q", e.target.value);
              }
            }}
            disabled={isPending}
            style={inputStyle}
          />
        </div>

        {/* Country */}
        <div>
          <span style={labelStyle}>Country</span>
          <select
            value={currentValue("country")}
            onChange={(e) => setFilter("country", e.target.value)}
            disabled={isPending}
            style={selectStyle}
          >
            <option value="">All countries</option>
            {options.countries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* Type */}
        <div>
          <span style={labelStyle}>Type</span>
          <select
            value={currentValue("type")}
            onChange={(e) => setFilter("type", e.target.value)}
            disabled={isPending}
            style={selectStyle}
          >
            <option value="">All types</option>
            {options.types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        {/* Confidence */}
        <div>
          <span style={labelStyle}>Confidence</span>
          <select
            value={currentValue("confidence")}
            onChange={(e) => setFilter("confidence", e.target.value)}
            disabled={isPending}
            style={selectStyle}
          >
            <option value="">All confidence</option>
            {VERIFY_BANDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
      </div>

      {anyActive && (
        <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => {
              startTransition(() => {
                router.push(pathname);
              });
            }}
            disabled={isPending}
            style={{
              fontWeight: 600,
              fontSize: 12,
              color: "#B08D3F",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px 8px",
              fontFamily: "inherit",
            }}
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
