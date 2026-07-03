/**
 * Data Protection Intelligence page — server component wrapper.
 * Fetches data server-side, passes to interactive client component.
 */

import {
  fetchCountries,
  fetchMaturity,
  fetchEnforcement,
} from "@/lib/data/data-protection";
import DataProtectionClient from "./DataProtectionClient";

export default async function DataProtectionPage() {
  const [countriesRes, maturityRes, enforcementRes] = await Promise.all([
    fetchCountries(),
    fetchMaturity(),
    fetchEnforcement(),
  ]);

  const countries = countriesRes.data?.data ?? [];
  const maturity = maturityRes.data?.data ?? [];
  const enforcement = enforcementRes.data?.data ?? [];

  if (countriesRes.error || maturityRes.error || enforcementRes.error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-4">
          <strong>API error:</strong>{" "}
          {countriesRes.error || maturityRes.error || enforcementRes.error}
        </div>
      </div>
    );
  }

  return (
    <DataProtectionClient
      countries={countries}
      maturity={maturity}
      enforcement={enforcement}
    />
  );
}
