import { createSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Registry browser - skeleton for v1 Day 1.
 *
 * Day 2 will complete:
 *   - Functional filter bar (country, sport, org type, verification confidence)
 *   - Full paginated table with all columns
 *   - Detail page for each organisation
 *   - Edit form with save-back to Supabase
 *
 * Today's skeleton renders a working table with the first 50 organisations
 * so the page is not empty when deployed.
 */
export const dynamic = "force-dynamic";

type ConfidenceBand = "High" | "Medium" | "Medium-Low" | "Low" | null;

// source_confidence holds descriptive strings ("High (via governing body
// listing)", "Medium-Low (Wikipedia)", etc.). Map to a band by prefix.
// Order matters: check "Medium-Low" before "Medium".
function confidenceBand(value: string | null): ConfidenceBand {
  if (!value) return null;
  if (value.startsWith("High")) return "High";
  if (value.startsWith("Medium-Low")) return "Medium-Low";
  if (value.startsWith("Medium")) return "Medium";
  if (value.startsWith("Low")) return "Low";
  return null;
}

export default async function RegistryPage() {
  const supabase = await createSupabaseServerClient();
  const { data: organisations, count } = await supabase
    .from("organizations")
    .select(
      "id, organization_name, country, sport, organization_type, source_confidence",
      { count: "exact" },
    )
    .order("organization_name", { ascending: true })
    .limit(50);

  return (
    <div className="space-y-6">
      <div>
        <h1>Registry</h1>
        <p className="text-caption text-warm-grey mt-1">
          Browse and edit the {count?.toLocaleString("en-GB") ?? "—"} verified organisations in the AfricanSTN registry.
        </p>
      </div>

      <div className="card-warm p-4 border-l-4 border-l-warning-amber">
        <p className="text-body-app text-near-black">
          <strong>Day 1 skeleton.</strong> Tuesday&apos;s build adds the filter bar, full pagination,
          click-through to organisation detail, and edit capability. For today, the table below
          shows the first 50 organisations alphabetically.
        </p>
      </div>

      <div className="card overflow-hidden">
        <table className="table-brand">
          <thead>
            <tr>
              <th>Organisation</th>
              <th>Country</th>
              <th>Sport</th>
              <th>Type</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {organisations?.map((org) => {
              const band = confidenceBand(org.source_confidence);
              return (
                <tr key={org.id}>
                  <td className="font-medium text-brand-dark">{org.organization_name}</td>
                  <td className="text-warm-grey">{org.country ?? "—"}</td>
                  <td className="text-warm-grey">{org.sport ?? "—"}</td>
                  <td>{org.organization_type ?? "—"}</td>
                  <td>
                    {band === "High" && <span className="pill pill-high">High</span>}
                    {band === "Medium" && <span className="pill pill-medium">Medium</span>}
                    {(band === "Medium-Low" || band === "Low") && (
                      <span className="pill pill-low">{band}</span>
                    )}
                    {band === null && <span className="pill pill-neutral">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
