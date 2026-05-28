import Link from "next/link";

/**
 * Counter card for the overview page.
 * Brand application:
 *   - Warm Light background with Gold Border (per memo Section 2.1 "cards")
 *   - Number in Brand Dark Calibri 28px bold
 *   - Label beneath in Warm Grey 12px
 *
 * Pass `href` to make the whole card a link to a related view.
 */
export default function CounterCard({
  value,
  label,
  unit,
  href,
}: {
  value: string | number;
  label: string;
  unit?: string;
  href?: string;
}) {
  const inner = (
    <div className="card-warm p-5 flex flex-col h-full">
      <div className="flex items-baseline gap-1">
        <span
          className="text-brand-dark font-bold leading-none"
          style={{ fontSize: "32px" }}
        >
          {typeof value === "number" ? value.toLocaleString("en-GB") : value}
        </span>
        {unit && <span className="text-h3-app text-warm-grey">{unit}</span>}
      </div>
      <span className="text-caption text-warm-grey mt-2 uppercase tracking-wider font-bold">
        {label}
      </span>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block hover:brightness-95 transition-all">
        {inner}
      </Link>
    );
  }
  return inner;
}
