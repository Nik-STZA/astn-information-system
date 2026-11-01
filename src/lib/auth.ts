import { headers } from "next/headers";

/**
 * IAP auth helpers. The app runs on Cloud Run behind an Identity-Aware Proxy
 * load balancer: IAP authenticates every request at the edge (Google login)
 * and enforces the allowlist via IAM (roles/iap.httpsResourceAccessor).
 * The app trusts the x-goog-authenticated-user-email assertion header
 * ("accounts.google.com:person@example.com"); the middleware rejects any
 * request that lacks it.
 */

// Always await this. A forgotten await gives a Promise, which counts as true in
// `if (!getIapEmail())` and would let everyone through; auth.guard.test.ts fails
// the build if a call has no await.
export async function getIapEmail(): Promise<string | null> {
  const h = await headers();
  const raw = h.get("x-goog-authenticated-user-email");
  if (!raw) return null;
  const email = raw.split(":").pop();
  return email && email.includes("@") ? email : null;
}

// The signed-in user's email; null if unauthenticated (should not occur
// behind IAP — the middleware 403s requests without the assertion header).
export async function getAuthEmail(): Promise<string | null> {
  return await getIapEmail();
}
