/**
 * Branded/nominal types for citation text processing pipeline.
 *
 * Enforces at compile time the invariant:
 *   string → RawReferenceText → PreNormalizedText → parsers
 *
 * Only `toRawReferenceText()` can produce RawReferenceText (HTTP boundary).
 * Only `preNormalize()` can produce PreNormalizedText (in citationParser.ts).
 * Parsers accept only PreNormalizedText — they physically cannot see raw input.
 */

// ── Branded type: raw user input acknowledged as a reference ──
declare const rawBrand: unique symbol;
export type RawReferenceText = string & { readonly [rawBrand]: 'RawReferenceText' };

// ── Branded type: text that has passed through preNormalize() ──
declare const preNormalizedBrand: unique symbol;
export type PreNormalizedText = string & { readonly [preNormalizedBrand]: 'PreNormalizedText' };

/**
 * Mark a raw string as RawReferenceText.
 * Call this ONLY at the HTTP/API boundary (server/routes.ts).
 * No validation — just the type-level acknowledgement that this is user input.
 */
export function toRawReferenceText(s: string): RawReferenceText {
    return s as RawReferenceText;
}
