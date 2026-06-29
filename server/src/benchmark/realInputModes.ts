// Real-world input-mode transforms for the benchmark corpus.
//
// The grobid-pmc corpus only ever emits `csl_rendered` strings, so the engine's
// actual moat — surviving messy *paste* (PDF copy, OCR, numbered lists) — is
// untested (the pasted_pdf_copy / ocr_like / multiline_numbered input profiles are
// empty). These transforms degrade the *input* string only; the expected_fields
// (gold) stay identical, so they measure recall under real degradation.
//
// Every transform is deterministic (seeded by a stable key) so corpora are
// reproducible, matching the rest of the benchmark's sha256-based determinism.

import { createHash } from "node:crypto";

/** Deterministic mulberry32 PRNG seeded from a stable string key. */
function seededRng(key: string): () => number {
  const seedHex = createHash("sha256").update(key).digest("hex").slice(0, 8);
  let state = Number.parseInt(seedHex, 16) >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * PDF copy-paste artifacts: hard line breaks at column-ish boundaries, with some
 * words hyphenated across the break — the single most common real failure mode for
 * pasted references. Content is preserved; the engine must reflow + de-hyphenate.
 */
export function applyPdfCopyArtifacts(formatted: string, key: string): string {
  const rng = seededRng(`pdf:${key}`);
  const words = formatted.split(" ");
  const lines: string[] = [];
  let current = "";
  // Real PDF columns wrap around 70-90 chars; vary per reference.
  const wrapAt = 68 + Math.floor(rng() * 22);

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? "";
    if (current.length + word.length + 1 <= wrapAt) {
      current = current ? `${current} ${word}` : word;
      continue;
    }
    // ~30% of wraps split the next word with a hyphen ("Communica-\ntion").
    if (word.length >= 6 && rng() < 0.3) {
      const cut = 2 + Math.floor(rng() * (word.length - 4));
      lines.push(`${current ? `${current} ` : ""}${word.slice(0, cut)}-`);
      current = word.slice(cut);
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.join("\n");
}

/** Common single-char OCR confusions (letters and digits both get misread). */
const OCR_MAP: Record<string, string> = {
  m: "rn",
  l: "1",
  I: "l",
  O: "0",
  S: "5",
  e: "c",
  g: "q",
  D: "O",
  B: "8",
  "1": "l",
  "0": "O",
};

/**
 * OCR-like degradation: a fraction of characters get a plausible OCR substitution.
 * Realistic for scanned-PDF text. Gold is unchanged, so this measures extraction
 * robustness to character noise.
 */
export function applyOcrArtifacts(formatted: string, key: string): string {
  const rng = seededRng(`ocr:${key}`);
  let out = "";
  for (const ch of formatted) {
    const repl = OCR_MAP[ch];
    out += repl !== undefined && rng() < 0.06 ? repl : ch;
  }
  return out;
}

/**
 * Numbered-list paste: the reference arrives as a numbered list item, often with a
 * line wrap — e.g. pasting a bibliography from a Word doc or webpage. Tests Phase 1/2
 * enumerator stripping + multiline reflow.
 */
export function applyNumberedMultiline(formatted: string, key: string, index: number): string {
  const rng = seededRng(`num:${key}`);
  const marker = rng() < 0.5 ? `${index + 1}. ` : `[${index + 1}] `;
  // Light wrap (one or two breaks) on top of the enumerator.
  const words = formatted.split(" ");
  const breakEvery = 9 + Math.floor(rng() * 6);
  const lines: string[] = [];
  let current = "";
  let count = 0;
  for (const word of words) {
    current = current ? `${current} ${word}` : word;
    count += 1;
    if (count >= breakEvery) {
      lines.push(current);
      current = "";
      count = 0;
    }
  }
  if (current) lines.push(current);
  return `${marker}${lines.join("\n")}`;
}

export type RealInputMode = "pdf_copy" | "ocr_like" | "numbered_block";

/** input_source_kind to stamp on the row so classifyInputProfile buckets it. */
export const REAL_INPUT_SOURCE_KIND: Record<RealInputMode, string> = {
  pdf_copy: "pdf_copy",
  ocr_like: "raw_pasted", // ocr_like = raw_pasted + noisy in classifyInputProfile
  numbered_block: "numbered_block",
};
