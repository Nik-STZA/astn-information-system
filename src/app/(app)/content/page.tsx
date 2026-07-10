/**
 * Content Engine page — server component wrapper.
 * Fetches editions, passes to ContentClient for interactive UI.
 */

import { fetchEditions } from "@/lib/data/content";
import ContentClient from "./ContentClient";

export default async function ContentPage() {
  const editionsRes = await fetchEditions();

  return (
    <ContentClient
      editions={editionsRes.data?.data ?? []}
      error={editionsRes.error}
    />
  );
}
