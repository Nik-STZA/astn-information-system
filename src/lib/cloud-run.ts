/**
 * Cloud Run API client.
 *
 * Fetches OS module data (Data Protection, Compliance, Content, BD Pipeline)
 * from the AfricanSTN Cloud Run API deployed on GCP.
 *
 * Server-side only — called from server components and route handlers.
 * The API is publicly accessible; auth is enforced by the Next.js middleware
 * + Supabase session before any page that calls these functions renders.
 */

const API_BASE =
  process.env.CLOUD_RUN_API_URL ||
  "https://africastn-api-782190795609.europe-west1.run.app";

/**
 * Shared secret sent on every request so the Cloud Run API can reject callers
 * that are not this app. CORS does not protect a publicly-reachable API — it
 * only restricts browser cross-origin reads — so a direct/server request needs
 * a real credential. Set CLOUD_RUN_API_KEY in Netlify env vars and in the
 * Cloud Run service; the server must reject requests whose header does not match.
 *
 * Server-side only — this value must never reach the browser bundle, so it is
 * read from a non-NEXT_PUBLIC env var and only used inside these server helpers.
 */
const API_KEY = process.env.CLOUD_RUN_API_KEY;

/**
 * Base headers for every API call, including the shared secret when configured.
 * Kept as a helper so both the read and mutate wrappers stay in sync.
 */
function apiHeaders(extra?: HeadersInit): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "X-API-Key": API_KEY } : {}),
    ...extra,
  };
}

export type ApiResponse<T> = {
  data: T | null;
  error: string | null;
};

/**
 * Generic fetch wrapper for the Cloud Run API.
 * Handles errors gracefully — returns { data, error } rather than throwing.
 */
export async function cloudRunFetch<T>(
  path: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  try {
    // Default: revalidate every 60s (server components). A caller passing
    // cache: "no-store" opts out entirely — used by live editorial queues
    // where a freshly written row must appear immediately. The two options
    // are mutually exclusive in Next.js, so only set next when not no-store.
    const noStore = options?.cache === "no-store";
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: apiHeaders(options?.headers),
      ...(noStore ? {} : { next: { revalidate: 60 } }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { data: null, error: `API ${res.status}: ${body}` };
    }

    const data = (await res.json()) as T;
    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Unknown API error",
    };
  }
}

/**
 * Mutating fetch (POST/PUT/DELETE) — no caching.
 */
export async function cloudRunMutate<T>(
  path: string,
  method: "POST" | "PUT" | "DELETE",
  body?: unknown
): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: apiHeaders(),
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      return { data: null, error: `API ${res.status}: ${text}` };
    }

    const data = (await res.json()) as T;
    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Unknown API error",
    };
  }
}
