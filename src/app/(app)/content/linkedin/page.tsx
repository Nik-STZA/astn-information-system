import { fetchLinkedInDrafts } from "@/lib/data/content";
import LinkedInClient from "./LinkedInClient";

export const dynamic = "force-dynamic";

/**
 * LinkedIn weekly post — generate from the latest brief, validate against the
 * AfricanSTN post spec live, edit, and approve. Replaces the Notion drafts loop.
 */
export default async function LinkedInPage() {
  const res = await fetchLinkedInDrafts();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <div style={{ fontWeight: 500, fontSize: 12, color: "var(--sub)", marginBottom: 4 }}>
          AfricanSTN <span style={{ margin: "0 6px", opacity: 0.4 }}>&middot;</span> Publishing
        </div>
        <h1 style={{ fontWeight: 800, fontSize: 26, lineHeight: 1.15, color: "var(--tx)", margin: 0 }}>
          LinkedIn post
        </h1>
        <p style={{ fontWeight: 400, fontSize: 13, color: "var(--sub)", marginTop: 4 }}>
          Generate the Thursday post from the latest brief, check it against the post spec, edit, and approve.
        </p>
      </div>
      <LinkedInClient initialDrafts={res.data?.data ?? []} />
    </div>
  );
}
