/**
 * Shared country-name → ISO-3166-1 alpha-2 lookup for flag CDN URLs.
 *
 * Used by any page that stores country names as strings and needs
 * to resolve a flag image from https://flagcdn.com.
 *
 * Also includes common non-African countries that appear in
 * client / pipeline records (UK, US, Australia, etc.).
 */

export const COUNTRY_ISO: Record<string, string> = {
  // ── African countries ──────────────────────────────────────────────────
  "South Africa": "za",
  "Kenya": "ke",
  "Nigeria": "ng",
  "Egypt": "eg",
  "Ghana": "gh",
  "Tanzania": "tz",
  "Ethiopia": "et",
  "Rwanda": "rw",
  "Uganda": "ug",
  "Senegal": "sn",
  "Morocco": "ma",
  "Tunisia": "tn",
  "Cameroon": "cm",
  "Côte d'Ivoire": "ci",
  "Ivory Coast": "ci",
  "Botswana": "bw",
  "Mauritius": "mu",
  "Zambia": "zm",
  "Zimbabwe": "zw",
  "Mozambique": "mz",
  "Angola": "ao",
  "Namibia": "na",
  "Malawi": "mw",
  "DRC": "cd",
  "Democratic Republic of the Congo": "cd",
  "Algeria": "dz",
  "Libya": "ly",
  "Sudan": "sd",
  "Madagascar": "mg",
  "Mali": "ml",
  "Burkina Faso": "bf",
  "Niger": "ne",
  "Chad": "td",
  "Guinea": "gn",
  "Benin": "bj",
  "Togo": "tg",
  "Sierra Leone": "sl",
  "Liberia": "lr",
  "Gambia": "gm",
  "Gabon": "ga",
  "Congo": "cg",
  "Republic of the Congo": "cg",
  "Mauritania": "mr",
  "Eritrea": "er",
  "Djibouti": "dj",
  "Somalia": "so",
  "South Sudan": "ss",
  "Comoros": "km",
  "Cabo Verde": "cv",
  "Cape Verde": "cv",
  "Equatorial Guinea": "gq",
  "Eswatini": "sz",
  "Swaziland": "sz",
  "Lesotho": "ls",
  "Central African Republic": "cf",
  "Seychelles": "sc",
  "São Tomé and Príncipe": "st",
  "Burundi": "bi",

  // ── Common non-African countries (clients, pipeline, etc.) ─────────
  "United Kingdom": "gb",
  "UK": "gb",
  "United States": "us",
  "USA": "us",
  "Australia": "au",
  "Canada": "ca",
  "Germany": "de",
  "France": "fr",
  "Netherlands": "nl",
  "Switzerland": "ch",
  "Sweden": "se",
  "Norway": "no",
  "Denmark": "dk",
  "Finland": "fi",
  "Ireland": "ie",
  "Spain": "es",
  "Italy": "it",
  "Portugal": "pt",
  "Belgium": "be",
  "Austria": "at",
  "Poland": "pl",
  "Japan": "jp",
  "China": "cn",
  "India": "in",
  "Singapore": "sg",
  "United Arab Emirates": "ae",
  "UAE": "ae",
  "Saudi Arabia": "sa",
  "Brazil": "br",
  "New Zealand": "nz",
  "Israel": "il",
};

/**
 * Returns a flag CDN URL for the given country name, or null if unknown.
 */
export function flagUrl(
  country: string | null | undefined,
  size: number = 40
): string | null {
  if (!country) return null;
  const iso = COUNTRY_ISO[country];
  return iso ? `https://flagcdn.com/w${size}/${iso}.png` : null;
}
