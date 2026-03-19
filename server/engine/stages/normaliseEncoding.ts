/**
 * Stage 0: Encoding Normalisation
 * 
 * Runs BEFORE preNormalize(). Handles encoding artefacts that can break
 * every downstream stage if left unchecked:
 *   - BOM stripping
 *   - Unicode normalisation (NFC)
 *   - Ligature expansion (ﬁ→fi, ﬀ→ff, etc.)
 *   - Curly quotes → straight quotes
 *   - En-dash / em-dash  → hyphen  (for page ranges)
 *   - NBSP and other non-breaking whitespace → regular space
 *   - Soft hyphen removal
 *   - OCR fragment repair: hard line-break hyphenation ("under-\nstanding" → "understanding")
 *   - Null-byte / control character stripping
 * 
 * Returns a plain string — no branded type yet; branding happens in preNormalize.
 */

/** Unicode ligatures → ASCII equivalents */
const LIGATURE_MAP: Record<string, string> = {
  '\uFB00': 'ff',   // ﬀ
  '\uFB01': 'fi',   // ﬁ
  '\uFB02': 'fl',   // ﬂ
  '\uFB03': 'ffi',  // ﬃ
  '\uFB04': 'ffl',  // ﬄ
  '\uFB05': 'st',   // ﬅ
  '\uFB06': 'st',   // ﬆ
  // Greek ligatures (rare in academic text but present in some PDFs)
  '\u0153': 'oe',   // œ
  '\u00E6': 'ae',   // æ
  '\u00C6': 'AE',   // Æ
  '\u0152': 'OE',   // Œ
};

const LIGATURE_RE = new RegExp(
  Object.keys(LIGATURE_MAP).map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'g'
);

/**
 * Normalise encoding artefacts in raw citation text.
 * Safe to call on any string, including empty ones.
 */
export function normaliseEncoding(raw: string): string {
  if (!raw) return raw;

  let s = raw;

  // 1. Strip leading BOM (U+FEFF)
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);

  // 2. Unicode NFC normalisation (combines diacritics correctly)
  s = s.normalize('NFC');

  // 3. Ligature expansion
  s = s.replace(LIGATURE_RE, ch => LIGATURE_MAP[ch] ?? ch);

  // 4. Curly / typographic quotes → straight
  // Double quotes
  s = s.replace(/[\u201C\u201D\u201E\u201F\u275D\u275E]/g, '"');
  // Single quotes / apostrophes (careful: don't flatten mid-word apostrophes that are already ASCII)
  s = s.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");

  // 5. En-dash (–) and em-dash (—) → hyphen-minus
  //    Preserve the distinction in Step 0: replace with hyphen so page ranges like "123–145" become "123-145"
  s = s.replace(/[\u2013\u2014]/g, '-');

  // 6. Non-breaking space (NBSP, thin NBSP, narrow NBSP, zero-width space, etc.) → regular space
  s = s.replace(/[\u00A0\u200B\u202F\u2009\u2060\uFEFF]/g, ' ');

  // 7. Soft hyphen removal (U+00AD appears invisibly in some PDF extracts)
  s = s.replace(/\u00AD/g, '');

  // 8. OCR hard-hyphen line-break repair:
  //    "under-\nstanding" → "understanding"
  //    "can-\ncellation" → "cancellation"
  //    Only fires when the hyphen is at end-of-line before a lowercase letter.
  s = s.replace(/-\n([a-z])/g, '$1');

  // 9. Strip null bytes and other C0/C1 control characters
  //    Exceptions: keep \t (tab → normalized later), \n (newline → preNormalize handles), \r
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  return s;
}
