import type { ParsedReference, AuthorityData, ConfidenceResult } from './schema';

function extractLastName(author: string): string {
    const norm = author.toLowerCase().replace(/[^\w\s,-]/gi, '').trim();
    if (norm.includes(',')) {
        return norm.split(',')[0].trim();
    }
    const parts = norm.split(/\s+/);
    const nameParts = parts.filter(p => p.length > 1);
    return nameParts.length > 0 ? nameParts[nameParts.length - 1] : parts[parts.length - 1] || '';
}

/**
 * Calculates the final ConfidenceResult.
 *
 * Confidence is intentionally based on parser / renderer quality only.
 * External metadata lookups are displayed separately and must not raise
 * or lower the score, so first pass and recheck stay aligned.
 */
export function calculateConfidence(
    parsed: ParsedReference,
    rulesScore: number,
    _authority?: AuthorityData
): ConfidenceResult {
    let finalRulesScore = rulesScore;
    if (parsed.authors && parsed.authors.some(a => extractLastName(a).length === 1)) {
        finalRulesScore = Math.min(finalRulesScore, 80);
    }

    return {
        score: Math.max(0, Math.min(95, Math.round(finalRulesScore))),
        breakdown: { rules: finalRulesScore },
        isSuspicious: false
    };
}
