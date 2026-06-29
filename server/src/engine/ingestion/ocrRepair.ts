// OCR artifact repair for OUTPUT text — SAFE, unambiguous transforms only.
//
// Ligature codepoints (ﬁ, ﬂ, …) should never appear in a real citation, so
// expanding them is always correct. We deliberately do NOT perform alphabetic
// OCR un-mangling (rn->m, cl->d, …) on output text: those rules corrupt
// legitimate words far more often than they fix OCR damage —
//   "government" -> "govemment",  "clean" -> "dean",  "classic" -> "dassic",
//   "include" -> "indude",  "click" -> "dick"
// — and can only be applied safely with a dictionary. Per the project principle,
// the OCR'd *surface* is preserved for BIO tagging; OCR tolerance for
// matching/lookup lives in the matching layer (see ocrFold.ts), which produces
// lookup keys only and never mutates output text.

const LIGATURE_REPLACEMENTS: ReadonlyArray<[RegExp, string]> = [
  [/ﬁ/gu, 'fi'],
  [/ﬂ/gu, 'fl'],
  [/ﬀ/gu, 'ff'],
  [/ﬃ/gu, 'ffi'],
  [/ﬄ/gu, 'ffl'],
  [/ﬅ/gu, 'ft'],
  [/ﬆ/gu, 'st'],
];

export function repairOcrArtifacts(text: string): { text: string; changed: boolean } {
  let next = text;

  for (const [pattern, replacement] of LIGATURE_REPLACEMENTS) {
    next = next.replace(pattern, replacement);
  }

  return {
    text: next,
    changed: next !== text,
  };
}
