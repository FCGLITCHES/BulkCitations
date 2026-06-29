// Dictionary-gated OCR correction for OUTPUT field values (English-only, gated to PDF/OCR mode).
//
// ocrRepair.ts deliberately does NOT un-mangle alphabetic OCR on its own, because that corrupts
// real words ("government" -> "govemment") UNLESS gated by a dictionary. This module IS that
// dictionary-gated step: it only ever rewrites a word TO a more-common real English word, never
// away from one, and it leaves non-English / proper-noun / valid words untouched. It runs on the
// extracted field values (post-extraction), so it cannot affect BIO tagging or extraction.
//
// Prototype on the 1000-ref pool (held-out): ~40% of english OCR words fixed, 96.8% change
// precision, 0 false corrections across 12,164 clean words, 0.33 us/word.
import { readFileSync } from 'node:fs';
import type { ReferenceCarrier } from '../types/carrier.js';

// Frequency-ordered English wordlist (exported from wordfreq at build time; static asset, no
// runtime dependency). Tiers by rank: VALID = "is a real word, leave alone"; COMMON / STRICT =
// allowed correction targets (STRICT is the proper-noun guard — Title-case words need a more
// common target before we touch them).
// Dictionaries are loaded LAZILY — the ~600 KB wordlist is read and the Sets built only on FIRST use
// (i.e. when the corrector or de-hyphenation actually runs in OCR/PDF mode), not at import time. This
// saves ~17 MB per process (and ~190 MB across the parallel benchmark's worker isolates) when OCR
// mode never fires. Missing asset -> empty dict -> the corrector degrades to a safe no-op.
interface OcrDict {
  valid: Set<string>;
  common: Set<string>;
  strict: Set<string>;
}
let dictCache: OcrDict | null = null;
function dict(): OcrDict {
  if (dictCache) return dictCache;
  let words: string[] = [];
  try {
    words = readFileSync(new URL('./ocrDictionary.txt', import.meta.url), 'utf8')
      .split('\n')
      .map((w) => w.trim())
      .filter(Boolean);
  } catch {
    // Wordlist asset not found (e.g. not copied into a compiled build). The build must copy
    // ocrDictionary.txt next to this module; otherwise the corrector is a safe no-op.
  }
  dictCache = {
    valid: new Set(words),
    common: new Set(words.slice(0, 25_000)),
    strict: new Set(words.slice(0, 8_000)),
  };
  return dictCache;
}

let domainCache: Set<string> | null = null;
function domain(): Set<string> {
  if (domainCache) return domainCache;
  try {
    domainCache = new Set(
      readFileSync(new URL('./ocrDomainWords.txt', import.meta.url), 'utf8')
        .split('\n').map((w) => w.trim().toLowerCase()).filter(Boolean),
    );
  } catch {
    domainCache = new Set<string>();
  }
  return domainCache;
}
/** Override the domain vocabulary (held-out benchmarking only). */
export function setOcrDomain(words: string[]): void {
  domainCache = new Set(words.map((w) => w.toLowerCase()));
}

/** True if `lower` (already lower-cased) is a known English or domain word. */
export function isOcrDictionaryWord(lower: string): boolean {
  return dict().valid.has(lower) || domain().has(lower);
}

/** Whether a dictionary is available (false -> callers fall back to non-dictionary heuristics). */
export function hasOcrDictionary(): boolean {
  return dict().valid.size > 0;
}

// Systematic visual OCR confusions (apply to recover the clean form). Single substitution only.
const SUBS: ReadonlyArray<readonly [string, string]> = [
  ['rn', 'm'], ['m', 'rn'], ['cl', 'd'], ['c', 'e'], ['e', 'c'], ['l', 'i'], ['i', 'l'],
  ['o', 'a'], ['a', 'o'], ['q', 'g'], ['g', 'q'], ['p', 'b'], ['b', 'p'], ['g', 't'], ['t', 'g'],
  ['d', 's'], ['s', 'd'], ['h', 'b'], ['nn', 'm'], ['vv', 'w'], ['rt', 'n'], ['ii', 'u'],
];
const SUB_SOURCES = [...new Set(SUBS.map(([a]) => a))];

// Word-bearing output fields where OCR correction is clearly beneficial and low-risk. Author/
// editor names and identifiers (doi/url/year/volume/issue/pages) are intentionally excluded.
const CORRECTABLE_FIELDS = [
  'title', 'journal', 'conferenceTitle', 'bookTitle', 'publisher', 'institution', 'siteName',
] as const;

function correctWord(word: string): string {
  if (word.length < 4 || /[A-Z]/.test(word.slice(1))) return word;  // short / acronym / mixed-case -> never touch
  const d = dict();
  if (d.valid.size === 0) return word;                     // no dictionary -> safe no-op
  const lower = word.toLowerCase();
  const dom = domain();
  if (d.valid.has(lower) || dom.has(lower)) return word;   // real English or known domain term -> never touch
  if (!SUB_SOURCES.some((s) => lower.includes(s))) return word;  // pre-filter: no confusion source
  const titleCase = /^[A-Z][a-z]+$/.test(word);
  const targets = titleCase ? d.strict : d.common;         // proper-noun guard
  const candidates = new Set<string>();
  for (const [a, b] of SUBS) {
    let i = lower.indexOf(a);
    while (i !== -1) {
      candidates.add(word.slice(0, i) + b + word.slice(i + a.length));   // preserves original case
      i = lower.indexOf(a, i + 1);
    }
  }
  // Edge insertion: recover a single dropped leading/trailing char (iomass->biomass, cultur->culture).
  // Only edges (the common OCR deletion pattern) + the single-valid-candidate gate keep it safe;
  // mid-word and multi-char deletions are deliberately NOT attempted.
  for (let k = 0; k < 26; k += 1) {
    const ch = String.fromCharCode(97 + k);
    candidates.add(ch + word);
    candidates.add(word + ch);
  }
  const valid = [...candidates].filter((c) => {
    const cl = c.toLowerCase();
    return targets.has(cl) || dom.has(cl);                 // domain terms are valid correction targets
  });
  return valid.length === 1 ? valid[0]! : word;            // single unambiguous fix only
}

/** Correct OCR errors in a text value, preserving punctuation/whitespace/casing. */
export function correctOcrText(text: string): { text: string; changed: boolean } {
  let changed = false;
  const next = text.replace(/[A-Za-z]+/g, (word) => {
    const fixed = correctWord(word);
    if (fixed !== word) changed = true;
    return fixed;
  });
  return { text: next, changed };
}

/** Apply OCR correction to the word-bearing output fields of each carrier (gated by the caller). */
export function correctOcrInFields(carriers: ReferenceCarrier[]): ReferenceCarrier[] {
  for (const carrier of carriers) {
    const fields = carrier.fields as unknown as Record<string, { value: unknown } | undefined>;
    for (const key of CORRECTABLE_FIELDS) {
      const field = fields[key];
      if (!field || typeof field.value !== 'string' || !field.value) continue;
      const { text, changed } = correctOcrText(field.value);
      if (changed) field.value = text;
    }
  }
  return carriers;
}
