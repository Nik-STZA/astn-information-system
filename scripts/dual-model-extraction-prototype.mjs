#!/usr/bin/env node
/**
 * Dual-model cross-verified evidence extraction — PROTOTYPE
 * ---------------------------------------------------------
 * Demonstrates the defensibility design for the compliance engine's LLM layer:
 * two INDEPENDENT models (Gemini 2.5 Pro + Claude) each read the client document
 * and judge a requirement as present / partial / absent, quoting the EXACT
 * document text as evidence. Then:
 *
 *   1. QUOTE VERIFICATION — each model's evidence quote must actually exist in
 *      the document (verbatim, whitespace-normalised). A quote that isn't there
 *      is a hallucination and is caught here regardless of the other model.
 *   2. ADJUDICATION —
 *        - both models agree + quotes verified  -> CONFIRMED (high confidence)
 *        - agree but a quote fails verification  -> CONFIRMED status, EVIDENCE FLAG
 *        - models disagree                       -> NEEDS REVIEW (escalate to principal)
 *
 * This is a supplement to the deterministic keyword layer, not a replacement.
 * Every AI finding still passes the human principal-review gate (SOP principle 1).
 *
 * Run:  GEMINI_API_KEY=... ANTHROPIC_API_KEY=... node scripts/dual-model-extraction-prototype.mjs
 * No repo dependencies (raw fetch). Models overridable via GEMINI_MODEL / CLAUDE_MODEL.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-pro';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8';

// ── Sample client document (stands in for an ingested privacy policy) ────────
const SAMPLE_DOC = `
Podium Pursuit Privacy Policy (excerpt)

1. How we use your data. We process your personal data on the basis of your
consent, and where applicable our legitimate interests in operating and improving
the platform.

2. Keeping your data. We retain your information for as long as necessary to
provide our services to you.

3. Keeping your data safe. We implement appropriate technical and organisational
measures, including encryption in transit and role-based access controls, to
protect personal data against unauthorised access.

4. Sending data abroad. Where we transfer personal data outside the European
Economic Area, we rely on the European Commission's Standard Contractual Clauses.

5. Your choices. You may request access to, correction of, or deletion of your
personal data at any time by contacting privacy@podiumpursuit.example.
`.trim();

// ── Requirements under test (subset of the seeded GDPR set) ──────────────────
const REQUIREMENTS = [
  { code: 'gdpr_art6_lawful_basis', name: 'Lawful Basis for Processing', ref: 'GDPR Art 6',
    proves: 'A lawful basis (consent, contract, legitimate interests, etc.) is identified for processing.' },
  { code: 'gdpr_art5_purpose_retention', name: 'Purpose Limitation & Retention', ref: 'GDPR Art 5(1)(b),(e)',
    proves: 'A retention schedule with DEFINED periods; vague "as long as necessary" alone is only partial.' },
  { code: 'gdpr_art32_security', name: 'Security of Processing', ref: 'GDPR Art 32',
    proves: 'Technical and organisational measures appropriate to risk (encryption, access control, testing).' },
  { code: 'gdpr_art33_breach', name: 'Personal Data Breach Notification', ref: 'GDPR Art 33-34',
    proves: 'A breach-response procedure with 72-hour authority notification and data-subject notification.' },
  { code: 'gdpr_art44_transfers', name: 'International Data Transfers', ref: 'GDPR Art 44-49',
    proves: 'A Chapter V transfer mechanism (adequacy, SCCs/IDTA, BCRs, or Art 49 derogation).' },
];

const SYSTEM = `You are a data-protection compliance assessor. You are given ONE requirement and a client document. Decide whether the document satisfies the requirement.

Rules:
- status is exactly one of: "present", "partial", "absent".
- If present or partial, "evidence_quote" MUST be an EXACT verbatim substring copied from the document that supports your judgment. Do not paraphrase, summarise, or fix typos in the quote.
- If you cannot find supporting text in the document, status is "absent" and evidence_quote is null. Never invent a quote.
- "partial" = the topic is addressed but incompletely (e.g. mentioned without the specifics the requirement needs).
- Judge ONLY from the document text. Do not assume facts not stated.
- Respond with ONLY a JSON object: {"status": "...", "evidence_quote": "..." or null, "rationale": "one sentence"}.`;

function userPrompt(req) {
  return `REQUIREMENT: ${req.name} (${req.ref})\nWhat proves it: ${req.proves}\n\nDOCUMENT:\n"""\n${SAMPLE_DOC}\n"""`;
}

// ── Model callers (raw REST, no SDK deps) ────────────────────────────────────
function extractJson(text) {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  try { return JSON.parse(m ? m[0] : text); } catch { return null; }
}

async function callGemini(req) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt(req) }] }],
      generationConfig: {
        temperature: 0,
        thinkingConfig: { thinkingBudget: -1 },
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            status: { type: 'STRING', enum: ['present', 'partial', 'absent'] },
            evidence_quote: { type: 'STRING', nullable: true },
            rationale: { type: 'STRING' },
          },
          required: ['status', 'rationale'],
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return extractJson(data?.candidates?.[0]?.content?.parts?.[0]?.text);
}

async function callClaude(req) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 3000,
      thinking: { type: 'adaptive' },
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt(req) }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  return extractJson(textBlock?.text);
}

// ── Quote verification (the anti-hallucination guardrail) ────────────────────
const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
function quoteVerified(verdict) {
  if (verdict?.status === 'absent') return verdict.evidence_quote == null; // absent should carry no quote
  if (!verdict?.evidence_quote) return false; // present/partial must cite
  return norm(SAMPLE_DOC).includes(norm(verdict.evidence_quote));
}

// ── Adjudication ─────────────────────────────────────────────────────────────
function adjudicate(g, c) {
  const gv = quoteVerified(g), cv = quoteVerified(c);
  const agree = g?.status === c?.status;
  const halluc = [];
  if (g && !gv && g.status !== 'absent') halluc.push('Gemini');
  if (c && !cv && c.status !== 'absent') halluc.push('Claude');

  if (agree && gv && cv) return { verdict: g.status.toUpperCase(), confidence: 'high', review: false, note: 'both models agree; both quotes verified in document' };
  if (agree) return { verdict: g.status.toUpperCase(), confidence: 'medium', review: true, note: `agree on status but quote issue${halluc.length ? ` (unverified quote from ${halluc.join(' & ')})` : ''}` };
  return { verdict: `${(g?.status || '?').toUpperCase()} vs ${(c?.status || '?').toUpperCase()}`, confidence: 'low', review: true, note: `models DISAGREE -> escalate to principal${halluc.length ? `; unverified quote from ${halluc.join(' & ')}` : ''}` };
}

// ── Run ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!GEMINI_API_KEY || !ANTHROPIC_API_KEY) {
    console.error('Set both GEMINI_API_KEY and ANTHROPIC_API_KEY.');
    process.exit(1);
  }
  console.log(`Dual-model extraction  |  Gemini=${GEMINI_MODEL}  Claude=${CLAUDE_MODEL}\n${'='.repeat(72)}`);
  let confirmed = 0, review = 0, halluc = 0;

  for (const req of REQUIREMENTS) {
    let g, c;
    try { [g, c] = await Promise.all([callGemini(req), callClaude(req)]); }
    catch (e) { console.log(`\n${req.name}\n  ERROR: ${e.message}`); continue; }

    const a = adjudicate(g, c);
    const gv = quoteVerified(g), cv = quoteVerified(c);
    if (!a.review) confirmed++; else review++;
    if ((g && !gv && g.status !== 'absent') || (c && !cv && c.status !== 'absent')) halluc++;

    console.log(`\n▪ ${req.name}  [${req.ref}]`);
    console.log(`  Gemini: ${String(g?.status).padEnd(8)} quote${gv ? '✓' : '✗'}  "${(g?.evidence_quote || '—').slice(0, 70)}"`);
    console.log(`  Claude: ${String(c?.status).padEnd(8)} quote${cv ? '✓' : '✗'}  "${(c?.evidence_quote || '—').slice(0, 70)}"`);
    console.log(`  => ${a.verdict}  (${a.confidence}${a.review ? ', NEEDS REVIEW' : ''}) — ${a.note}`);
  }

  console.log(`\n${'='.repeat(72)}`);
  console.log(`Summary: ${confirmed} auto-confirmed, ${review} flagged for principal review, ${halluc} unverified-quote catches.`);
  console.log('Auto-confirmed = both independent models agreed AND both quotes exist verbatim in the document.');
}

main().catch((e) => { console.error(e); process.exit(1); });
