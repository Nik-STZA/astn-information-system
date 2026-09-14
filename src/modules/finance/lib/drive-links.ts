// Links for a pack's output files.
//
// Cloud builds save to Google Drive and record the file's webViewLink, which
// opens a preview. For an Excel pack the useful action is usually the file
// itself, so each Drive file also gets a direct download link. Paths from
// laptop builds are not links at all, and are copied instead.

/** The Drive file id in a webViewLink or download link, or null for anything else. */
export function driveFileId(path: string): string | null {
  let url: URL;
  try {
    url = new URL(path);
  } catch {
    return null;
  }
  if (!/(^|\.)google\.com$/.test(url.hostname)) return null;
  const inPath = /\/d\/([A-Za-z0-9_-]{10,})/.exec(url.pathname);
  if (inPath) return inPath[1];
  const q = url.searchParams.get("id");
  return q && /^[A-Za-z0-9_-]{10,}$/.test(q) ? q : null;
}

export type OutputLinks =
  | { kind: "drive"; open: string; download: string }
  | { kind: "path"; path: string };

export function outputLinks(path: string): OutputLinks {
  const id = driveFileId(path);
  if (!id) return { kind: "path", path };
  return {
    kind: "drive",
    open: path,
    download: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`,
  };
}
