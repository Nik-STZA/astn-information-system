"use client";

// A picker you can type into: "prep" finds 620 Prepayments as well as "620"
// does (a plain select only jumps on the first letters, which for accounts is
// the code). Arrow keys and Enter choose; Escape closes. Works by touch on a
// phone: tap the box, type or scroll, tap an option.

import { useEffect, useId, useRef, useState } from "react";
import styles from "./ApQueue.module.css";
import { matchOptions } from "@/modules/finance/lib/ap-labels";

export interface SearchOption {
  value: string;
  label: string;
}

const MAX_SHOWN = 50;

export default function SearchSelect({ label, value, options, placeholder, onChange }: {
  label: string;
  value: string;
  options: SearchOption[];
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const chosen = options.find((o) => o.value === value) ?? null;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const shown = matchOptions(options, query).slice(0, MAX_SHOWN);

  // Clicking elsewhere closes the list and puts back the chosen label.
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) { setOpen(false); setQuery(""); } };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  function pick(o: SearchOption) {
    onChange(o.value);
    setQuery("");
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && open && shown[active]) { e.preventDefault(); pick(shown[active]); }
    else if (e.key === "Escape") { setOpen(false); setQuery(""); }
  }

  return (
    <div className={styles.field} ref={box}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.combo}>
        <input
          id={id}
          className={styles.select}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder={chosen ? chosen.label : placeholder}
          value={open ? query : chosen?.label ?? ""}
          onFocus={() => { setOpen(true); setActive(0); }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
          onKeyDown={onKey}
        />
        {open && (
          <ul id={`${id}-list`} role="listbox" className={styles.comboList}>
            {shown.length ? shown.map((o, i) => (
              <li key={o.value} role="option" aria-selected={o.value === value}
                className={i === active ? styles.comboOptionActive : styles.comboOption}
                onPointerDown={(e) => { e.preventDefault(); pick(o); }}
                onMouseEnter={() => setActive(i)}>
                {o.label}
              </li>
            )) : <li className={styles.comboEmpty}>No match for &ldquo;{query}&rdquo;</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
