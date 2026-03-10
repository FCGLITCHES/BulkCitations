import type { ParsedReference, AuthorityData, ConfidenceResult } from './schema';
import * as fuzzball from 'fuzzball';

/**
 * Normalizes a string for comparison: lowercase, remove punctuation, trim.
 */
function normalizeForComparison(str?: string): string {
    if (!str) return '';
    return str.toLowerCase().replace(/[^\w\s]/gi, '').replace(/\s+/g, ' ').trim();
}

/**
 * Extracts and normalizes the last name from an author string.
 * Example: "Smith, John", "J. Smith", "Smith J." -> "smith"
 */
function extractLastName(author: string): string {
    const norm = author.toLowerCase().replace(/[^\w\s,-]/gi, '').trim();
    // If comma format "Smith, J" -> take before comma
    if (norm.includes(',')) {
        return norm.split(',')[0].trim();
    }
    // If space format "J Smith" or "Smith J" -> try to guess
    const parts = norm.split(/\s+/);
    // Often the longest token is the last name, or just take the last token
    // A heuristic: if it's a single letter, ignore it.
    const nameParts = parts.filter(p => p.length > 1);
    return nameParts.length > 0 ? nameParts[nameParts.length - 1] : parts[parts.length - 1] || '';
}

/**
 * Validates if the authority data is structurally consistent with the original parsed data,
 * effectively preventing the DOI substitution bug where a valid DOI pulled wildly
 * incorrect literature metadata.
 */
function isAuthoritySuspicious(parsed: ParsedReference, authority: AuthorityData): boolean {
    if (!parsed.title || !authority.title) return true; // If we can't compare titles, it's suspicious.

    // 1. Title Similarity Check
    const titleScore = fuzzball.token_set_ratio(parsed.title, authority.title);
    if (titleScore < 40) { // If titles share less than 40% of their tokens
        return true;
    }

    // 2. Author Overlap Check (if both have authors)
    if (parsed.authors && parsed.authors.length > 0 && authority.authors && authority.authors.length > 0) {
        const parsedLastNames = parsed.authors.map(extractLastName);
        const authLastNames = authority.authors.map(extractLastName);

        // Check if at least one author last name overlaps between the two
        const hasOverlap = parsedLastNames.some(pName =>
            authLastNames.some(aName => fuzzball.ratio(pName, aName) > 80)
        );

        if (!hasOverlap) {
            return true;
        }
    }

    return false;
}

/**
 * Calculates journal match score (0-100).
 * If both sides lack journal, returns 100 (neutral — nothing to disagree on).
 */
export function journalMatchScore(parsedJournal?: string, authorityJournal?: string): number {
    if (!parsedJournal && !authorityJournal) return 100;
    if (!parsedJournal || !authorityJournal) return 0;

    const score = fuzzball.token_set_ratio(
        normalizeForComparison(parsedJournal),
        normalizeForComparison(authorityJournal)
    );
    return score;
}

/**
 * Calculates fields match score (0-100) based on year, vol, issue, pages overlap.
 */
export function fieldMatchScore(parsed: ParsedReference, authority: AuthorityData): number {
    let matchedFields = 0;
    let totalFields = 0;

    const compareField = (pf?: string, af?: string) => {
        if (pf && af) {
            totalFields++;
            // Extract numbers/core tokens for comparison
            const p = pf.replace(/[^\d]/g, '');
            const a = af.replace(/[^\d]/g, '');
            if (p === a && p.length > 0) matchedFields++;
            else if (fuzzball.ratio(pf.toLowerCase(), af.toLowerCase()) > 80) matchedFields++;
        } else if (pf || af) {
            // One has it missing, it's a slight penalty to confidence, but keep it mostly neutral
            // depending on strictness. We'll count it as a total field, missed.
            totalFields++;
        }
    };

    compareField(parsed.year, authority.year);
    compareField(parsed.volume, authority.volume);
    compareField(parsed.issue, authority.issue);
    compareField(parsed.pages, authority.pages);

    if (totalFields === 0) return 100; // No fields to compare — neutral
    return Math.round((matchedFields / totalFields) * 100);
}

/**
 * Calculates the final ConfidenceResult.
 *
 * Authority should slightly adjust confidence (≈5–10%), not dominate it.
 * We treat rulesScore as the primary signal and use authority as a small
 * corrective factor on top.
 */
export function calculateConfidence(
    parsed: ParsedReference,
    rulesScore: number,
    authority?: AuthorityData
): ConfidenceResult {

    // Base case: No authority data (Free tier or lookup failed / recheck no match)
    // Score rule check: Automatically penalize rule score if we detected single-letter surnames
    let finalRulesScore = rulesScore;
    if (parsed.authors && parsed.authors.some(a => extractLastName(a).length === 1)) {
        finalRulesScore = Math.min(finalRulesScore, 75);
    }

    // No authority: trust rulesScore directly (with a soft cap), since we cannot adjust with metadata.
    if (!authority) {
        return {
            score: Math.max(0, Math.min(95, Math.round(finalRulesScore))),
            breakdown: { rules: finalRulesScore },
            isSuspicious: false
        };
    }

    // Suspicion check to prevent DOI substitution bug
    const suspicious = isAuthoritySuspicious(parsed, authority);

    if (suspicious) {
        return {
            score: Math.min(finalRulesScore, 40), // Hard cap at low confidence
            breakdown: { rules: finalRulesScore },
            isSuspicious: true
        };
    }

    // Calculate distinct vector matches
    const jScore = journalMatchScore(parsed.journal, authority.journal);
    const fScore = fieldMatchScore(parsed, authority);

    // Calculate blended formula:
    // - rulesScore: 90% weight
    // - authority-based similarity (journal/fields): 10% weight
    const authorityComponent = Math.round((jScore * 0.5) + (fScore * 0.5));
    const finalScore = Math.round(
        (finalRulesScore * 0.9) +
        (authorityComponent * 0.1)
    );

    return {
        score: Math.max(0, Math.min(100, finalScore)),
        breakdown: {
            journal: jScore,
            fields: fScore,
            rules: finalRulesScore
        },
        isSuspicious: false
    };
}
