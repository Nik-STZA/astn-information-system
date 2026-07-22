"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client.
 * Imported by client components for authenticated database access.
 * Relies on RLS policies to enforce access control.
 *
 * Kept in a separate file from the server client because Next.js
 * does not allow mixing server-only imports (next/headers) with
 * client-component imports.
 */
export function createSupabaseBrowserClient() {
  // Placeholder fallbacks keep the build (and the unused /login prerender)
  // from crashing in IAP-mode deployments where these env vars are absent.
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder"
  );
}
