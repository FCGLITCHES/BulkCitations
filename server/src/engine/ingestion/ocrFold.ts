// OCR-tolerant MATCHING layer — produces lookup keys / recovered identifiers,
// and NEVER mutates output text. (Output cleanup stays conservative; see
// ocrRepair.ts.) This is how the engine resolves OCR'd input to canonical
// metadata without un-mangling prose: fold confusable characters only to build a
// comparison key, or repair an identifier within the bounds of its grammar.
//
// Confusable classes are derived from the common OCR substitutions the corpus
// models (m<->rn, l<->1<->I, o<->0, s<->5, b<->8, g<->q, e<->c, ...).

const MULTI_CHAR_FOLDS: ReadonlyArray<[RegExp, string]> = [
  [/rn/g, 'm'],
  [/vv/g, 'w'],
  [/cl/g, 'd'],
];

// Single confusable char -> canonical representative (applied after lowercasing).
// Digits collapse into their look-alike letter so an OCR'd identifier and its
// clean form produce the same key.
const CHAR_FOLD: Record<string, string> = {
  '0': 'o', o: 'o',
  '1': 'l', l: 'l', i: 'l',
  '5': 's', s: 's',
  '8': 'b', b: 'b',
  '9': 'g', g: 'g', q: 'g',
  c: 'c', e: 'c',
  '2': 'z', z: 'z',
};

/**
 * Lossy canonical key for fuzzy equality between an OCR'd string and a clean
 * candidate (enrichment record, authority entry). Strips punctuation/whitespace
 * and collapses confusable characters. Compare keys for equality; never display.
 */
export function ocrFoldKey(text: string): string {
  let s = text.normalize('NFKC').toLowerCase();
  for (const [re, rep] of MULTI_CHAR_FOLDS) s = s.replace(re, rep);
  let out = '';
  for (const ch of s) {
    if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) {
      out += CHAR_FOLD[ch] ?? ch;
    }
  }
  return out;
}

// Letters OCR commonly produces in place of a digit, mapped back to the digit.
// Used ONLY where the grammar guarantees a digit (a DOI registrant).
const LETTER_TO_DIGIT: Record<string, string> = {
  o: '0', O: '0', D: '0', Q: '0',
  l: '1', I: '1', i: '1', '|': '1',
  s: '5', S: '5',
  b: '8', B: '8',
  g: '9', q: '9',
  z: '2', Z: '2',
};

function foldToDigits(s: string): string {
  let out = '';
  for (const ch of s) out += LETTER_TO_DIGIT[ch] ?? ch;
  return out;
}

const CLEAN_DOI = /10\.\d{4,9}\/[^\s"'<>]+/i;
const TRAILING_PUNCT = /[).,;:\]]+$/;
// OCR'd anchor: "10." (the 1/0 may be misread), registrant of digits-or-digit-
// look-alike letters (4-9), "/", then a suffix run. Whitespace tolerated.
const DOI_OCR_ANCHOR = /[1l][0ODQ]\s*\.\s*[0-9ODQlIiSsBbgqZz]{4,9}\s*\/\s*[^\s"'<>]+/gi;

/**
 * Recover a DOI from possibly-OCR'd text.
 * - Returns a clean DOI verbatim if one is already present.
 * - Otherwise reconstructs the prefix+registrant (grammar-guaranteed digits) by
 *   folding look-alike letters to digits, and keeps the suffix VERBATIM (a DOI
 *   suffix legitimately mixes letters and digits, e.g. Nature's "s41586-...", so
 *   folding it would corrupt real DOIs). Returns the candidate only if it is
 *   structurally valid, else null.
 *
 * The result is a high-precision lookup candidate to confirm against a metadata
 * provider — not a guarantee, since suffix OCR damage is left for the provider to
 * resolve. Callers should verify (enrichment) before trusting it as output.
 */
export function recoverDoi(raw: string): string | null {
  const clean = raw.match(CLEAN_DOI);
  if (clean) return clean[0].replace(TRAILING_PUNCT, '');

  for (const match of raw.matchAll(DOI_OCR_ANCHOR)) {
    const frag = match[0].replace(/\s+/g, '');
    const slash = frag.indexOf('/');
    if (slash < 0) continue;
    const prefixRegistrant = foldToDigits(frag.slice(0, slash));
    const suffix = frag.slice(slash); // kept verbatim
    const candidate = (prefixRegistrant + suffix).replace(TRAILING_PUNCT, '');
    if (CLEAN_DOI.test(candidate)) return candidate;
  }
  return null;
}
