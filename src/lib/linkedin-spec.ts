/**
 * LinkedIn weekly-brief post validator — encodes the acceptance criteria from
 * the AfricanSTN weekly-linkedin-post spec (prompts/weekly-linkedin-post.md in
 * the research agent). Pure function so it can run live as the operator edits.
 */

export type Check = {
  label: string;
  pass: boolean;
  detail: string;
  hard: boolean; // hard = must pass to be postable; soft = quality guidance
};

export type Validation = {
  checks: Check[];
  ready: boolean; // all hard checks pass
  charCount: number;
  wordCount: number;
};

const BANNED = [
  "exciting", "game-changing", "game changing", "revolutionary", "disrupting",
  "leveraging", "significant step", "sets a precedent", "foundational",
];

export function validateLinkedInPost(text: string): Validation {
  const t = (text || "").trim();
  const charCount = t.length;
  const words = t.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const lines = t.split("\n").map((l) => l.trim());

  const bulletLines = lines.filter((l) => l.startsWith("▸"));
  const hashtagLine = [...lines].reverse().find((l) => l.includes("#")) || "";
  const hashtagCount = (hashtagLine.match(/#\w+/g) || []).length;
  const introLine = lines.find((l) => l.length > 0) || "";
  const introWords = introLine.split(/\s+/).filter(Boolean).length;
  const bannedHit = BANNED.filter((w) => t.toLowerCase().includes(w));

  const checks: Check[] = [
    {
      label: "Under LinkedIn's 3,000-char limit",
      pass: charCount > 0 && charCount <= 3000,
      detail: `${charCount} / 3000 characters`,
      hard: true,
    },
    {
      label: "180–250 words",
      pass: wordCount >= 180 && wordCount <= 250,
      detail: `${wordCount} words`,
      hard: false,
    },
    {
      label: "4–5 ▸ bullets",
      pass: bulletLines.length >= 4 && bulletLines.length <= 5,
      detail: `${bulletLines.length} bullets`,
      hard: false,
    },
    {
      label: "Intro line under 25 words",
      pass: introWords > 0 && introWords < 25,
      detail: `${introWords} words`,
      hard: false,
    },
    {
      label: "Includes africanstn.com/join",
      pass: /africanstn\.com\/join/i.test(t),
      detail: /africanstn\.com\/join/i.test(t) ? "present" : "missing",
      hard: true,
    },
    {
      label: "At most 3 hashtags",
      pass: hashtagCount > 0 && hashtagCount <= 3,
      detail: `${hashtagCount} hashtags`,
      hard: false,
    },
    {
      label: "No banned phrases",
      pass: bannedHit.length === 0,
      detail: bannedHit.length ? `found: ${bannedHit.join(", ")}` : "clean",
      hard: false,
    },
  ];

  return {
    checks,
    ready: checks.filter((c) => c.hard).every((c) => c.pass),
    charCount,
    wordCount,
  };
}
