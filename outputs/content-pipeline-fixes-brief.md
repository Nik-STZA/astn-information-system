# Claude Code brief — content pipeline fixes (23 August 2026)

Three bugs are blocking the AfricanSTN weekly LinkedIn cadence. Fix in priority order — bug 3 is the one losing us posts right now.

## Bug 3 (EASY — fix first): approved items not appearing in LinkedIn posts

**Root cause:** `server-registry-routes.js` lines 392–400, the `POST /api/news/items/:id/review` endpoint sets `status` but never sets `reviewed_at`, `reviewed_by`, or `updated_at`. The external brief generator (in `Nik-STZA/africanstn-research-agent`, `generate-report.yml`) likely filters on `reviewed_at IS NOT NULL` to find editorially reviewed items. Items approved through the OS review queue silently fail that filter.

**Fix:** In `server-registry-routes.js`, update the review endpoint's UPDATE query to include:
```sql
UPDATE classified_items
SET status = $1, reviewed_at = now(), reviewed_by = $2, updated_at = now()
WHERE id = $3
```

Compare with the correct version already in `server-content-routes.js` lines 210–214 — match that pattern.

Remember: route files live in the repo root AND must be copied to `deploy/` for Cloud Run. The CI pipeline handles this, but verify both files.

## Bug 1 (MEDIUM): too many irrelevant items in review queue

**Root cause:** The in-app RSS ingester at `server-content-routes.js` lines 314–332 hardcodes `relevance_score = 0.5` for every item. The review queue candidates view (`ReviewClient.tsx` line 296) filters for `relevance_score >= 0.4`. Since every item gets 0.5, everything passes.

A separate external pipeline (`digest.yml` in `Nik-STZA/africanstn-research-agent`) does proper Gemini-based classification and writes real relevance scores, `gemini_reasoning`, and `confidence`. But the "Fetch sources" button in the OS triggers the dumb in-app ingester, not the external agent.

**Options (pick one):**
1. **Quick fix:** Change the in-app ingester's default score to `0.0` so those items don't appear in candidates. Only items scored by the external agent would show up.
2. **Better fix:** Remove the in-app ingester entirely, or have the "Fetch sources" button dispatch the external agent pipeline instead.
3. **Full fix:** Add lightweight classification to the in-app ingester (e.g. keyword matching against a sports-tech term list, or a Gemini call per batch).

Recommend option 1 for now — it's a one-line change (`0.5` → `0.0` at line 328) and immediately cleans up the queue.

## Bug 2 (MEDIUM): foreign language items not translated

**Root cause:** The in-app ingester does no language detection or translation. It copies the source's declared `languages` field as `original_language` (line 329) but never detects actual article language or populates `translated_text`. The `translated_text` column exists and `ReviewClient.tsx` line 187 renders it, but it's always null for in-app-ingested items.

**Fix:** Add a post-ingestion step for items where `original_language != 'en'`:
- Language detection: `franc` npm library (lightweight, no API cost) or rely on the source's declared language
- Translation: Google Cloud Translation API (cheapest), or batch via Gemini
- Populate `translated_text` and present alongside the original in the review UI

This can wait until bug 3 is shipped and the LinkedIn cadence is restored.

## Key files

| File | What |
|---|---|
| `server-registry-routes.js:392–400` | Review action (bug 3) |
| `server-content-routes.js:314–332` | In-app RSS ingester (bugs 1 & 2) |
| `server-content-routes.js:210–214` | Correct review pattern to match |
| `src/app/(app)/content/review/ReviewClient.tsx` | Review queue UI |
| `src/app/(app)/content/linkedin/LinkedInClient.tsx` | LinkedIn draft editor |

## Deploy note

After changing any `server-*-routes.js` file, the CI pipeline copies it to `deploy/` automatically on push to `main`. If deploying manually, run the copy step first.
