# AfricanSTN editorial lens

This document defines what makes a story relevant to AfricanSTN. Every content pipeline — the Cowork Content Pipeline Agent, the GitHub research agent (`africanstn-research-agent`), and any future ingestion or classification logic — must apply this lens. If a story does not pass the lens, it does not belong in AfricanSTN output.

**Last updated:** 2026-09-10

---

## The core question

> "Where is the technology?"

AfricanSTN is a **sports technology** intelligence platform. Every story we publish must have a clear technology angle. A sponsorship deal is not a story. A sponsorship deal driven by digital fan engagement metrics is. A football tournament is not a story. A football tournament that uses AI-powered referee decisions or live streaming infrastructure is.

If you cannot identify the technology, the story does not belong in AfricanSTN output — even if it is about African sport.

---

## The lens: three tests

A story is AfricanSTN-relevant if it passes **all three** tests:

1. **Africa nexus.** The story involves African countries, organisations, athletes, markets, or data subjects. Pan-African and diaspora angles count. A global company launching a sports tech product in Kenya counts. A purely European story does not, unless it has direct implications for African markets.

2. **Sport nexus.** The story involves sport, esports, fitness, athlete performance, sports business, sports governance, or sports fandom. Broadly construed — sports betting technology, fan engagement platforms, stadium infrastructure, and athlete health tech all qualify.

3. **Technology nexus.** The story involves technology as a material element — not just mentioned in passing. This includes but is not limited to:
   - Performance analytics and wearables (GPS tracking, load monitoring, biomechanics)
   - Fan engagement and digital media (streaming, social platforms, apps, gamification)
   - Sports data and statistics platforms
   - AI/ML applications in sport (computer vision, predictive analytics, talent ID)
   - Esports infrastructure and competitive gaming platforms
   - Sports betting and fantasy sports technology
   - Stadium and venue technology (connectivity, access control, cashless payments)
   - Broadcast and media technology
   - Sports governance technology (anti-doping, integrity monitoring, VAR)
   - Health and injury prevention technology
   - Digital ticketing and access management
   - Sports e-commerce and merchandising platforms
   - Blockchain, NFTs, and digital collectibles in sport
   - Fitness and wellness apps and platforms
   - Sports investment and fintech for sport

---

## Applying the lens to classification

When scoring `relevance_score` for a `classified_item`:

| Scenario | Score | Example |
|---|---|---|
| All three tests pass clearly | 0.8–1.0 | "Kenyan startup launches AI scouting platform for African football leagues" |
| All three pass but tech angle is secondary | 0.5–0.7 | "Kayole Starlets use digital engagement to attract Ushindi sponsorship" — tech is the enabler, business deal is the headline |
| Only two tests pass | 0.1–0.3 | "CAF announces new tournament format" (sport + Africa, no tech) |
| Only one test passes | 0.0 | "Premier League match results" (sport only) |

Items scoring below 0.4 do not appear in the candidates view or weekly brief.

---

## Applying the lens to brief generation

When writing the weekly intelligence brief or LinkedIn draft:

1. **Lead with the technology.** Do not summarise what happened — analyse what technology enabled it, disrupted it, or was deployed. The reader knows the news; they come to AfricanSTN for the technology angle.

2. **Explain the mechanism.** "Digital fan engagement" is not enough. What platform? What metrics? What data? How did it translate to commercial value? If the source article provides this detail, extract it. If it doesn't, note the gap.

3. **Connect to the ecosystem.** Every story should connect to the broader African sports technology ecosystem. Who else is doing this? What infrastructure does it depend on? What does it mean for the sector?

4. **Drop stories without a tech angle.** If you cannot write a technology-led analysis of a story, it does not belong in the brief — even if it is interesting African sports news. AfricanSTN is not a sports news service.

### Example: Kayole Starlets sponsorship

**Wrong (generic sports news):**
> Kayole Starlets, a Kenyan women's football club, has secured a KSh2 million sponsorship from Ushindi for the 2026/27 season, covering player salaries, equipment, and operational costs.

**Right (sports tech intelligence):**
> Kayole Starlets leveraged digital fan engagement — social media content strategy and audience analytics — to build a measurable fanbase that attracted brand sponsorship from Ushindi (KSh2m for 2026/27). This is a replicable model for African grassroots clubs: use low-cost digital tools to generate engagement data, then convert that data into a commercial sponsorship proposition. The tech stack is accessible — smartphone content creation, social platform analytics, and community management tools — making this a template for women's sport commercialisation across the continent.

---

## Source classification

Sources in `content_sources` should be tagged by their typical relevance to the lens:

| Tag | Meaning | Examples |
|---|---|---|
| `core` | Regularly produces stories passing all three tests | SportTechie, SportsPro, GSIC, Esports Africa News |
| `signal` | Sometimes produces relevant stories; needs per-item classification | TechCabal, Disrupt Africa, Catapult blog, Stats Perform |
| `context` | Rarely produces stories with a tech angle; useful for background | BBC Sport Africa, CAF Online, PSL, Guardian Africa Football |
| `monitor` | Track for specific signals (funding, launches) but most content is noise | Crunchbase, PitchBook, general VC feeds |

Only `core` and `signal` sources should generate candidates for the review queue. `context` and `monitor` sources should be available for background research but not surface items automatically.

---

## Language and translation

AfricanSTN covers 54 countries across multiple language groups. Content in French, Portuguese, Arabic, and Swahili is as relevant as English-language content if it passes the three tests. The classification step must:

1. Detect the source language
2. Translate title and summary to English for the review queue
3. Preserve the original language text for reference
4. Note the source language in the `original_language` field

Francophone West Africa, Lusophone Southern/East Africa, and Arabic-speaking North Africa are systematically underrepresented when only English sources are ingested. This is a known gap.
