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
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      // Revalidate every 60 seconds for server components
      next: { revalidate: 60 },
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
      headers: { "Content-Type": "application/json" },
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
