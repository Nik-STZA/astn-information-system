# Brief pipeline: design for the remaining agents

Status: design, 20 November 2026. Steps 1 to 4 and 6 in the table below exist (2 to 4 on branch `feature/brief-pipeline`, behind flags). Steps 5 and 7 to 11 are proposals for Nik to approve before any code is written.

The standard every step serves is `africanstn-editorial` (scope, writing, templates, pre-publication checklist) and `stza-house-style` (language, numbers, evidence, AI-writing check). Where this note and those skills disagree, the skills win.

## 1. The pipeline

| # | Step | Kind | State |
|---|---|---|---|
| 1 | Fetch | Code | Exists (API ingester and research-agent digest) |
| 2 | Rule screen | Code | Built, `RULE_SCREEN` |
| 3 | Scope check | Claude Haiku 5.5, batched | Built, `SCOPE_CHECK` |
| 4 | Story clustering | Claude Haiku 5.5, one call | Built, `scope-check-job.js dedup` |
| 5 | Registry matcher and importance | Code, model only to disambiguate | Designed here |
| 6 | Nik reviews the queue | Human | Exists; 16 stories for w/e 19 November once screened |
| 7 | Verifier | Claude Opus 5.5 with fetched sources and web search | Built, `VERIFY` (`scripts/verify-job.js`) |
| 8 | Editor | Claude Opus 5.5 | Designed here |
| 9 | Independent reviewer | Claude Opus 5.5, fresh context | Designed here |
| 10 | Approval and publish | Human sign-off, code gates | Partly exists; gates designed here |
| 11 | Newsletter draft | Claude Opus 5.5 | Designed here |

Each step reads records and writes records. No step reads another step's transcript or reasoning.

## 2. Records

Item-level decisions already go to `item_screen_decisions` (migration 069): item, step, decision, rule, reason, detail, source link, version, timestamp. Steps 5 and 7 add rows there with `step` values `importance` and `verify`.

Brief-level work needs one new table, `brief_checks`:

| Column | Meaning |
|---|---|
| `brief_id`, `brief_version` | Which draft was checked (versions already exist in `brief_versions`, migration 028) |
| `step` | `editor`, `reviewer` |
| `result` | `pass`, `fail` |
| `findings` | JSON list: location, rule, text, suggested fix, severity (`must fix`, `should fix`, `note`) |
| `model`, `created_at` | Audit |

The publish gate (step 10) reads this table, so a pass must belong to the exact version being published.

## 3. Step 5: registry matcher and importance

**Purpose.** Tell Nik which items involve an organisation AfricanSTN tracks, and rank the queue by importance rather than date.

**How it works.**
- Code first: match names and website domains in the item text against `organizations` (the rule screen already does this for screening; the matcher returns every match, not just the first). Normalise case, punctuation and common suffixes (FC, SC, Ltd).
- A model call only when a match is ambiguous, for example a one-word name that is also a common word, or two registry rows with the same name in different countries. Claude Haiku 5.5 answers "same organisation, yes or no" with the registry row and the item text.
- Output: the matched `astn_id` values, the organisation names and the level (Sports Tech Startup, Professional Club and so on).

**Importance score, 0 to 100.** A transparent sum, not a model guess, so Nik can see why an item ranks where it does:
- money stated (deal value, funding, budget): up to 30, scaled by size;
- technology named (platform, system, procurement): 20;
- registry match: 15, plus 10 if the organisation is a Sports Tech Startup or an investor;
- specialist source (`content_sources.lens = 'africa-sport-business'`): 10;
- story size (items in the cluster from step 4): up to 10;
- country not yet covered in the last four briefs: 5.

The weights are a starting point. After four weeks, compare the score with Nik's approvals and adjust.

**Failure behaviour.** A failed match leaves the item unscored and in the queue. Nothing is archived at this step.

## 4. Step 7: verifier

**Purpose.** Check every approved item against its source before the editor writes a word. This is the step that would have stopped most of the w/e 19 November problems.

**Input.** The approved item, its story cluster (every related item, including the duplicates step 4 folded away), and the text of each source page, fetched by code and stored with a hash so the check can be repeated.

**Checks, per item.**

1. **The source opens.** The link returns the article, not an error, paywall or home page. If not, the item is `unverified`.
2. **The story is new this week.** The article's own publication date falls inside the week covered. If it is older, the item fails unless the verifier finds something new that happened this week, and records what. The generator's 21-day carry-over (`FRESHNESS_DAYS` in the research agent) is not enough on its own: approval date is not publication date.
3. **Every figure is in the source.** Each number in the item (money, counts, percentages, dates) must appear in the source text. A figure that is the source's own estimate or calculation must be labelled as an estimate and attributed.
4. **Names are exact and unambiguous.** People's names and titles, organisations in full, and countries from a list of ambiguous names that must never appear bare: Congo (Republic of Congo or DR Congo), Guinea (Guinea, Guinea-Bissau, Equatorial Guinea), Sudan (Sudan or South Sudan).
5. **One source is not enough for a claim that only one outlet makes.** If the item's central claim (a deal, a rights award, a prize) appears only in a single trade outlet, the verifier looks for the organisation's own announcement or a second independent report. If neither exists, the item is `single-source` and the editor must attribute it plainly ("Business of Sports Africa reported").
6. **What is actually being decided.** For a procedural story (a vote, a meeting, a tender, a general assembly), the verifier reads the whole cluster and states what the procedure decides. Example: the Zamalek vote on 8 December is on creating a football company open to investors; the e-voting is how it is run.
7. **The technology involved.** Named in one line, or "none stated" (the editor then decides whether the item still runs).

**Output.** One `item_screen_decisions` row per item with `step = 'verify'`: decision `pass`, `fail` or `unverified`, a one-line reason, and in `detail` the list of claims with the matching source sentence for each. Nik sees failed and unverified items with the reason and can override, which is recorded.

**Model.** Claude Opus 5.5. Measured on the w/e 19 November brief: US$1.78 for 10 items, including 30 web searches.

**As built (20 November 2026).** Code fetches the page, finds the stated publication date and flags ambiguous place names; Opus reads the item against the source text (claims, figures, event date, what a procedure decides, technology, names); a second Opus call with web search runs whenever no other outlet in our feed reports the story, or a procedure's agenda is unknown. The verdict is computed in code from those answers. Source text is stored with a hash (`item_sources`, migration 072).

## 5. Step 8: editor

**Purpose.** Write the Weekly Intelligence Brief from verified items only, to the template in `africanstn-editorial` section 5.

**Rules it applies** (all from the editorial standard):
- Picks one lead story and writes it as a 100 to 200 word news piece; other items one paragraph; quick hits one line.
- Every item says what technology is involved, using the verifier's line.
- Every item names its source in the copy and links to it. No link, no item.
- Ledes of 35 words or fewer that say who, what, where and how much.
- "Why it matters" kept separate, and only where it adds something the facts do not.
- Section headings only where two or more items belong under them.
- Uses each verifier's "what is being decided" line for procedural stories.
- Drafts the editor's note (two to four sentences, first person) for Nik to rewrite or approve. It may only refer to facts in the items.
- Fewer than three verified items: drafts a short issue or proposes combining with next week; never pads.

**Output.** A draft in `weekly_reports` (status `draft`) and a `brief_checks` row with `step = 'editor'` listing which verifier record supports each item.

## 6. Step 9: independent reviewer

**Purpose.** A second reader that did not write the brief and cannot see the editor's reasoning.

**Input.** The draft, the verifier records and the stored source texts. Nothing else.

**Checks.** The pre-publication checklist in `africanstn-editorial` section 7, item by item, and `stza-house-style` section 4 (AI-writing patterns). In particular:
- every factual statement in "why it matters" lines and the editor's note traces to an item (the w/e 19 November "Week in Context" cited a fact that was in no item);
- every figure in the copy matches the verifier's matched source sentence;
- the issue has a lead, varied item lengths and no empty sections.

**Output.** `brief_checks` row, `step = 'reviewer'`, `pass` or `fail`, with findings in the style-review format (location, rule, text, suggested fix, severity). The reviewer does not edit. A fail goes back to the editor; two fails in a row go to Nik.

## 7. Step 10: approval and publish

What exists now: nothing goes public without Nik's click (approving the week's LinkedIn post, or the catch-up publish), and briefs with fewer than three items are refused unless Nik chooses a short issue.

Gates to add in code, checked at the moment of publishing:
- the reviewer's latest result for this exact brief version is `pass`;
- every item in the brief has a verifier `pass` (or Nik's recorded override);
- every item in the markdown has a source link.

If any gate fails, the publish route returns the reason and changes nothing.

## 8. Step 11: newsletter draft

Drafted after the brief is published, to the template in `africanstn-editorial` section 6: editor's note first, the lead in 60 to 100 words linking to the brief on africanstn.com, three to five one-line items, one figure from the registry taken from `published_figures` with its as-at date, one call to action (now pointing to Edition 2). The reviewer checks it the same way. Sending stays with Nik.

## 9. How the verifier would have caught the w/e 19 November failures

| Failure found in the published brief | Caught by |
|---|---|
| Madica US$6m (27 October), SA20 and Fever, Bayern v Ajax ticket sales (5 and 6 November) predated the week | Verifier check 2 (publication date) |
| Bayern v Ajax "US$1.2m to US$9.2m" with no source | Verifier check 3 (figure must be in the source, and labelled as the outlet's estimate) |
| Okapi Sports Network and Ligue d'Or, Enzi Prize could not be verified | Verifier checks 1 and 5 (`unverified` or `single-source`, shown to Nik before writing) |
| "Congo" was Congo-Brazzaville | Verifier check 4 (ambiguous country list) |
| Zamalek item reported e-voting and missed the football company | Verifier check 6, using the story cluster from step 4 |
| No source links on items | Editor rule, reviewer checklist, publish gate |
| "The Week in Context" cited a fact in no item | Reviewer check on editor's note and "why it matters" lines |
| Out-of-scope items (Madica, Enzi Prize: no sport) | Scope check (step 3), before Nik's queue |
| Call to action for Edition 1 | Fixed on the website branch; newsletter template points to Edition 2 |

## 10. Decisions for Nik

1. **Models.** Opus 5.5 for verifier, editor and reviewer, as proposed, or Sonnet 5.5 for the reviewer to add a different model's reading.
2. **Single-source items.** Run with plain attribution, as proposed, or hold until a second source exists.
3. **Importance weights.** Approve the starting weights in section 3.
4. **Override.** Whether Nik can publish an item the verifier marked `unverified` (proposed: yes, recorded, and the copy says what could not be confirmed).
5. **Order of building.** Proposed: verifier first (it addresses most of the failures above), then the reviewer and publish gates, then the editor, registry matcher and newsletter.
