/**
 * Parse an AfricanSTN weekly brief markdown into structured sections and stories.
 * Used by the BriefEditor to present a toggleable/reorderable item list.
 *
 * Brief structure:
 *   # AfricanSTN Weekly Intelligence Brief
 *   **[Date range]**
 *   ## 1. Key Developments
 *   ### [Story headline]
 *   [Story text]
 *   ## 2. Funding & Deals
 *   ...
 *   ## 5. The Week in Context
 *   [Bullets — not story-level items]
 */

export type StoryTone = "lead" | "brief" | "technical" | "conversational" | null;

export type BriefStory = {
  id: string;            // stable key: "s1-i0", "s2-i1" etc.
  headline: string;      // raw ### heading text
  body: string;          // everything between this ### and the next ### or ##
  included: boolean;     // user toggle
  tone: StoryTone;       // editorial tag — null means use brief-level default
  linkedinInclude: boolean; // flag: must appear in the LinkedIn post
};

export type BriefSection = {
  id: string;            // "s0", "s1" etc.
  heading: string;       // raw ## heading text
  preamble: string;      // any text between the ## heading and the first ### (rare)
  stories: BriefStory[];
  isContextSection: boolean; // "The Week in Context" — not item-level editable
};

export type ParsedBrief = {
  header: string;        // everything before the first ## (title, date range)
  sections: BriefSection[];
};

/**
 * Parse brief markdown into sections and stories.
 */
export function parseBriefMarkdown(md: string): ParsedBrief {
  // Split at ## headings, keeping the heading text
  const sectionPattern = /^## /m;
  const firstSectionIdx = md.search(sectionPattern);

  const header = firstSectionIdx === -1 ? md : md.slice(0, firstSectionIdx).trimEnd();
  const rest = firstSectionIdx === -1 ? "" : md.slice(firstSectionIdx);

  // Split on ## but keep the delimiter
  const sectionChunks = rest.split(/(?=^## )/m).filter(Boolean);

  const sections: BriefSection[] = sectionChunks.map((chunk, si) => {
    const lines = chunk.split("\n");
    const heading = (lines[0] ?? "").replace(/^## /, "").trim();

    const bodyText = lines.slice(1).join("\n");

    // Is this "The Week in Context"?
    const isContextSection = /week\s+in\s+context/i.test(heading);

    if (isContextSection) {
      return {
        id: `s${si}`,
        heading,
        preamble: bodyText,
        stories: [],
        isContextSection: true,
      };
    }

    // Split on ### headings within this section
    const storyPattern = /(?=^### )/m;
    const firstStoryIdx = bodyText.search(storyPattern);

    const preamble = firstStoryIdx === -1 ? bodyText.trimEnd() : bodyText.slice(0, firstStoryIdx).trimEnd();
    const storiesText = firstStoryIdx === -1 ? "" : bodyText.slice(firstStoryIdx);

    const storyChunks = storiesText.split(/(?=^### )/m).filter(Boolean);

    const stories: BriefStory[] = storyChunks.map((sc, ii) => {
      const storyLines = sc.split("\n");
      const rawHeadline = (storyLines[0] ?? "").replace(/^### /, "").trim();
      const linkedinInclude = /<!--\s*linkedin\s*-->/.test(rawHeadline);
      const headline = rawHeadline.replace(/\s*<!--\s*linkedin\s*-->\s*/, "").trim();
      const body = storyLines.slice(1).join("\n");
      return {
        id: `s${si}-i${ii}`,
        headline,
        body,
        included: true,
        tone: null as StoryTone,
        linkedinInclude,
      };
    });

    return {
      id: `s${si}`,
      heading,
      preamble,
      stories,
      isContextSection: false,
    };
  });

  return { header, sections };
}

/**
 * Rebuild markdown from a ParsedBrief, respecting included/excluded items
 * and any reordering.
 */
export function rebuildBriefMarkdown(parsed: ParsedBrief): string {
  const parts: string[] = [parsed.header];

  for (const section of parsed.sections) {
    if (section.isContextSection) {
      parts.push(`## ${section.heading}\n${section.preamble}`);
      continue;
    }

    const includedStories = section.stories.filter((s) => s.included);

    // If no stories are included in a non-context section, check for a
    // preamble (e.g. "No funding or deal activity identified this week.")
    // and keep the section heading + preamble.
    if (includedStories.length === 0 && section.preamble.trim()) {
      parts.push(`## ${section.heading}\n${section.preamble}`);
      continue;
    }

    // If no stories and no preamble, omit the section entirely
    if (includedStories.length === 0) continue;

    const storiesMarkdown = includedStories
      .map((s) => {
        const h = s.linkedinInclude ? `${s.headline} <!-- linkedin -->` : s.headline;
        return `### ${h}\n${s.body}`;
      })
      .join("");

    const sectionMd = section.preamble.trim()
      ? `## ${section.heading}\n${section.preamble}\n${storiesMarkdown}`
      : `## ${section.heading}\n${storiesMarkdown}`;

    parts.push(sectionMd);
  }

  return parts.join("\n\n");
}

/**
 * Count total and included stories.
 */
export function countStories(parsed: ParsedBrief): { total: number; included: number } {
  let total = 0;
  let included = 0;
  for (const section of parsed.sections) {
    if (section.isContextSection) continue;
    total += section.stories.length;
    included += section.stories.filter((s) => s.included).length;
  }
  return { total, included };
}

/**
 * Merge excluded items back into a freshly-parsed brief.
 * When the user edits the textarea, excluded stories vanish from the markdown.
 * This function appends them back into their original section so the Items
 * panel still shows them as re-selectable.
 */
export function mergeExcluded(fresh: ParsedBrief, prev: ParsedBrief): ParsedBrief {
  return {
    ...fresh,
    sections: fresh.sections.map((freshSec) => {
      const prevSec = prev.sections.find((ps) => ps.heading === freshSec.heading);
      if (!prevSec) return freshSec;

      // Carry over tone and linkedinInclude from previous state for matching stories
      const prevByHeadline = new Map(prevSec.stories.map((s) => [s.headline, s]));
      const mergedStories = freshSec.stories.map((s) => {
        const prev = prevByHeadline.get(s.headline);
        if (!prev) return s;
        return { ...s, tone: prev.tone, linkedinInclude: prev.linkedinInclude };
      });

      const excludedStories = prevSec.stories.filter((s) => !s.included);
      const freshHeadlines = new Set(freshSec.stories.map((s) => s.headline));
      const toRestore = excludedStories.filter((s) => !freshHeadlines.has(s.headline));
      if (toRestore.length === 0) return { ...freshSec, stories: mergedStories };
      return { ...freshSec, stories: [...mergedStories, ...toRestore] };
    }),
  };
}
