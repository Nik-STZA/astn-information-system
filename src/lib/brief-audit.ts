/**
 * Weekly brief fact-discipline audit - TypeScript mirror of
 * Nik-STZA/africanstn-research-agent src/briefAudit.js. Keep the two in sync:
 * the agent runs it after generation, the OS runs it live in the brief editor.
 * Pure function; never blocks publishing.
 */

export type AuditWarning = { where: string; problem: string; text: string };
export type BriefAudit = { stories: number; warnings: AuditWarning[] };

const SPECULATIVE = /\b(could|potential(ly)?|foundation for|future|such as|may|might|likely|poised|paves? the way|implies|prerequisite|lays? the groundwork)\b/i;
const HEDGE = /\b(suggests?|highlights?|indicates?|underscores?|demonstrates?|signals?|reflects?|signifies|positions? [^.]{0,40}\bas)\b/i;
const FOUNDATION = /\b(foundation (for|of)|lays? the groundwork|paves? the way|underpins?|poised to|unlock(s|ing)?)\b/i;
// "such as", or a run of three or more items ("A, B, and C" / "A, B, C or D").
const LIST = /\bsuch as\b|[^,.]+,[^,.]+,[^,.]*\b(and|or)\b/i;
const ADVISORY = /\b(look for|invest(ing)? in|partner(ing)? with|approach|target|back(ing)?|acquir(e|ing)|engage with|work with|consider)\b/i;

// Capitalised words that are not company names: sentence furniture, places,
// generic tech terms and currencies.
const NOT_ENTITIES = new Set(`
the a an and or but for of with by from to in on at as this that these those it its their his her
what happened opportunity horizon sports-tech relevance wider tech ecosystem key developments funding deals
insights trends strategic implications emerging african africa continent sub-saharan
south north east west central southern northern eastern western kenya nigeria ghana egypt morocco rwanda
senegal tanzania uganda zambia zimbabwe ethiopia angola cameroon tunisia algeria namibia botswana mozambique
malawi mauritius ivory côte d’ivoire d'ivoire democratic republic congo dr drc lagos abuja nairobi accra
kumasi cairo kigali dakar johannesburg cape town durban pretoria casablanca rabat kampala addis ababa
london paris dubai doha riyadh europe asia uk us usa
ai 5g 4g iot var saas api ml llm led ar vr nft m&a sme smes usd ksh zar ngn r eur gbp
january february march april may june july august september october november december
federations investors founders rights holders event organisers infrastructure developers
olympic olympics games world cup league
twelve ten these there while following after despite according under during both each all one two three
english french arabic portuguese swahili
`.trim().split(/\s+/));

const SENTENCE_SPLIT = /(?<=[.!?])\s+/;

function sentences(text: string): string[] {
  return text.split(SENTENCE_SPLIT).map(s => s.trim()).filter(Boolean);
}

// A short form stands alone as a name only if it is clearly a brand: an
// acronym, mixed case or alphanumeric (MTN, BAL, MoreCorp, AT50), never a
// generic word that happens to start a multi-word name ("Digital", "Old").
const BRANDLIKE = /^(\p{Lu}[\p{Lu}\p{N}&+-]+|\p{Lu}\p{Ll}+\p{Lu}[\p{L}\p{N}]*|[\p{L}]+\p{N}[\p{L}\p{N}]*)$/u;

// Named entities from fact text: runs of consecutive capitalised words
// ("Nyayo National Stadium", "Old Mutual Private Equity", "MoreCorp"), plus
// brand-like single tokens from inside them. Matching whole names avoids
// flagging generic words such as "digital" or "stadium" in analysis lines.
export function factEntities(text: string): Set<string> {
  const out = new Set<string>();
  for (const s of sentences(text)) {
    let run: string[] = [];
    const flush = () => {
      const meaningful = run.filter(w => !NOT_ENTITIES.has(w.toLowerCase()));
      if (meaningful.length) {
        out.add(run.join(' ').toLowerCase().replace(/^the /, ''));
        for (const w of run) if (BRANDLIKE.test(w) && !NOT_ENTITIES.has(w.toLowerCase())) out.add(w.toLowerCase());
        if (run.length === 1 && run[0].length > 2) out.add(run[0].toLowerCase());
      }
      run = [];
    };
    for (const raw of s.split(/\s+/)) {
      const w = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}+&]+$/gu, '').replace(/['’]s$/, '');
      const capital = w && /^[\p{Lu}\p{N}]/u.test(w) && /\p{L}/u.test(w);
      if (capital) run.push(w);
      else flush();
      if (/[,.;:()]$/.test(raw)) flush();
    }
    flush();
  }
  for (const e of [...out]) if (NOT_ENTITIES.has(e)) out.delete(e);
  return out;
}

function mentions(text: string, entities: Set<string>): string[] {
  const found: string[] = [];
  for (const e of entities) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[^\\p{L}\\p{N}]|$)`, 'iu');
    if (re.test(text)) found.push(e);
  }
  return found;
}

function clip(s: string): string {
  return s.length > 160 ? `${s.slice(0, 157)}...` : s;
}

export function auditBrief(markdown: string): BriefAudit {
  const warnings: AuditWarning[] = [];
  const add = (where: string, problem: string, text: string) => warnings.push({ where, problem, text: clip(text.trim()) });

  const sections = markdown.split(/^## /m).slice(1).map(sec => {
    const nl = sec.indexOf('\n');
    return { title: (nl < 0 ? sec : sec.slice(0, nl)).trim(), body: nl < 0 ? '' : sec.slice(nl + 1) };
  });

  // Pass 1: stories, and the entities their facts name.
  const stories: { headline: string; fact: string | null; angle: string | null; hasAngle: boolean }[] = [];
  for (const sec of sections) {
    if (/Emerging Trends|Strategic Implications/i.test(sec.title)) continue;
    for (const chunk of sec.body.split(/^### /m).slice(1)) {
      const headline = chunk.split('\n', 1)[0].trim();
      const fact = chunk.match(/\*\*What happened:\*\*([\s\S]*?)(?=\n\s*\*\*|$)/);
      const angle = chunk.match(/\*\*(Opportunity|Sports-tech relevance) \(Horizon: [^)]+\):\*\*([\s\S]*?)(?=\n\s*\*\*|\n#|$)/);
      stories.push({ headline, fact: fact ? fact[1] : null, angle: angle ? angle[2] : null, hasAngle: !!angle });
    }
  }
  const entities = new Set<string>();
  for (const st of stories) if (st.fact) for (const e of factEntities(st.fact)) entities.add(e);

  // Pass 2: per-story rules.
  for (const st of stories) {
    const where = st.headline;
    if (!st.fact) add(where, 'No "What happened" paragraph', st.headline);
    if (!st.hasAngle) add(where, 'No Opportunity / relevance line with a horizon tag', st.headline);
    if (st.fact) {
      for (const s of sentences(st.fact)) {
        const m = s.match(SPECULATIVE) || s.match(HEDGE);
        if (m) add(where, `Speculative wording in What happened ("${m[0]}")`, s);
      }
    }
    if (st.angle) {
      for (const s of sentences(st.angle)) {
        const named = mentions(s, entities);
        if (named.length) add(where, `Opportunity names a company (${named.join(', ')})`, s);
        const h = s.match(HEDGE) || s.match(FOUNDATION);
        if (h) add(where, `Hedge / "foundation" wording in Opportunity ("${h[0]}")`, s);
        if (LIST.test(s)) add(where, 'Capability list in Opportunity - give one concrete idea', s);
      }
    }
  }

  // Pass 3: synthesis sections.
  for (const sec of sections) {
    const trends = /Emerging Trends/i.test(sec.title);
    const impl = /Strategic Implications/i.test(sec.title);
    if (!trends && !impl) continue;
    const where = trends ? 'Emerging Trends' : 'Strategic Implications';
    for (const s of sentences(sec.body.replace(/^\s*[-*]\s+/gm, ''))) {
      const h = s.match(HEDGE) || s.match(FOUNDATION);
      if (h) add(where, `Hedge / "foundation" wording ("${h[0]}")`, s);
      if (/\bsuch as\b/i.test(s) && !impl) add(where, 'Capability list ("such as")', s);
      if (impl && ADVISORY.test(s)) {
        const named = mentions(s, entities);
        if (named.length) add(where, `Advice tied to a named company (${named.join(', ')})`, s);
      }
    }
  }

  return { stories: stories.length, warnings };
}

export function formatWarning(w: AuditWarning): string {
  return `[${w.where}] ${w.problem}: ${w.text}`;
}
