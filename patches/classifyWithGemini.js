// src/classifyWithGemini.js

import { createClient } from './db.js';
import config from './config.js';
import { loadFeedback } from './feedbackLoop.js';

const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey
);

const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}:generateContent`;

const SYSTEM_PROMPT = `You are classifying news items for AfricanSTN, an African sports TECHNOLOGY intelligence platform.

A story is relevant ONLY if it has all three of:
1. An Africa nexus (African countries, organisations, athletes, markets, or data subjects)
2. A sport nexus (sport, esports, fitness, athlete performance, sports business, or sports fandom)
3. A TECHNOLOGY nexus (technology as a material element, not just mentioned in passing)

If you cannot identify the technology angle, score below 0.4 regardless of how interesting the story is as African sports news.

CRITICAL RULES:
- Sports betting is NOT sports tech unless the betting PLATFORM or its technology is the story
- General sports news is NOT sports tech (a tournament result, a transfer, a sponsorship deal without a technology angle)
- A sponsorship deal IS relevant if technology (fan engagement platforms, analytics, streaming) enabled or drove it
- Be strict: when in doubt, the technology test fails

Technology includes: performance analytics, wearables, fan engagement platforms, streaming, AI/ML in sport, esports infrastructure, sports data platforms, betting technology, stadium tech, broadcast tech, governance tech (VAR, anti-doping), health tech, digital ticketing, sports e-commerce, blockchain/NFTs in sport, fitness apps, coaching platforms, venue/booking technology, equipment/sensors.

Score guide (relevance_score):
- 0.8-1.0: All three tests pass clearly, tech is the core of the story
- 0.5-0.7: All three tests pass but tech is an enabler rather than the headline
- 0.1-0.3: Only two of three tests pass
- 0.0: One or zero tests pass

Regions (assign ONE primary):
- ZA: South Africa, Namibia, Eswatini, Lesotho, Botswana
- NG: Nigeria
- EG: Egypt
- KE: Kenya
- GH: Ghana
- other_africa: Any other African country
- intl_africa_relevant: International company/news with Africa angle

Confidence scoring:
- HIGH: All three tests pass clearly with specific details
- MEDIUM: All three tests probably pass but one is implicit or thin
- LOW: Uncertain whether all three tests pass

Taxonomy tagging:
Assign verticals, sub_verticals, domains, sub_domains based on the item's content.

Verticals (pick 1-2):
- Business of Sport & Entertainment
- Mass Participation & Active Living
- Athlete Performance & Injury Prevention

Sub-verticals (pick 1-3, must belong to the selected verticals):
Business of Sport & Entertainment: Stadium & Venue Operations, Media & Broadcasting, Social Media & Fan Engagement, Prediction Markets, Esports & Fantasy, Metaverse
Mass Participation & Active Living: Wearables & Sensors, Fitness & Wellbeing, Medical & Nutrition, Coaching & Training, Sports Analytics, Apparel & Equipment
Athlete Performance & Injury Prevention: Biomechanics, Cognitive & Psychology, Athlete Recovery, Strength & Conditioning, mHealth, Medical Diagnostics

Domains (pick 1-2):
- Information & Communications Technologies
- Medical, Health & Biotech
- Advanced Materials
- Sensors & Devices

Sub-domains (pick 1-3, must belong to the selected domains):
ICT: Artificial Intelligence, AR/VR/XR, Big Data Analytics, Blockchain, Cloud Infrastructure, Digital Twins, Video & Game Development, Media & Broadcast, Mobile & Immersive, Privacy & Cyber Security, Social Media, Streaming OTT, Natural Language Processing, Remote 5G & Broadband, Fantasy
Medical, Health & Biotech: Biomechanics, Cognition & Psychology, Athlete Recovery, mHealth, Nutrition, Strength & Conditioning, Medical Diagnostics, Chronic Health
Advanced Materials: Fibres & Textiles, Coatings & Elastomers, Nano Materials, Composites, Thermoplastics, Foam & Gels
Sensors & Devices: At-home Connected Fitness, IoT & Sensor Technology, Wearables, Bio Sensors, Video, Robotics

Companies mentioned:
Extract company names explicitly mentioned in the title or content. Return as an array. If none, return [].

OUTPUT FORMAT (JSON):
{
  "relevance_score": 0.0-1.0,
  "category": "company|funding|partnership|regulatory|event|m&a|launch|data",
  "region": "ZA|NG|EG|KE|GH|other_africa|intl_africa_relevant",
  "confidence": "high|medium|low",
  "summary": "2-3 sentences written for a professional intelligence brief. Lead with the TECHNOLOGY angle, not the event. State what technology was deployed/enabled/disrupted, WHO (companies, people, amounts, countries), and WHY it matters for African sports technology. Active voice, factual, no hype. NEVER write meta-commentary about the item itself (never 'this article', 'the news item', 'no content available', 'the title suggests'). If content is thin, summarise what the title states as plain fact.",
  "reasoning": "Africa: PASS/FAIL | Sport: PASS/FAIL | Tech: PASS/FAIL -- then explain why each test passed or failed and why this confidence level.",
  "verticals": ["one or two values from the verticals list"],
  "sub_verticals": ["one to three values from the sub-verticals list"],
  "domains": ["one or two values from the domains list"],
  "sub_domains": ["one to three values from the sub-domains list"],
  "companies_mentioned": ["company names found in title or content"]
}`;

async function classifyItem(rawItem, { feedbackPrompt = '', sourceQuality = {} } = {}, retries = 3) {
  // Add source quality signal if available
  const sourceInfo = sourceQuality[rawItem.source_name];
  const qualityLine = sourceInfo
    ? `\nSource editorial quality: ${sourceInfo.quality} (${sourceInfo.approved} approved, ${sourceInfo.rejected} rejected)`
    : '';

  const prompt = `Classify this news item for AfricanSTN:

Title: ${rawItem.title}
Source: ${rawItem.source_name}${qualityLine}
Language: ${rawItem.original_language}

Content:
${rawItem.content || rawItem.snippet || '(no content available)'}

URL: ${rawItem.url}

Respond ONLY with valid JSON, no markdown, no extra text.`;

  // Build system prompt with feedback appended
  const systemPrompt = feedbackPrompt
    ? SYSTEM_PROMPT + feedbackPrompt
    : SYSTEM_PROMPT;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);

      let response;
      try {
        response = await fetch(`${GEMINI_API_URL}?key=${config.gemini.apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 1000, thinkingConfig: { thinkingBudget: 0 } },
          }),
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API error ${response.status}: ${errText.substring(0, 200)}`);
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) throw new Error('No text in Gemini response');

      let classification;
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON found in response');
        classification = JSON.parse(jsonMatch[0]);
      } catch (parseError) {
        console.error(` ❌ Failed to parse Gemini response: ${parseError.message}`);
        if (attempt < retries) { console.log(` 🔄 Retrying (${attempt}/${retries})...`); continue; }
        throw parseError;
      }

      const required = ['relevance_score', 'category', 'region', 'confidence', 'summary', 'reasoning', 'verticals', 'sub_verticals', 'domains', 'sub_domains', 'companies_mentioned'];
      const missing = required.filter(key => !(key in classification));
      if (missing.length > 0) throw new Error(`Missing fields: ${missing.join(', ')}`);

      if (typeof classification.relevance_score !== 'number' || classification.relevance_score < 0 || classification.relevance_score > 1) {
        classification.relevance_score = 0.5;
      }

      return { ...classification, gemini_response: classification };

    } catch (error) {
      if (error.name === 'AbortError') {
        console.error(` ❌ Gemini request timed out after 30s`);
      }
      if (attempt < retries) {
        console.log(` ⚠️ Attempt ${attempt} failed: ${error.message}`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw error;
    }
  }
}

async function storeClassification(rawItemId, classification) {
  try {
    const { data, error } = await supabase
      .from('classified_items')
      .insert([{
        raw_item_id: rawItemId,
        source_name: classification.source_name,
        source_url: classification.source_url,
        url: classification.url,
        title: classification.title,
        original_language: classification.original_language,
        relevance_score: classification.relevance_score,
        category: classification.category,
        region: classification.region,
        confidence: classification.confidence,
        summary: classification.summary,
        gemini_reasoning: classification.reasoning,
        verticals: classification.verticals,
        sub_verticals: classification.sub_verticals,
        domains: classification.domains,
        sub_domains: classification.sub_domains,
        companies_mentioned: classification.companies_mentioned,
        gemini_response: classification.gemini_response,
        model_used: config.gemini.model,
        status: 'pending_review',
        classified_at: new Date(),
      }])
      .select('id')
      .single();

    if (error) { console.error(` ❌ Store failed: ${error.message}`); return null; }

    await supabase.from('raw_items').update({ is_classified: true }).eq('id', rawItemId);

    return data.id;
  } catch (error) {
    console.error(` ❌ Store error: ${error.message}`);
    return null;
  }
}

/**
 * Update an existing classified_items row with new classification data.
 * Used by the re-scoring phase for items the RSS ingester wrote with relevance_score = 0.
 */
async function updateClassification(classifiedItemId, classification) {
  try {
    const { error } = await supabase
      .from('classified_items')
      .update({
        relevance_score: classification.relevance_score,
        category: classification.category,
        region: classification.region,
        confidence: classification.confidence,
        summary: classification.summary,
        gemini_reasoning: classification.reasoning,
        verticals: classification.verticals,
        sub_verticals: classification.sub_verticals,
        domains: classification.domains,
        sub_domains: classification.sub_domains,
        companies_mentioned: classification.companies_mentioned,
        gemini_response: classification.gemini_response,
        model_used: config.gemini.model,
        classified_at: new Date(),
      })
      .eq('id', classifiedItemId);

    if (error) {
      console.error(` ❌ Update failed: ${error.message}`);
      return null;
    }

    return classifiedItemId;
  } catch (error) {
    console.error(` ❌ Update error: ${error.message}`);
    return null;
  }
}

async function classifyAllItems() {
  console.log(`\n🧠 Starting Gemini classification\n`);

  try {
    // Load editorial feedback from Notion (once per batch)
    let feedback = { feedbackPrompt: '', sourceQuality: {}, rejectionCount: 0 };
    try {
      feedback = await loadFeedback();
    } catch (error) {
      console.log(` ⚠️ Feedback loop unavailable: ${error.message}`);
    }

    // ── Phase 1: classify new raw_items ──────────────────────────────────

    const { data: unclassified, error: fetchError } = await supabase
      .from('raw_items')
      .select('id, title, content, snippet, original_language, source_name, source_url, url')
      .eq('is_classified', false)
      .order('created_at', { ascending: true })
      .limit(config.app.batchSize);

    if (fetchError) throw new Error(`Failed to fetch unclassified items: ${fetchError.message}`);

    let classified = 0;
    let approved = 0;
    let lowConfidence = 0;

    // Process items in parallel batches to cut runtime significantly.
    // Gemini free tier allows plenty of concurrent requests; 5 at a time is safe.
    const CONCURRENCY = 5;

    if (!unclassified || unclassified.length === 0) {
      console.log('🔭 No unclassified items found\n');
    } else {
      console.log(`📊 Found ${unclassified.length} unclassified items\n`);

      async function processItem(item, idx) {
        console.log(`⏳ [${idx + 1}/${unclassified.length}] Classifying: "${item.title.substring(0, 60)}..."`);
        try {
          const classification = await classifyItem(item, feedback);
          const classifiedId = await storeClassification(item.id, {
            ...classification,
            source_name: item.source_name,
            source_url: item.source_url,
            url: item.url,
            title: item.title,
            original_language: item.original_language,
          });

          if (classifiedId) {
            classified++;
            if (classification.confidence === 'high' && classification.relevance_score > 0.7) approved++;
            else if (classification.confidence === 'low') lowConfidence++;
            console.log(` ✅ [${idx + 1}] ${classification.category} | ${classification.region} | ${classification.confidence} (${(classification.relevance_score * 100).toFixed(0)}%)`);
          }
        } catch (error) {
          console.error(` ❌ [${idx + 1}] Classification error: ${error.message}`);
        }
      }

      for (let i = 0; i < unclassified.length; i += CONCURRENCY) {
        const batch = unclassified.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map((item, j) => processItem(item, i + j)));
      }

      console.log(`\n📈 Phase 1 complete:`);
      console.log(`   Total classified: ${classified}`);
      console.log(`   Likely to approve (high confidence): ${approved}`);
      console.log(`   Needs review (low confidence): ${lowConfidence}\n`);
    }

    // ── Phase 2: re-score items with relevance_score = 0 ────────────────
    // The RSS ingester writes items directly into classified_items with
    // relevance_score = 0.0 (it does no classification). This phase picks
    // them up, runs them through Gemini, and updates the existing rows.

    console.log(`🔄 Checking for unscored items (relevance_score = 0)...\n`);

    const { data: unscored, error: unscoredError } = await supabase
      .from('classified_items')
      .select('id, title, summary, original_language, source_name, source_url, url')
      .eq('relevance_score', 0)
      .order('created_at', { ascending: true })
      .limit(config.app.batchSize || 50);

    if (unscoredError) {
      console.error(`⚠️ Failed to fetch unscored items: ${unscoredError.message}`);
    } else if (!unscored || unscored.length === 0) {
      console.log('🔭 No unscored items to re-classify\n');
    } else {
      console.log(`📊 Found ${unscored.length} unscored items to re-classify\n`);

      let rescored = 0;

      async function rescoreItem(item, idx) {
        console.log(`⏳ [${idx + 1}/${unscored.length}] Re-scoring: "${(item.title || '').substring(0, 60)}..."`);
        try {
          // Build a rawItem-shaped object from the classified_items row.
          // RSS items only have title + summary (no full content).
          const rawItem = {
            title: item.title,
            content: item.summary,
            snippet: item.summary,
            original_language: item.original_language,
            source_name: item.source_name,
            source_url: item.source_url,
            url: item.url,
          };

          const classification = await classifyItem(rawItem, feedback);
          const updated = await updateClassification(item.id, classification);

          if (updated) {
            rescored++;
            console.log(` ✅ [${idx + 1}] ${classification.category} | ${classification.region} | ${classification.confidence} (${(classification.relevance_score * 100).toFixed(0)}%)`);
          }
        } catch (error) {
          console.error(` ❌ [${idx + 1}] Re-score error: ${error.message}`);
        }
      }

      for (let i = 0; i < unscored.length; i += CONCURRENCY) {
        const batch = unscored.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map((item, j) => rescoreItem(item, i + j)));
      }

      console.log(`\n📈 Phase 2 complete: ${rescored} items re-scored\n`);
    }

    // ── Summary ─────────────────────────────────────────────────────────

    console.log(`📊 Classification run finished: ${classified} new + re-scored items processed\n`);

    return classified;
  } catch (error) {
    console.error(`❌ Classification failed: ${error.message}`);
    throw error;
  }
}

export { classifyAllItems, classifyItem, storeClassification, updateClassification };
