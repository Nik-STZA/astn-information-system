/**
 * Rule screen: the first, model-free gate in the brief pipeline.
 *
 * An item is kept only if it
 *   (a) names an organisation in the AfricanSTN registry, or links to a
 *       registry organisation's domain, or
 *   (b) names an African sports team, league, competition or federation
 *       (these imply both "Africa" and "sport"), or
 *   (c) names an African country, city or region AND a sport term.
 * Everything else is archived with the reason stored. Nothing is deleted.
 *
 * Pure module: no database or network access. The caller passes the
 * registry rows in, so the same code runs in the API ingester, in the
 * research agent and in the offline evaluation script.
 *
 * Behind the RULE_SCREEN flag ("on" to enable); see isEnabled().
 */

// ─── Word lists ────────────────────────────────────────────────────────────
// Matched case-insensitively on word boundaries against title, summary and
// translated text. English, French and Portuguese, because 26% of reviewed
// items are French or Portuguese.

const AFRICA_TERMS = [
  // Continent and regions
  "africa", "african", "africans", "afrique", "africain", "africaine", "africains", "africaines",
  "áfrica", "africano", "africana", "africanos", "africanas", "pan-african", "panafricain",
  "sub-saharan", "subsaharienne", "maghreb", "sahel", "east africa", "west africa", "southern africa",
  "north africa", "afrique de l'ouest", "afrique centrale", "afrique du nord", "cosafa", "cecafa",
  "wafu", "ufoa", "sadc", "ecowas", "cedeao", "eac",
  // Countries (with common French and Portuguese forms) and demonyms
  "algeria", "algerian", "algérie", "algérien", "algérienne", "argélia",
  "angola", "angolan", "angolais", "angolano",
  "benin", "bénin", "beninese", "béninois",
  "botswana", "motswana", "batswana",
  "burkina faso", "burkinabe", "burkinabè",
  "burundi", "burundian", "burundais",
  "cabo verde", "cape verde", "cap-vert", "cape verdean", "cabo-verdiano",
  "cameroon", "cameroonian", "cameroun", "camerounais", "camarões",
  "central african republic", "centrafrique", "centrafricain",
  "chad", "chadian", "tchad", "tchadien",
  "comoros", "comores", "comorian",
  "congo", "congolese", "congolais", "drc", "rdc", "congo-brazzaville", "congo-kinshasa",
  "côte d'ivoire", "cote d'ivoire", "ivory coast", "ivorian", "ivoirien", "ivoirienne", "costa do marfim",
  "djibouti", "djiboutian",
  "egypt", "egyptian", "égypte", "égyptien", "egito", "egípcio",
  "equatorial guinea", "guinée équatoriale", "guiné equatorial",
  "eritrea", "eritrean", "érythrée",
  "eswatini", "swaziland",
  "ethiopia", "ethiopian", "éthiopie", "éthiopien", "etiópia",
  "gabon", "gabonese", "gabonais",
  "gambia", "gambian", "gambie",
  "ghana", "ghanaian", "ghanéen",
  "guinea", "guinean", "guinée", "guinéen", "guiné",
  "guinea-bissau", "guinée-bissau", "guiné-bissau",
  "kenya", "kenyan", "kényan", "quénia",
  "lesotho", "basotho",
  "liberia", "liberian", "libéria",
  "libya", "libyan", "libye", "libyen", "líbia",
  "madagascar", "malagasy", "malgache",
  "malawi", "malawian",
  "mali", "malian", "malien",
  "mauritania", "mauritanian", "mauritanie", "mauritanien",
  "mauritius", "mauritian", "maurice", "mauricien",
  "morocco", "moroccan", "maroc", "marocain", "marocaine", "marrocos", "marroquino",
  "mozambique", "mozambican", "moçambique", "moçambicano",
  "namibia", "namibian", "namibie",
  "niger", "nigérien",
  "nigeria", "nigerian", "nigérian", "nigéria", "nigériane",
  "rwanda", "rwandan", "rwandais", "ruanda",
  "são tomé", "sao tome", "são tomé e príncipe",
  "senegal", "senegalese", "sénégal", "sénégalais",
  "seychelles", "seychellois",
  "sierra leone", "sierra leonean",
  "somalia", "somali", "somalie",
  "south africa", "south african", "afrique du sud", "sud-africain", "sud-africaine", "áfrica do sul", "sul-africano",
  "south sudan", "south sudanese", "soudan du sud",
  "sudan", "sudanese", "soudan", "soudanais",
  "tanzania", "tanzanian", "tanzanie", "tanzânia",
  "togo", "togolese", "togolais",
  "tunisia", "tunisian", "tunisie", "tunisien", "tunisienne", "tunísia",
  "uganda", "ugandan", "ouganda", "ougandais",
  "zambia", "zambian", "zambie",
  "zimbabwe", "zimbabwean",
  // Cities
  "lagos", "abuja", "ibadan", "port harcourt", "kano", "enugu", "uyo",
  "accra", "kumasi", "tamale", "cape coast",
  "nairobi", "mombasa", "kisumu", "eldoret", "nakuru", "iten",
  "johannesburg", "joburg", "cape town", "durban", "pretoria", "tshwane", "gqeberha",
  "port elizabeth", "bloemfontein", "soweto", "stellenbosch", "polokwane", "east london",
  "kigali", "kampala", "entebbe", "dar es salaam", "zanzibar", "arusha", "dodoma",
  "addis ababa", "addis abeba", "khartoum", "kinshasa", "lubumbashi", "brazzaville",
  "luanda", "maputo", "lusaka", "harare", "bulawayo", "windhoek", "gaborone", "lilongwe", "blantyre",
  "antananarivo", "port louis", "victoria mahé",
  "cairo", "le caire", "alexandria", "alexandrie", "casablanca", "rabat", "marrakech", "marrakesh",
  "tangier", "tanger", "agadir", "fès", "fez", "algiers", "alger", "oran", "tunis", "sfax", "sousse", "tripoli", "benghazi",
  "dakar", "abidjan", "yamoussoukro", "bamako", "ouagadougou", "niamey", "conakry", "freetown",
  "monrovia", "banjul", "bissau", "praia", "nouakchott", "lomé", "cotonou", "porto-novo",
  "yaoundé", "yaounde", "douala", "libreville", "malabo", "bangui", "n'djamena", "ndjamena",
  "bujumbura", "mogadishu", "djibouti city", "asmara", "juba",
];

const SPORT_TERMS = [
  // English
  "sport", "sports", "sporting", "football", "soccer", "rugby", "cricket", "athletics", "marathon",
  "basketball", "netball", "volleyball", "handball", "tennis", "golf", "boxing", "wrestling", "judo",
  "taekwondo", "karate", "swimming", "cycling", "rowing", "hockey", "esports", "e-sports", "esport",
  "chess", "squash", "badminton", "motorsport", "formula 1", "formula one", "f1", "rally raid",
  "surfing",
  "skateboarding", "triathlon", "fitness", "gym", "olympic", "olympics", "paralympic", "paralympics",
  "fifa", "nba", "world cup", "stadium", "stadia", "stadiums", "league", "leagues", "premiership",
  "federation", "tournament", "championship", "championships", "athlete", "athletes", "footballer",
  "footballers", "fixture", "fixtures", "jersey", "jerseys", "football club", "sports club",
  "striker", "midfielder", "goalkeeper", "sprinter", "racing", "ticketing", "broadcast rights",
  "sports betting", "grassroots",
  // Deliberately absent: transfer, team, match, season, race, rally, coach,
  // arena, kit, fan, club. They matched fintech ("money transfer"),
  // management ("leadership team") and politics ("election race") as often
  // as sport.
  // French
  "sportif", "sportive", "sportifs", "ligue", "fédération", "championnat",
  "joueur", "joueurs", "athlète", "athlètes", "stade", "basket", "cyclisme", "natation",
  "entraîneur", "sélection nationale", "coupe", "supporters", "maillot", "billetterie",
  // Portuguese
  "futebol", "desporto", "desportivo", "esporte", "esportes", "esportivo", "estádio", "liga",
  "federação", "clube", "jogador", "jogadores", "atleta", "atletas", "seleção", "campeonato",
  "treinador", "basquetebol", "andebol", "torcedores", "camisola", "bilheteira",
];

// Names that imply both "Africa" and "sport" on their own. Case-sensitive
// where the name is also an ordinary word (marked with a leading "=").
const AFRICA_SPORT_ENTITIES = [
  "=CAF", "Confederation of African Football", "Confédération africaine de football",
  "AFCON", "=CAN 2025", "=CAN 2027", "=CAN 2029", "Africa Cup of Nations", "Coupe d'Afrique des Nations",
  "Taça das Nações Africanas", "African Nations Championship", "=CHAN", "CAF Champions League",
  "CAF Confederation Cup", "Africa Football League", "African Football League",
  "SA20", "NBA Africa", "Basketball Africa League", "=BAL", "Rugby Africa", "Africa Cup Sevens", "Currie Cup",
  "Betway Premiership", "DStv Premiership", "Premier Soccer League", "NPFL", "Nigeria Premier Football League",
  "Botola", "Girabola", "FKF", "Ligue 1 Mobilis", "Egyptian Premier League", "Ghana Premier League",
  "Kenya Premier League", "NBC Premier League", "Uganda Premier League", "Rwanda Premier League",
  "Super Eagles", "Super Falcons", "Bafana Bafana", "Banyana Banyana", "Black Stars", "Black Queens",
  "Atlas Lions", "Lions de l'Atlas", "Lions de la Teranga", "Harambee Stars", "Springboks",
  "Proteas", "Chipolopolo", "Indomitable Lions", "Lions Indomptables", "Les Fennecs", "=Fennecs",
  "Pharaohs", "Les Éléphants", "Palancas Negras", "Mambas", "Taifa Stars", "Uganda Cranes", "Amavubi",
  "Kaizer Chiefs", "Orlando Pirates", "Mamelodi Sundowns", "Al Ahly", "Al-Ahly", "Zamalek", "Pyramids FC",
  "Wydad", "Raja Casablanca", "RS Berkane", "Espérance", "Esperance de Tunis", "Simba SC", "Young Africans",
  "Yanga", "Azam FC", "Enyimba", "Rangers International", "TP Mazembe", "Petro de Luanda", "Asante Kotoko",
  "Hearts of Oak", "Gor Mahia", "AFC Leopards", "Rayon Sports", "APR FC",
  "Comrades Marathon", "Two Oceans Marathon", "Safari Rally", "Tour du Rwanda", "Lagos City Marathon",
  "Kigali Peace Marathon", "Africa Games", "African Games", "Jeux africains", "Africa Cup", "Dakar 2026",
  "Youth Olympic Games Dakar", "Association of National Olympic Committees of Africa", "ANOCA",
  "Confederation of African Athletics", "CAA", "FIBA Africa", "AfroBasket", "Africa Cricket Association",
  "Cricket South Africa", "SAFA", "South African Football Association", "Nigeria Football Federation",
  "NFF", "Ghana Football Association", "Football Kenya Federation", "FECAFOOT", "FRMF", "Fédération Royale Marocaine",
  "FAF", "FTF", "EFA", "Egyptian Football Association", "FERWAFA", "FUFA", "TFF", "FAZ", "ZIFA",
  "SuperSport", "Africa Sports Ventures", "Business of Sports Africa",
];

// One-word registry names that are ordinary words or too short to be safe.
const COMMON_WORDS = new Set((
  "nexus magma activ performs welnes active elite impact unity vision victory phoenix legacy pulse " +
  "spark rise future focus fusion matrix motion momentum prime summit titan titans united vertex apex " +
  "alpha delta omega energy fitness sports sport premier champion champions stars star lions eagles " +
  "warriors rangers rovers united city athletic athletics academy football soccer rugby cricket tennis " +
  "golf boxing chess squash hockey netball basketball volleyball handball swimming cycling running " +
  "racing rally media capital digital global africa african heritage horizon pioneer pioneers royal " +
  "classic dynamo dynamos sparta spartans stallions tigers leopards panthers sharks bulls stormers " +
  "cheetahs pumas jaguars falcons hawks flames rockets thunder lightning storm wildcats wolves " +
  "kings queens power powers force forces express arrows highlanders swallows chiefs pirates " +
  "sundowns gladiators crusaders saints angels heroes legends masters stars"
).split(/\s+/));

// Hosts that are not an organisation's own domain.
const GENERIC_HOSTS = new Set([
  "facebook.com", "instagram.com", "twitter.com", "x.com", "linkedin.com", "youtube.com", "tiktok.com",
  "wikipedia.org", "google.com", "sites.google.com", "wix.com", "wixsite.com", "wordpress.com",
  "blogspot.com", "medium.com", "linktr.ee", "github.io", "fifa.com", "olympics.com", "worldathletics.org",
]);

// ─── Matching helpers ──────────────────────────────────────────────────────

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// \b is ASCII-only in JS; use Unicode-aware boundaries so "Égypte" and
// "Côte d'Ivoire" match as whole words.
const B_START = "(?<![\\p{L}\\p{N}])";
const B_END = "(?![\\p{L}\\p{N}])";

function termRegex(terms, flags) {
  const sorted = [...terms].sort((a, b) => b.length - a.length).map(escapeRe);
  return new RegExp(`${B_START}(${sorted.join("|")})${B_END}`, flags);
}

function normaliseApostrophes(s) {
  return s.replace(/[‘’ʼ]/g, "'");
}

function hostOf(url) {
  if (!url) return null;
  try {
    const h = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase();
    return h.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isSafeOrgName(name) {
  const n = (name || "").trim();
  if (n.length < 4) return false;
  const words = n.split(/\s+/);
  if (words.length === 1) {
    if (n.length < 6) return false;
    if (COMMON_WORDS.has(n.toLowerCase())) return false;
  }
  // Multi-word names made only of generic words ("United Stars", "Football Club")
  if (words.every((w) => COMMON_WORDS.has(w.toLowerCase()) || /^(fc|sc|ac|club|the|de|du|la|le|of|and|&)$/i.test(w))) {
    return false;
  }
  return true;
}

// ─── Screen builder ────────────────────────────────────────────────────────

/**
 * Build a screen from registry rows.
 * @param {Array<{astn_id?:string, organization_name:string, organization_website?:string}>} orgs
 * @returns {{ screen: (item) => ScreenResult, stats: object }}
 *
 * ScreenResult: { keep: boolean, reason: string, rule: string|null, matches: object }
 *   rule is one of 'africa_sport_source', 'registry_name', 'registry_domain', 'africa_sport_entity',
 *   'africa_and_sport', or null when dropped. reason is a one-line sentence.
 */
function buildScreen(orgs = [], { africaSportSources = [] } = {}) {
  // Sources whose lens is Africa sport business (set per source, see
  // content_sources.lens). Their items skip the keyword rules and go straight
  // to the scope check: a specialist outlet's headline often names neither the
  // country nor a sport ("Okapi secures Ligue d'Or rights").
  const trusted = new Set(africaSportSources.map((s) => s.toLowerCase()));
  const safeOrgs = orgs.filter((o) => isSafeOrgName(o.organization_name));
  const orgByName = new Map(safeOrgs.map((o) => [o.organization_name.trim(), o]));
  // Registry names are matched case-sensitively: "Nexus Sports" the company,
  // not "the nexus of sport". Chunked to keep each regex a sane size.
  const names = [...orgByName.keys()];
  const orgRegexes = [];
  for (let i = 0; i < names.length; i += 800) {
    orgRegexes.push(termRegex(names.slice(i, i + 800), "gu"));
  }

  const domainToOrg = new Map();
  for (const o of orgs) {
    const h = hostOf(o.organization_website);
    if (h && !GENERIC_HOSTS.has(h) && h.includes(".")) domainToOrg.set(h, o);
  }

  // Domains are only meaningful when distinctive; drop very short ones.
  const domainRe = termRegex([...domainToOrg.keys()].filter((d) => d.length >= 8), "giu");

  const africaRe = termRegex(AFRICA_TERMS, "giu");
  const sportRe = termRegex(SPORT_TERMS, "giu");
  const entityCI = AFRICA_SPORT_ENTITIES.filter((e) => !e.startsWith("="));
  const entityCS = AFRICA_SPORT_ENTITIES.filter((e) => e.startsWith("=")).map((e) => e.slice(1));
  const entityReCI = termRegex(entityCI, "giu");
  const entityReCS = termRegex(entityCS, "gu");

  const uniq = (arr) => [...new Set(arr)];
  const findAll = (re, text) => uniq([...text.matchAll(re)].map((m) => m[1]));

  function screen(item) {
    const text = normaliseApostrophes(
      [item.title, item.summary, item.translated_text].filter(Boolean).join("\n")
    );

    // (0) Source lens: specialist Africa sport-business outlet
    if (item.source_name && trusted.has(item.source_name.toLowerCase())) {
      return {
        keep: true, rule: "africa_sport_source",
        reason: `From ${item.source_name}, an Africa sport-business source.`,
        matches: {},
      };
    }

    // (a) Registry organisation named in the text
    const orgHits = [];
    for (const re of orgRegexes) orgHits.push(...findAll(re, text));
    if (orgHits.length) {
      const o = orgByName.get(orgHits[0]);
      return {
        keep: true, rule: "registry_name",
        reason: `Names registry organisation ${orgHits[0]}${o && o.astn_id ? ` (${o.astn_id})` : ""}.`,
        matches: { registry: uniq(orgHits).slice(0, 5) },
      };
    }

    // (a) Text names a registry organisation's domain. Deliberately NOT the
    // article's own URL: that is the publisher's domain, and some registry
    // rows carry a news outlet as their website (e.g. businessofsportsafrica.com,
    // techcabal.com), which made every article from those outlets pass.
    for (const d of findAll(domainRe, text.toLowerCase())) {
      const o = domainToOrg.get(d);
      if (o) {
        return {
          keep: true, rule: "registry_domain",
          reason: `Names ${d}, the site of registry organisation ${o.organization_name}.`,
          matches: { domain: d },
        };
      }
    }

    // (b) African team, league, competition or federation
    const ent = uniq([...findAll(entityReCI, text), ...findAll(entityReCS, text)]);
    if (ent.length) {
      return {
        keep: true, rule: "africa_sport_entity",
        reason: `Names African sport entity ${ent[0]}.`,
        matches: { entities: ent.slice(0, 5) },
      };
    }

    // (c) African place AND a sport term
    const af = findAll(africaRe, text);
    const sp = findAll(sportRe, text);
    if (af.length && sp.length) {
      return {
        keep: true, rule: "africa_and_sport",
        reason: `Names ${af[0]} and sport term "${sp[0]}".`,
        matches: { africa: af.slice(0, 5), sport: sp.slice(0, 5) },
      };
    }

    const reason = af.length
      ? `African place (${af[0]}) but no sport term or registry organisation.`
      : sp.length
        ? `Sport term ("${sp[0]}") but no African place, entity or registry organisation.`
        : "No African place, sport term or registry organisation.";
    return { keep: false, rule: null, reason, matches: { africa: af.slice(0, 5), sport: sp.slice(0, 5) } };
  }

  return {
    screen,
    stats: { orgs: orgs.length, safeOrgNames: safeOrgs.length, domains: domainToOrg.size },
  };
}

const SCREEN_VERSION = "rule-screen-1";

function isEnabled(env = process.env) {
  return String(env.RULE_SCREEN || "").toLowerCase() === "on";
}

module.exports = { buildScreen, isEnabled, SCREEN_VERSION, isSafeOrgName, hostOf, AFRICA_TERMS, SPORT_TERMS, AFRICA_SPORT_ENTITIES };
