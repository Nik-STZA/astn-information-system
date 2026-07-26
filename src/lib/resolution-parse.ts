/**
 * Shared parser for composed dual-model resolution text.
 * Used by the ResolutionPanel (display) and the amendment-schedule generator (Word export),
 * so both interpret the same stored text identically — including any human edits.
 */

export type GapTag = "Statutory" | "Enhancement" | null;

export type ParsedResolution = {
  reviewNote: string | null;
  summary: string;
  gaps: string[];
  redraft: string | null;
  citations: string[];
};

/** Split a composed resolution into its sections. */
export function parseResolution(text: string): ParsedResolution {
  let rest = text || "";
  let reviewNote: string | null = null;
  const rev = rest.match(/^REVIEW:\s*([\s\S]+?)(?:\n\n|$)/);
  if (rev) {
    reviewNote = rev[1].trim();
    rest = rest.slice(rev[0].length);
  }
  let citations: string[] = [];
  const cit = rest.match(/\n\nCitations:\s*([\s\S]+)$/);
  if (cit) {
    citations = cit[1].split(",").map((s) => s.trim()).filter(Boolean);
    rest = rest.slice(0, rest.length - cit[0].length);
  }
  let redraft: string | null = null;
  const rd = rest.match(/\n\nSuggested redraft[^\n]*:\n([\s\S]+)$/);
  if (rd) {
    redraft = rd[1].trim();
    rest = rest.slice(0, rest.length - rd[0].length);
  }
  let gaps: string[] = [];
  const gp = rest.match(/\n\nGaps:\n([\s\S]+)$/);
  if (gp) {
    gaps = gp[1].split("\n").map((l) => l.replace(/^-\s*/, "").trim()).filter(Boolean);
    rest = rest.slice(0, rest.length - gp[0].length);
  }
  return { reviewNote, summary: rest.trim(), gaps, redraft, citations };
}

/** Split a "[Statutory]"/"[Enhancement]" prefix off a gap string. */
export function parseGapTag(g: string): { tag: GapTag; text: string } {
  const m = g.match(/^\[(Statutory|Enhancement)\]\s*(.*)$/i);
  if (!m) return { tag: null, text: g };
  const tag = (m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()) as GapTag;
  return { tag, text: m[2] };
}
