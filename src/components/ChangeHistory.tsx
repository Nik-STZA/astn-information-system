import { fieldLabel, type OrganizationChange } from "@/lib/data/registry-shared";

type Props = {
  changes: OrganizationChange[];
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Collapsible audit trail for an organisation.
 *
 * Server component reading from organization_changes; the table is
 * append-only via RLS (only Nik can SELECT) and inserts are gated by
 * the SECURITY DEFINER trigger on organizations.
 */
export default function ChangeHistory({ changes }: Props) {
  if (changes.length === 0) {
    return (
      <div className="card p-5">
        <h2>Change history</h2>
        <p className="text-caption text-warm-grey mt-2">
          No edits recorded for this organisation yet. The audit trail starts when you make your first change.
        </p>
      </div>
    );
  }

  return (
    <details className="card p-5 group" open>
      <summary className="cursor-pointer flex items-center justify-between list-none">
        <h2 className="m-0">Change history</h2>
        <span className="text-caption text-warm-grey">
          {changes.length} {changes.length === 1 ? "entry" : "entries"}
          <span className="ml-2 group-open:rotate-180 inline-block transition-transform">▾</span>
        </span>
      </summary>

      <ul className="mt-4 space-y-4">
        {changes.map((change) => (
          <li key={change.id} className="border-l-2 border-brand-gold pl-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-body-app text-near-black font-bold">
                {change.changedBy}
              </span>
              <span className="text-caption text-warm-grey">
                {formatTimestamp(change.changedAt)}
              </span>
            </div>
            {change.fields.length === 0 ? (
              <p className="text-caption text-warm-grey mt-1">
                Saved with no field changes recorded.
              </p>
            ) : (
              <dl className="mt-2 space-y-1.5">
                {change.fields.map(({ field, oldValue, newValue }) => (
                  <div
                    key={field}
                    className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-x-3 gap-y-0.5 text-caption"
                  >
                    <dt className="text-warm-grey uppercase tracking-wider font-bold">
                      {fieldLabel(field)}
                    </dt>
                    <dd className="text-near-black break-words">
                      <span className="text-alert-red line-through opacity-80">
                        {oldValue}
                      </span>
                      <span className="mx-2 text-warm-grey">→</span>
                      <span className="text-success-green font-bold">{newValue}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
