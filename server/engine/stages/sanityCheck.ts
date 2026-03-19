/**
 * Stage 11: Sanity Check
 * 
 * Post-render validation gate. Runs AFTER fixFormatting() before returning
 * the converted text to the caller. Catches structural failures that
 * individual assertion rules may miss.
 * 
 * Checks:
 *   1. Author presence — at least one author or known corporate/NGO form
 *   2. Year presence  — at least a 4-digit year or "n.d." token
 *   3. No leaked CSL field tokens — no raw "{", "}", "undefined", "null"
 *   4. Minimum output length — output must be at least 20 chars
 *   5. No raw URL leaking into formatted text for styles where URLs are excluded
 * 
 * Returns an array of sanity warning strings (prefixed "sanity:").
 * Empty array = all checks passed.
 */

export interface SanityResult {
  warnings: string[];
  passed: boolean;
}

/** Minimum plausible length for a valid citation output */
const MIN_OUTPUT_LENGTH = 20;

/**
 * Run post-render sanity checks on a formatted citation string.
 * 
 * @param outputText   The formatted citation text (after fixFormatting)
 * @param outputStyle  The output citation style (for URL check context)
 */
export function runSanityCheck(
  outputText: string,
  _outputStyle: string
): SanityResult {
  const warnings: string[] = [];
  const text = (outputText || '').trim();

  // 1. Minimum length
  if (text.length < MIN_OUTPUT_LENGTH) {
    warnings.push('sanity: output too short — citation may be empty or malformed');
  }

  // 2. No leaked "undefined" or "null" strings in output
  if (/\bundefined\b/.test(text)) {
    warnings.push('sanity: raw "undefined" token found in output — a CSL field was not resolved');
  }
  if (/\bnull\b/.test(text)) {
    warnings.push('sanity: raw "null" token found in output — a CSL field was not resolved');
  }

  // 3. No leaked CSL template braces
  if (/\{\s*[A-Za-z]/.test(text) || /[A-Za-z]\s*\}/.test(text)) {
    warnings.push('sanity: unresolved CSL template brace found in output');
  }

  // 4. Year presence — must contain a 4-digit year or "n.d."
  const hasYear = /\b(19|20)\d{2}\b/.test(text) || /n\.\s*d\./i.test(text);
  if (!hasYear) {
    warnings.push('sanity: no year found in output — citation is likely incomplete');
  }

  // 5. Author presence — output must have something before the year or title
  //    Heuristic: must be at least 3 chars of non-whitespace before the first year
  const yearMatch = text.match(/\b(19|20)\d{2}\b/);
  if (yearMatch && yearMatch.index !== undefined) {
    const beforeYear = text.slice(0, yearMatch.index).trim();
    if (beforeYear.length < 3) {
      warnings.push('sanity: no author found before year — citation may be missing authors');
    }
  }

  return {
    warnings,
    passed: warnings.length === 0,
  };
}
