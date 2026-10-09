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
// Advice, opportunities and ideas - the paid work, never the free brief.
const ADVICE = /\b(should|ought to|could (build|sell|offer|use|target|create|develop)|opportunit(y|ies)|consider(ing)?|look for|invest(ing)? in|partner(ing)? with|can (enable|help|drive|create|leverage|unlock)|creates? (a )?(market|demand|openings?)|blueprint for|model for others)\b/i;
const CONTEXT = /Week in Context|Emerging Trends|Strategic Implications/i;

// Capitalised words that are not company names: sentence furniture, places,
// generic tech terms and currencies.
const NOT_ENTITIES = new Set(`
the a an and or but for of with by from to in on at as this that these those it its their his her
what happened opportunity horizon sports-tech relevance wider tech ecosystem key developments funding deals
insights trends strategic implications emerging week context african africa continent sub-saharan
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
english french arabic portuguese swahili telecoms
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
// treating generic words such as "digital" or "stadium" as names.
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

  // Stories: every ### outside the context section; body runs to the next
  // heading.
  const stories: { headline: string; body: string }[] = [];
  for (const sec of sections) {
    if (CONTEXT.test(sec.title)) continue;
    for (const chunk of sec.body.split(/^### /m).slice(1)) {
      const nl = chunk.indexOf('\n');
      stories.push({
        headline: (nl < 0 ? chunk : chunk.slice(0, nl)).trim(),
        body: nl < 0 ? '' : chunk.slice(nl + 1).trim(),
      });
    }
  }
  const entities = new Set<string>();
  for (const st of stories) for (const e of factEntities(`${st.headline}. ${st.body}`)) entities.add(e);

  for (const st of stories) {
    if (!st.body) add(st.headline, 'Story has no text', st.headline);
    const label = st.body.match(/\*\*(Opportunity|Sports-tech relevance)[^\n]*/i);
    if (label) add(st.headline, 'Opportunity line - remove (ideas are paid work)', label[0]);
    const plain = st.body.replace(/\*\*[^*\n]+:\*\*/g, '');
    for (const s of sentences(plain)) {
      const adv = s.match(ADVICE);
      if (adv) {
        add(st.headline, `Advice / idea in a story ("${adv[0]}")`, s);
        continue;
      }
      const m = s.match(SPECULATIVE) || s.match(HEDGE) || s.match(FOUNDATION);
      if (m) add(st.headline, `Speculative wording ("${m[0]}")`, s);
    }
  }

  for (const sec of sections) {
    if (!CONTEXT.test(sec.title)) continue;
    const where = sec.title.replace(/^\d+\.\s*/, '');
    const bullets = sec.body
      .split(/\n(?=\s*[-*]\s)/)
      .map(b => b.replace(/^\s*[-*]\s+/, '').trim())
      .filter(Boolean);
    for (const b of bullets) {
      const adv = b.match(ADVICE);
      if (adv) add(where, `Advice / idea ("${adv[0]}") - observations only`, b);
      const h = b.match(HEDGE) || b.match(FOUNDATION);
      if (h) add(where, `Hedge / "foundation" wording ("${h[0]}")`, b);
      if (/\bsuch as\b/i.test(b)) add(where, 'Capability list ("such as")', b);
      if (mentions(b, entities).length < 2) add(where, "Pattern cites fewer than two of this week's stories", b);
    }
  }

  return { stories: stories.length, warnings };
}

export function formatWarning(w: AuditWarning): string {
  return `[${w.where}] ${w.problem}: ${w.text}`;
}
