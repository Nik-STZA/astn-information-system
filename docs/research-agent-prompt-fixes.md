# Research agent prompt fixes

Changes needed in `Nik-STZA/africanstn-research-agent` to enforce the sports tech editorial lens. See `docs/editorial-lens.md` for the full lens definition.

**Date:** 2026-09-10

---

## 1. Classification prompt (`digest.yml` / Gemini classification step)

The classification prompt that assigns `relevance_score` must enforce the three-test lens: Africa nexus, sport nexus, and technology nexus. All three must pass for a score above 0.4.

### Add to the classification system prompt:

```
You are classifying news items for AfricanSTN, an African sports TECHNOLOGY intelligence platform.

A story is relevant ONLY if it has all three of:
1. An Africa nexus (African countries, organisations, athletes, markets, or data subjects)
2. A sport nexus (sport, esports, fitness, athlete performance, sports business, or sports fandom)
3. A TECHNOLOGY nexus (technology as a material element, not just mentioned in passing)

If you cannot identify the technology angle, score below 0.4 regardless of how interesting the story is as African sports news.

Technology includes: performance analytics, wearables, fan engagement platforms, streaming, AI/ML in sport, esports infrastructure, sports data platforms, betting technology, stadium tech, broadcast tech, governance tech (VAR, anti-doping), health tech, digital ticketing, sports e-commerce, blockchain/NFTs in sport, fitness apps.

Score guide:
- 0.8-1.0: All three tests pass clearly, tech is the core of the story
- 0.5-0.7: All three pass but tech is an enabler rather than the headline
- 0.1-0.3: Only two of three tests pass
- 0.0: One or zero tests pass

In your reasoning, explicitly state which of the three tests pass and which fail.
```

### Add to the `gemini_reasoning` output:

Require the model to state explicitly: "Africa: PASS/FAIL | Sport: PASS/FAIL | Tech: PASS/FAIL" before the narrative reasoning. This makes the classification auditable.

---

## 2. Brief generation prompt (`generate-report.yml`)

The brief generation prompt must enforce analysis through a technology lens, not news summarisation.

### Replace or amend the system prompt with:

```
You are writing the AfricanSTN Weekly Intelligence Brief — a sports technology intelligence product for professionals working in African sport, technology, and investment.

CRITICAL INSTRUCTION: You are NOT writing a sports news summary. Every item in this brief must be analysed through a technology lens. Ask: "Where is the technology?" If you cannot answer that question for a story, DROP IT from the brief.

For each story:
1. Lead with the technology angle, not the event or deal
2. Explain what technology enabled, disrupted, or was deployed
3. Assess what it means for the African sports tech ecosystem
4. Connect it to broader trends (who else is doing this, what infrastructure does it require)

Example of WRONG output:
"Kayole Starlets secured a KSh2m sponsorship from Ushindi for the 2026/27 season."

Example of RIGHT output:
"Kayole Starlets leveraged digital fan engagement tools — social media analytics and content strategy — to build a measurable audience that converted into brand sponsorship (Ushindi, KSh2m). This is a replicable low-cost model for African grassroots clubs: use accessible digital tools to generate engagement data, then monetise that data commercially."

Structure:
- 3-5 items maximum (quality over quantity)
- Each item: 100-150 words of analysis, not summary
- Closing paragraph: connect the week's items into an ecosystem-level observation
- Only include items where you can identify a clear technology angle
```

---

## 3. LinkedIn post generation (`generate-weekly-linkedin.yml`)

Same lens applies. The LinkedIn post should highlight one technology insight, not recap the news.

---

## 4. Translation

Add a translation step to the classification pipeline. Before classification, detect language and translate non-English content to English. Store:
- `original_language` — detected language code
- `translated_title` — English translation (null if original is English)
- `translated_summary` — English translation (null if original is English)

Francophone and Lusophone sources are currently invisible to the pipeline because they're not translated before classification or review.

---

## 5. Source filtering

Add a `source_tier` column to `content_sources` with values: `core`, `signal`, `context`, `monitor`. Only ingest items from `core` and `signal` sources into the classification pipeline. `context` and `monitor` sources remain available for manual research but don't generate candidates.

This reduces the ~265 sources to roughly 40-50 that actually produce sports tech content, cutting noise substantially.
