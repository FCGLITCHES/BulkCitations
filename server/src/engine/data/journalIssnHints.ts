import { lookupGeneratedJournalIssnHint } from './generatedAuthorityPack.js';

// Bounded memo for the pure journal-key normalizer below. Declared at module top so it
// is initialized before the module-load map build (line ~72) calls the normalizer.
const journalHintKeyCache = new Map<string, string>();

const RAW_JOURNAL_ISSN_HINTS: Array<readonly [string, string]> = [
  ['Ab Imperio', '2164-9731'],
  ['African American Review', '1945-6182'],
  ['Agronomía Mesoamericana', '2215-3608'],
  ['American Book Review', '2153-4578'],
  ['American Catholic Studies', '2161-8534'],
  ['American Studies', '2153-6856'],
  ['Anesthesia & Analgesia', '0003-2999'],
  ['Appalachian Heritage', '1940-5081'],
  ['Arabian Journal of Geosciences', '1866-7511'],
  ['Asian Journal of Oncology', '2454-6798'],
  ['Biography', '1529-1456'],
  ['Bond Law Review', '2202-4824'],
  ['Brainy: Jurnal Riset Mahasiswa', '2962-4622'],
  ["Bulletin of the Center for Children's Books", '1558-6766'],
  ["Canadian Journal of Anesthesia/Journal canadien d'anesthésie", '0832-610X'],
  ['Chemical & Engineering News', '1520-605X'],
  ["Chronique d'Egypte", '0009-6067'],
  ['Civil War History', '1533-6271'],
  ['Comitatus: A Journal of Medieval and Renaissance Studies', '1557-0290'],
  ['Creative Economy', '2409-4684'],
  ['Current Medical Research and Opinion', '0300-7995'],
  ['Diacritics', '1080-6539'],
  ['Dong Thap University Journal of Science', '2815-567X'],
  ['Early American Studies: An Interdisciplinary Journal', '1559-0895'],
  ['Ecotone', '2165-2651'],
  ['EPJ Web of Conferences', '2100-014X'],
  ['EPL (Europhysics Letters)', '0295-5075'],
  ['Fetal and Pediatric Pathology', '1551-3815'],
  ['Hebrew Studies', '2158-1681'],
  ['James Joyce Quarterly', '1938-6036'],
  ['Jeunesse: Young People, Texts, Cultures', '1920-261X'],
  ['Journal of Applied Remote Sensing', '1931-3195'],
  ['Journal of Early Christian Studies', '1086-3184'],
  ['Journal of Electronic Materials', '0361-5235'],
  ['Journal of Evolution of Medical and Dental Sciences', '2278-4748'],
  ['Journal of Health Care for the Poor and Underserved', '1548-6869'],
  ['Journal of Nippon Medical School', '1345-4676'],
  ['Journal of Nutrition Education', '0022-3182'],
  ['Journal of Pain & Palliative Care Pharmacotherapy', '1536-0288'],
  ['Journal of the Acoustical Society of America', '0001-4966'],
  ['Jurnal Hutan Tropis', '2337-7992'],
  ['Lempu PGSD', '3063-4199'],
  ['Materials Chemistry and Physics', '0254-0584'],
  ['MCN: The American Journal of Maternal/Child Nursing', '0361-929X'],
  ['Media & Jornalismo', '2183-5462'],
  ['Mouseion: Journal of the Classical Association of Canada', '1913-5416'],
  ['Pathology Research International', '2042-003X'],
  ['Philosophy East and West', '1529-1898'],
  ['Physical Review A', '1050-2947'],
  ['Prairie Schooner', '1542-426X'],
  ['Regional Anesthesia and Pain Medicine', '1098-7339'],
  ['Russian Geology and Geophysics', '1068-7971'],
  ['Russian Journal of Stomatology', '2072-6406'],
  ['Social Science Research', '0049-089X'],
  ['Southern Cultures', '1534-1488'],
  ['SSRN Electronic Journal', '1556-5068'],
  ['STUDIES IN HUMANITIES', '2005-1263'],
  ['The Hopkins Review', '1939-9774'],
  ['The Journal of Japanese Studies', '1549-4721'],
  ['The Journal of the Acoustical Society of America', '0001-4966'],
  ['The Southern Literary Journal', '1534-1461'],
  ['U.S. Catholic Historian', '1947-8224'],
  ['Victorian Review', '1923-3280'],
  ['Zeitschrift für Gerontologie und Geriatrie', '0948-6704'],
  ['Zeitschrift für Palliativmedizin', '1615-2921'],
  ['Фундаментальные исследования (Fundamental research)', '1812-7339'],
];

const JOURNAL_ISSN_HINTS = new Map(
  RAW_JOURNAL_ISSN_HINTS.map(([journal, issn]) => [normalizeJournalHintKey(journal), issn]),
);

export function lookupIssnByJournalTitle(journal: string | undefined): string | null {
  if (!journal) return null;
  return (
    lookupGeneratedJournalIssnHint(journal)
    ?? JOURNAL_ISSN_HINTS.get(normalizeJournalHintKey(journal))
    ?? null
  );
}

// Pure, deterministic normalization called per journal query (and during the one-time
// hint-map build). Memoized via journalHintKeyCache (declared at module top) — recurring
// journal names hit the cache; parity holds because the result depends only on the input.
function normalizeJournalHintKey(value: string): string {
  const cached = journalHintKeyCache.get(value);
  if (cached !== undefined) {
    return cached;
  }
  const result = value
    .normalize('NFKC')
    .replace(/&amp;/giu, '&')
    .replace(/[“”„‟«»]/gu, '"')
    .replace(/[‘’‚‛]/gu, "'")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (journalHintKeyCache.size >= 20000) {
    journalHintKeyCache.clear();
  }
  journalHintKeyCache.set(value, result);
  return result;
}
