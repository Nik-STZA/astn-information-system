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

export default async function RegistryPage() {
  const supabase = await createSupabaseServerClient();
  const { data: organisations, count } = await supabase
    .from("organizations")
    .select("id, name, country_iso, sport_code, organization_type, source_confidence", {
      count: "exact",
    })
    .order("name", { ascending: true })
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
            {organisations?.map((org) => (
              <tr key={org.id}>
                <td className="font-medium text-brand-dark">{org.name}</td>
                <td className="text-warm-grey">{org.country_iso ?? "—"}</td>
                <td className="text-warm-grey">{org.sport_code ?? "—"}</td>
                <td>{org.organization_type ?? "—"}</td>
                <td>
                  {org.source_confidence === "High" && (
                    <span className="pill pill-high">High</span>
                  )}
                  {org.source_confidence === "Medium" && (
                    <span className="pill pill-medium">Medium</span>
                  )}
                  {(org.source_confidence === "Medium-Low" ||
                    org.source_confidence === "Low") && (
                    <span className="pill pill-low">{org.source_confidence}</span>
                  )}
                  {!org.source_confidence && (
                    <span className="pill pill-neutral">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
