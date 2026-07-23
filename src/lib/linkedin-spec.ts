/**
 * LinkedIn weekly-brief post validator — encodes the acceptance criteria from
 * "STZA Weekly Post Module — Specification v1". Pure function so it runs live
 * as the operator edits.
 *
 * Hard checks block approval. Guides are quality signals from the spec.
 *
 * Spec contradiction resolved: §1.5 says "no links in body", but all three
 * gold standards keep a bare "africanstn.com/insights/briefs" reference in the
 * closing. So the hard rule bans only real links — http(s)://, www., and .pdf
 * (the report PDF and any external URL belong in the first comment) — while a
 * bare brand-domain reference is allowed.
 */

export type Check = {
  label: string;
  pass: boolean;
  detail: string;
  hard: boolean;
};

export type Validation = {
  checks: Check[];
  ready: boolean;
  charCount: number;
  wordCount: number;
};

const HYPE = [
  "revolutionary", "revolutionise", "revolutionize", "disrupting", "disrupt",
  "game-changing", "game changing", "unlocking potential", "next frontier",
  "exciting",
];

const CORE_HASHTAGS = [
  "#AfricanSTN", "#SportsTech", "#AfricaTech", "#SportsInnovation",
  "#AfricaSports", "#SportsData", "#STZA", "#SportsBusiness",
  "#AfricaInvestment", "#AfricanSport",
];

// Emoji ranges (pictographs, symbols, dingbats, flags) — the body must have none.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]/u;

export function validateLinkedInPost(text: string): Validation {
  const t = (text || "").replace(/\r/g, "").trim();
  const charCount = t.length;
  const words = t.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const lines = t.split("\n");
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);

  const firstLine = nonEmpty[0] || "";
  const headerOk = /^AfricanSTN \| Weekly Intelligence Brief \| w\/e \d{1,2} [A-Z][a-z]+ \d{4}$/.test(firstLine);

  const bulletCount = nonEmpty.filter((l) => l.startsWith("▪")).length;
  const hasDivider = lines.some((l) => l.trim() === "---");

  const hashtagLine = [...nonEmpty].reverse().find((l) => l.includes("#")) || "";
  const hashtags = hashtagLine.match(/#\w+/g) || [];
  const hashtagCount = hashtags.length;
  const missingCore = CORE_HASHTAGS.filter((h) => !hashtags.some((x) => x.toLowerCase() === h.toLowerCase()));
  const usesASTN = /#ASTN\b/i.test(t);

  // Last content line before the hashtag block — must not be a question.
  const beforeTags = nonEmpty.filter((l) => l !== hashtagLine);
  const lastContent = beforeTags[beforeTags.length - 1] || "";
  const endsWithQuestion = lastContent.endsWith("?");

  const hasEmDash = /[—–]/.test(t);
  const hasEmoji = EMOJI.test(t);
  const bodyLink = /(https?:\/\/|www\.|\.pdf)/i.test(t);
  const hypeHit = HYPE.filter((w) => t.toLowerCase().includes(w));
  const drivesAdoption = /drives?\s+adoption/i.test(t);
  const hasReportLine = /State of Sport in Africa/i.test(t);

  const checks: Check[] = [
    // ── Hard gates ──
    {
      label: "Under LinkedIn's 3,000-char limit",
      pass: charCount > 0 && charCount <= 3000,
      detail: `${charCount} / 3000 characters`,
      hard: true,
    },
    {
      label: "Correct header line",
      pass: headerOk,
      detail: headerOk ? "AfricanSTN | Weekly Intelligence Brief | w/e …" : "must be: AfricanSTN | Weekly Intelligence Brief | w/e DD Month YYYY",
      hard: true,
    },
    {
      label: "No em/en dashes (use hyphens)",
      pass: !hasEmDash,
      detail: hasEmDash ? "found — or – ; replace with hyphen, comma, or full stop" : "clean",
      hard: true,
    },
    {
      label: "No emoji",
      pass: !hasEmoji,
      detail: hasEmoji ? "emoji present" : "none",
      hard: true,
    },
    {
      label: "No links in body (http/www/.pdf)",
      pass: !bodyLink,
      detail: bodyLink ? "move links to the first comment" : "none",
      hard: true,
    },
    {
      label: "Does not end with a question",
      pass: !endsWithQuestion,
      detail: endsWithQuestion ? "closing line is a question — the report line is the close" : "clean",
      hard: true,
    },
    {
      label: "No hype phrases",
      pass: hypeHit.length === 0,
      detail: hypeHit.length ? `found: ${hypeHit.join(", ")}` : "clean",
      hard: true,
    },
    {
      label: "'supports/enables adoption', not 'drives adoption'",
      pass: !drivesAdoption,
      detail: drivesAdoption ? "found 'drives adoption' — use supports/enables" : "clean",
      hard: true,
    },
    {
      label: "No #ASTN (that's the Australian network)",
      pass: !usesASTN,
      detail: usesASTN ? "#ASTN present — remove" : "clean",
      hard: true,
    },
    // ── Guides ──
    {
      label: "1,800–2,900 chars (sweet spot 2,400–2,700)",
      pass: charCount >= 1800 && charCount <= 2900,
      detail: `${charCount} characters`,
      hard: false,
    },
    {
      label: "2–6 ▪ story bullets",
      pass: bulletCount >= 2 && bulletCount <= 6,
      detail: `${bulletCount} bullets`,
      hard: false,
    },
    {
      label: "Divider (---) present",
      pass: hasDivider,
      detail: hasDivider ? "present" : "missing",
      hard: false,
    },
    {
      label: "10–11 hashtags, core set complete",
      pass: hashtagCount >= 8 && hashtagCount <= 12 && missingCore.length === 0,
      detail: missingCore.length ? `${hashtagCount} tags — missing ${missingCore.length} core` : `${hashtagCount} tags`,
      hard: false,
    },
    {
      label: "State of Sport report line present",
      pass: hasReportLine,
      detail: hasReportLine ? "present" : "missing",
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
