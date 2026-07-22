import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Dual-mode auth helper for the IAP transition.
 *
 * AUTH_MODE=iap      — the app runs on Cloud Run behind an Identity-Aware
 *                      Proxy load balancer. IAP authenticates at the edge and
 *                      asserts the user in x-goog-authenticated-user-email
 *                      ("accounts.google.com:person@example.com"). Access
 *                      control (the allowlist) lives in IAP IAM, not app code.
 * AUTH_MODE unset    — legacy Supabase Auth (Netlify deployment). Session
 *                      cookie + ALLOWED_EMAILS allowlist, enforced in
 *                      middleware and the (app) layout.
 *
 * Delete the supabase branch (and supabase-server/browser, login, callback,
 * middleware supabase path) once the Netlify deployment is decommissioned.
 */

export const AUTH_MODE: "iap" | "supabase" =
  process.env.AUTH_MODE === "iap" ? "iap" : "supabase";

export function getIapEmail(): string | null {
  const h = headers();
  const raw = h.get("x-goog-authenticated-user-email");
  if (!raw) return null;
  // Header format: "accounts.google.com:email"
  const email = raw.split(":").pop();
  return email && email.includes("@") ? email : null;
}

// The signed-in user's email in either mode; null if unauthenticated.
export async function getAuthEmail(): Promise<string | null> {
  if (AUTH_MODE === "iap") {
    return getIapEmail();
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}
