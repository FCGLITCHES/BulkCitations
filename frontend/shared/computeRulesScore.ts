/**
 * Shared confidence-scoring utility.
 *
 * Computes the rules-based score by deducting points for assertion
 * warnings / errors.  Centralised here so that pipeline.ts (v1),
 * reformatReferences, and routes.ts all share one implementation.
 *
 *   error:   → −20
 *   warning: → −5
 *   else     → 0
 *
 * Returns a clamped 0–100 integer.
 */
export function computeRulesScore(warnings: string[]): number {
  let score = 100;
  for (const w of warnings) {
    if (w.startsWith('error:')) score -= 20;
    else if (w.startsWith('warning:')) score -= 5;
  }
  return Math.max(0, score);
}
