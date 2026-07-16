/**
 * Data Protection Intelligence page - server component wrapper.
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

  const apiError = countriesRes.error || maturityRes.error || enforcementRes.error;

  return (
    <>
      {apiError && (
        <div className="px-8 pt-4">
          <div className="bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-lg p-4">
            <strong>Note:</strong> Some data could not be loaded from the API.
            The page may show incomplete information.
            <details className="mt-1 text-xs">
              <summary>Details</summary>
              {apiError}
            </details>
          </div>
        </div>
      )}
      <DataProtectionClient
        countries={countries}
        maturity={maturity}
        enforcement={enforcement}
      />
    </>
  );
}
