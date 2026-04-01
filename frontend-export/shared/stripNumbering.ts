/**
 * Shared utility: strip leading reference numbering from a citation line.
 * Handles these formats explicitly:
 *   [1]  [32]        — bracket-enclosed numbers
 *   1.   24.         — number + period
 *   2)   40)         — number + closing paren
 *   3 -  3 –         — number + space + dash
 *   3 Smith...       — bare number + space before capital letter
 * Also strips trailing dangling numbering like " 1." at end.
 * Used by both client (reference-input.tsx) and server (citationParser.ts).
 */
export function stripLeadingNumbering(line: string): string {
    let s = line;
    // Branch 1: [N] bracket-enclosed (IEEE style)
    s = s.replace(/^\s*\[\d+\]\s*/, '');
    // Branch 2: N. or N) or N: or N- or N– (list numbering with delimiter)
    s = s.replace(/^\s*\d+\s*[.):\-–]\s*/, '');
    // Branch 3: bare "N " before a capital letter (e.g., "3 Smith...")
    s = s.replace(/^\d+\s+(?=[A-Z])/, '');
    // Strip trailing dangling numbering: " 1." or " 24." (but NOT 4-digit years,
    // and NOT digits preceded by a word like "Article 17.")
    s = s.replace(/([^a-zA-Z])\s+\d{1,2}\.\s*$/, '$1');
    return s.trim();
}
