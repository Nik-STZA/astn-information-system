"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CONFIDENCE_BANDS, type FilterOptions } from "@/lib/data/registry-shared";

type Props = {
  options: FilterOptions;
};

const FILTER_KEYS = ["country", "sport", "type", "confidence"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

export default function RegistryFilters({ options }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function currentValue(key: FilterKey): string {
    return searchParams.get(key) ?? "";
  }

  function setFilter(key: FilterKey, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    // Any filter change resets pagination.
    params.delete("page");
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  const anyFilterActive = FILTER_KEYS.some((k) => currentValue(k));

  return (
    <div className="card p-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Field label="Country">
          <select
            className="input-brand"
            value={currentValue("country")}
            onChange={(e) => setFilter("country", e.target.value)}
            disabled={isPending}
          >
            <option value="">All countries</option>
            {options.countries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Sport">
          <select
            className="input-brand"
            value={currentValue("sport")}
            onChange={(e) => setFilter("sport", e.target.value)}
            disabled={isPending}
          >
            <option value="">All sports</option>
            {options.sports.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Organisation type">
          <select
            className="input-brand"
            value={currentValue("type")}
            onChange={(e) => setFilter("type", e.target.value)}
            disabled={isPending}
          >
            <option value="">All types</option>
            {options.types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Confidence">
          <select
            className="input-brand"
            value={currentValue("confidence")}
            onChange={(e) => setFilter("confidence", e.target.value)}
            disabled={isPending}
          >
            <option value="">All confidence</option>
            {CONFIDENCE_BANDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {anyFilterActive && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            className="btn-text"
            onClick={() => {
              startTransition(() => {
                router.push(pathname);
              });
            }}
            disabled={isPending}
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label-brand">{label}</span>
      {children}
    </label>
  );
}
