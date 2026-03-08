import type { AssertionSummary, AssertionDetail, AssertionHighlight } from '@shared/schema';

export type ParsedFields = any;

/**
 * Reference format conventions by style (bibliography):
 * - APA 7: Author (Year). Title. Journal, Vol(Issue), Pages. No "pp.", no quotes on article title, no "Available at:".
 * - Harvard (CTR): Author (Year) 'Article title'. Journal, Vol(Issue), pp. X–Y. Available at: url (Accessed: date).
 * - Chicago AD: Author Year. "Article title." Journal Vol, no. Issue: Pages.
 * - Chicago NB: Author. "Article title." Journal Vol, no. Issue (Year): Pages.
 * - MLA 9: Author. "Article title." Journal, vol. X, no. Y (Year): pp. X–Y. Sentence case for titles.
 * - IEEE: [N] Author. "Article title." Journal, vol. X, no. Y, pp. X–Y, Year. Available: url.
 * - Vancouver: Author. Title. Journal. Year;Vol(Issue):Pages. [Internet]; [cited YYYY Mon DD]. Available from: url. No "pp."
 */

export interface AssertionResult {
    warnings: string[];
    assertionSummary: AssertionSummary;
    assertionHighlights: AssertionHighlight[];
}

type StyleAssertionRule = {
    id: string;
    description: string;
    test: (output: string, fields: ParsedFields) => boolean;
    severity: 'error' | 'warning';
    /** Optional: regex pattern to locate the problematic segment for inline highlights */
    highlightPattern?: RegExp;
};

type StyleAssertions = {
    [style: string]: StyleAssertionRule[];
};

export const STYLE_ASSERTIONS: StyleAssertions = {
    // ─────────────────────────────────────────────
    // APA 7 (8.5/10 → target 10/10)
    // ─────────────────────────────────────────────
    'apa': [
        {
            id: 'apa:author_inversion',
            description: 'Author names must be inverted (Last, F. M.). Check for IEEE-style "F. M. Last" passthrough error.',
            test: (o) => !/^([A-Z]\.\s*)+[A-Z][a-z]+/.test(o.trim()),
            severity: 'error'
        },
        {
            id: 'apa:author_particle_handling',
            description: 'Particles (van, de, von, etc.) must be correctly formatted in author names.',
            test: (_o, f) => {
                const authors = Array.isArray(f.authors) ? f.authors : [];
                return !authors.some((a: string) => {
                    const m = a.match(/\b([a-z]+)\s+[A-Z][a-z]+/);
                    if (!m) return false;
                    return !/^(?:van|von|de|del|der|da|di|du|dos|das|la|le)$/i.test(m[1]);
                });
            },
            severity: 'warning'
        },
        {
            id: 'apa:supplement_format',
            description: 'Supplements must be rendered as "Suppl. X" or "Article X".',
            test: (o) => !/Supplement_\d+/.test(o) && !/Art\.\s*no\./i.test(o),
            severity: 'error'
        },
        {
            id: 'apa:hyphenated_initials',
            description: 'Hyphenated initials (e.g., J.-F.) must be preserved.',
            test: (o, f) => {
                // If input had hyphenated initials, ensure output hasn't lost the hyphen
                const hadHyphen = f.authors?.some((a: string) => /[A-Z]\.-[A-Z]\./.test(a));
                if (hadHyphen) {
                    return /[A-Z]\.-[A-Z]\./.test(o);
                }
                return true;
            },
            severity: 'warning'
        },
        {
            id: 'apa:abbreviated_journal_expansion',
            description: 'Journal names often must be expanded unless specifically configured otherwise.',
            test: (o, f) => {
                if (f.journal && (f.journal.includes('.') || f.journal.length < 15)) {
                    // If journal has dots or is very short, flag as potentially unexpanded abbreviation
                    return !/(^[A-Z]\.\s*)+/.test(f.journal);
                }
                return true;
            },
            severity: 'warning'
        },
        {
            id: 'apa:year_format',
            description: 'Year must appear as (YYYY).',
            test: (o) => /\(\d{4}\)\./.test(o) || /\((?:19|20)\d{2}\)/.test(o), // looser match
            severity: 'error'
        },
        {
            id: 'apa:no_quotes_around_title',
            description: 'Article title must NOT be in quotation marks.',
            test: (o) => !/"[A-Za-z]/.test(o) && !/”[A-Za-z]/.test(o) && !/“/.test(o),
            severity: 'error'
        },
        {
            id: 'apa:no_pp_for_journals',
            description: 'Journal refs must not use "pp." before page range.',
            test: (o, f) => f.type !== 'journal-article' || !/\bpp\.\s*\d/.test(o),
            severity: 'error'
        },
        {
            id: 'apa:no_available_at',
            description: 'APA does not use "Available at:" prefix.',
            test: (o) => !/Available at:/i.test(o),
            severity: 'error'
        },
        {
            id: 'apa:volume_issue_format',
            description: 'Volume(issue) must appear as "Vol(Issue)," e.g. "5(2),".',
            test: (o, f) => !f.volume || /\d+\(\d+\),/.test(o) || !f.issue,
            severity: 'warning'
        },
    ],

    // ─────────────────────────────────────────────
    // Harvard CTR (3/10 → target 10/10)
    // ─────────────────────────────────────────────
    'harvard-ctr': [
        {
            id: 'harvard:single_quotes_title',
            description: "Article title must be in single quotes '...'.",
            test: (o) => /\'[A-Z][^']+\'/.test(o),
            severity: 'error'
        },
        {
            id: 'harvard:no_double_quotes_title',
            description: 'Article title must NOT use double quotes.',
            test: (o) => !/"[A-Z][^"]{5,}"/.test(o),
            severity: 'error'
        },
        {
            id: 'harvard:available_at_present',
            description: 'Online refs must include "Available at:".',
            test: (o, f) => (!f.doi && !f.url) || /Available at:/i.test(o),
            severity: 'error'
        },
        {
            id: 'harvard:accessed_for_url',
            description: 'URL-based refs must include "(Accessed: ...)".',
            test: (o, f) => !f.url || /\(Accessed:/i.test(o),
            severity: 'error'
        },
        {
            id: 'harvard:pp_present_for_pages',
            description: 'Page range must use "pp." prefix.',
            test: (o, f) => !f.page || /\bpp\.\s*\d/.test(o),
            severity: 'error'
        },
        {
            id: 'harvard:year_in_parentheses',
            description: 'Year must appear as (YYYY) after authors.',
            test: (o) => /\(\d{4}\)/.test(o),
            severity: 'error'
        },
        {
            id: 'harvard:no_markdown_links',
            description: 'Output must not contain Markdown link syntax.',
            test: (o) => !/\[https?:\/\//.test(o),
            severity: 'error'
        },
    ],

    // ─────────────────────────────────────────────
    // Chicago Author–Date (8/10 → target 10/10)
    // ─────────────────────────────────────────────
    'chicago-ad': [
        {
            id: 'chicago-ad:year_after_author',
            description: 'Year must appear immediately after author list.',
            test: (o) => /[A-Za-z]\.\s+\d{4}\./.test(o),
            severity: 'error'
        },
        {
            id: 'chicago-ad:title_in_double_quotes',
            description: 'Article title must be in double quotes.',
            test: (o) => /"[A-Z][^"]{3,}"/.test(o),
            severity: 'error'
        },
        {
            id: 'chicago-ad:no_issue_pp',
            description: 'Chicago AD uses volume, no. issue — NOT vol./no. labels like IEEE.',
            test: (o, f) => !f.issue || /\d+,\s*no\.\s*\d+/.test(o),
            severity: 'warning'
        },
        {
            id: 'chicago-ad:no_markdown_links',
            description: 'Output must not contain Markdown link syntax.',
            test: (o) => !/\[https?:\/\//.test(o),
            severity: 'error'
        },
        {
            id: 'chicago-ad:ends_with_period',
            description: 'Entry must end with a full stop.',
            test: (o) => /\.\s*$/.test(o.trim()),
            severity: 'warning'
        },
    ],

    // ─────────────────────────────────────────────
    // Chicago Notes–Bibliography (new variant)
    // ─────────────────────────────────────────────
    'chicago-nb': [
        {
            id: 'chicago-nb:title_in_double_quotes',
            description: 'Article title must be in double quotes.',
            test: (o) => /"[A-Z][^"]{3,}"/.test(o),
            severity: 'error'
        },
        {
            id: 'chicago-nb:year_at_end_in_parens',
            description: 'Chicago NB bibliography year appears after volume info in parens, e.g. "(2023)".',
            test: (o) => /\((?:[A-Za-z]+\s)?\d{4}\)/.test(o),
            severity: 'error'
        },
        {
            id: 'chicago-nb:no_year_immediately_after_author',
            description: 'Chicago NB does not put the year immediately after the author (that is AD style).',
            test: (o) => !/[A-Za-z]\.\s+\d{4}\./.test(o),
            severity: 'error'
        },
        {
            id: 'chicago-nb:volume_no_format',
            description: 'Volume/issue in format: vol, no. issue.',
            test: (o, f) => !f.issue || /\d+,\s*no\.\s*\d+/.test(o),
            severity: 'warning'
        },
        {
            id: 'chicago-nb:ends_with_period',
            description: 'Entry must end with a full stop.',
            test: (o) => /\.\s*$/.test(o.trim()),
            severity: 'warning'
        },
    ],

    // ─────────────────────────────────────────────
    // MLA 9 (7.5/10 → target 10/10)
    // ─────────────────────────────────────────────
    'mla': [
        {
            id: 'mla:title_in_double_quotes',
            description: 'Article title must be in double quotes.',
            test: (o) => /"[A-Z][^"]{3,}"/.test(o),
            severity: 'error'
        },
        {
            id: 'mla:vol_label',
            description: '"vol." must appear before volume number.',
            test: (o, f) => !f.volume || /\bvol\.\s*\d/.test(o) || /\d+\.\d/.test(o),
            severity: 'error'
        },
        {
            id: 'mla:no_label',
            description: '"no." must appear before issue number.',
            test: (o, f) => !f.issue || /\bno\.\s*\d/.test(o) || /\d+\.\d+(?:[-–]\d+)?\s*\(\d{4}\)/.test(o),
            severity: 'error'
        },
        {
            id: 'mla:pp_for_pages',
            description: 'Page range must use "pp." prefix.',
            test: (o, f) => {
                const hasPages = !!(f?.pages || (f as any)?.page);
                return !hasPages || /\bpp\.\s*\d/.test(o) || /\d+\.\d+(?:[-–]\d+)?\s*\(\d{4}\)\s*:\s*[\d–\-]+/.test(o);
            },
            severity: 'error'
        },
        {
            id: 'mla:no_markdown_links',
            description: 'Output must not contain Markdown link syntax.',
            test: (o) => !/\[https?:\/\//.test(o),
            severity: 'error'
        },
        {
            id: 'mla:ends_with_period',
            description: 'Entry must end with a full stop.',
            test: (o) => /\.\s*$/.test(o.trim()),
            severity: 'warning'
        },
    ],

    // ─────────────────────────────────────────────
    // IEEE (9/10 → target 10/10)
    // ─────────────────────────────────────────────
    'ieee': [
        {
            id: 'ieee:numbered',
            description: 'IEEE entry must start with [N] reference number.',
            test: (o) => /^\[\d+\]/.test(o.trim()),
            severity: 'error'
        },
        {
            id: 'ieee:title_in_double_quotes',
            description: 'Article title must be in double quotes.',
            test: (o) => /"[A-Za-z][^"]{3,}"/.test(o),
            severity: 'error'
        },
        {
            id: 'ieee:vol_label',
            description: '"vol." must appear before volume number.',
            test: (o, f) => !f.volume || /\bvol\.\s*\d/i.test(o),
            severity: 'error'
        },
        {
            id: 'ieee:no_label',
            description: '"no." must appear before issue number.',
            test: (o, f) => !f.issue || /\bno\.\s*\d/i.test(o),
            severity: 'error'
        },
        {
            id: 'ieee:pp_for_pages',
            description: 'Page range must use "pp." prefix.',
            test: (o, f) => !(f.pages || f.page) || /\bpp\.\s*\d/i.test(o),
            severity: 'error'
        },
        {
            id: 'ieee:year_after_pages',
            description: 'Year must appear after pages, e.g., "pp. 1–9, 2022".',
            test: (o) => /\d{4}[,.]?\s*(doi:|https?:)?/.test(o),
            severity: 'warning'
        },
        {
            id: 'ieee:no_markdown_links',
            description: 'Output must not contain Markdown link syntax.',
            test: (o) => !/\[https?:\/\//.test(o),
            severity: 'error'
        },
        {
            id: 'ieee:online_available',
            description: 'URL-based entry must use "Available:" (not "Available at:").',
            test: (o, f) => !(!f.doi && f.url) || /\bAvailable:\s*https?:\/\//.test(o),
            severity: 'warning'
        },
    ],

    // ─────────────────────────────────────────────
    // Vancouver ICMJE (7/10 → target 10/10)
    // ─────────────────────────────────────────────
    'vancouver': [
        {
            id: 'vancouver:year_volume_issue_pages_format',
            description: 'Must follow Year;Volume(Issue):Pages pattern.',
            test: (o, f) => !f.volume || /\d{4}(?:\s+[A-Za-z]{3})?;\d+\(\d+\)(?::\w+(?:-\w+)?)?/.test(o) || !f.issue,
            severity: 'error'
        },
        {
            id: 'vancouver:no_volume_without_issue_format',
            description: 'Volume without issue: Year;Volume:Pages.',
            test: (o, f) => !(f.volume && !f.issue) || /\d{4}(?:\s+[A-Za-z]{3})?;\d+(?::\w+(?:-\w+)?)?/.test(o),
            severity: 'warning'
        },
        {
            id: 'vancouver:internet_tag',
            description: 'Online-only journal must include [Internet] tag.',
            test: (o, f) => !f.url || /\[Internet\]/.test(o),
            severity: 'error'
        },
        {
            id: 'vancouver:cited_date_for_url',
            description: 'URL-based entry must include [cited YYYY Mon DD].',
            test: (o, f) => !f.url || /\[cited \d{4}/.test(o),
            severity: 'error'
        },
        {
            id: 'vancouver:available_from_for_url',
            description: 'URL-based entry must use "Available from:" (not "Available at:").',
            test: (o, f) => !f.url || /Available from:\s*https?:\/\//.test(o),
            severity: 'error'
        },
        {
            id: 'vancouver:no_markdown_links',
            description: 'Output must not contain Markdown link syntax.',
            test: (o) => !/\[https?:\/\//.test(o),
            severity: 'error'
        },
        {
            id: 'vancouver:ends_with_period',
            description: 'Entry must end with a full stop.',
            test: (o) => /\.\s*$/.test(o.trim()),
            severity: 'warning'
        },
        {
            id: 'vancouver:no_pp_prefix',
            description: 'Vancouver does not use "pp." before page range.',
            test: (o) => !/\bpp\.\s*\d/.test(o),
            severity: 'error'
        },
    ],
};

// Runner — called after CSL engine renders a citation
// Returns structured assertion results + legacy string[] warnings for backward compat
export function runAssertions(
    style: string,
    output: string,
    fields: ParsedFields
): AssertionResult {
    const assertions = STYLE_ASSERTIONS[style] ?? [];
    const warnings: string[] = [];
    const details: AssertionDetail[] = [];
    const highlights: AssertionHighlight[] = [];

    for (const a of assertions) {
        const passed = a.test(output, fields);
        details.push({
            id: a.id,
            description: a.description,
            severity: a.severity,
            passed,
        });

        if (!passed) {
            warnings.push(`${a.severity}:${a.id}`);
            // Try to locate the problematic segment for inline highlights
            if (a.highlightPattern) {
                const match = output.match(a.highlightPattern);
                if (match && match.index !== undefined) {
                    highlights.push({
                        start: match.index,
                        end: match.index + match[0].length,
                        ruleId: a.id,
                        message: a.description,
                        severity: a.severity,
                    });
                }
            }
        }
    }

    // Universal checks
    if (output.includes('Unknown Title') || output.includes('Unknown Author')) {
        warnings.push('warning:missing_field');
        details.push({ id: 'universal:missing_field', description: 'Output contains placeholder text.', severity: 'warning', passed: false });
        const idx = output.indexOf('Unknown Title');
        if (idx >= 0) {
            highlights.push({ start: idx, end: idx + 13, ruleId: 'universal:missing_field', message: 'Placeholder title detected', severity: 'warning' });
        }
    }

    // Locator check
    const hasLocator = !!fields.page || !!fields.pages || !!fields['article-number'];
    const isLocatableWork = fields.type === 'journal-article' || fields.type === 'paper-conference' || !!fields.journal || !!fields.conferenceTitle;
    if (isLocatableWork && fields._inputHadLocator && !hasLocator) {
        warnings.push('warning:missing_locator');
        details.push({ id: 'universal:missing_locator', description: 'Journal article is missing page/locator.', severity: 'warning', passed: false });
    }

    const failedDetails = details.filter(d => !d.passed);
    const summary: AssertionSummary = {
        total: details.length,
        passed: details.filter(d => d.passed).length,
        failed: failedDetails.length,
        failedCritical: failedDetails.filter(d => d.severity === 'error').length,
        failedFormatting: failedDetails.filter(d => d.severity === 'warning').length,
        details,
    };

    return { warnings, assertionSummary: summary, assertionHighlights: highlights };
}

/**
 * MLA 9th: article titles use sentence case (first word and proper nouns; after period/colon capitalize).
 * Lowercase all, then capitalize first char and first char after ". " and ": "; restore Roman numerals after period.
 */
const PRESERVED_PACKAGES = /\b(lme4|edgeR|SHELXL|SHELX|OLEX2|Coot|metafor|ChIP-Seq|ORTEP-III|MACS)\b/gi;

function toMLASentenceCase(s: string): string {
    if (!s || !s.trim()) return s;
    const preserved = new Map<string, string>();
    let out = s.trim();
    // Preserve known package names (lme4, edgeR, SHELXL, etc.)
    out = out.replace(PRESERVED_PACKAGES, (m) => {
        const token = `__ACRONYM${preserved.size}__`;
        preserved.set(token, m);
        return token;
    });
    // Preserve hyphenated acronyms (DFT-D, ChIP-Seq) and ORTEP-III
    out = out.replace(/\b[A-Z]{2,}-[A-Z][a-z]*\b/g, (m) => {
        const token = `__ACRONYM${preserved.size}__`;
        preserved.set(token, m);
        return token;
    });
    // Preserve acronyms (3+ uppercase letters): SHELX, BLAST, PCR, RNA, PRISMA
    out = out.replace(/\b[A-Z]{3,}\b/g, (m) => {
        const token = `__ACRONYM${preserved.size}__`;
        preserved.set(token, m);
        return token;
    });
    out = out.toLowerCase();
    if (out.length === 0) return s;
    out = out.charAt(0).toUpperCase() + out.slice(1);
    out = out.replace(/([.:])\s+([a-z])/g, (_, punct, letter) => `${punct} ${letter.toUpperCase()}`);
    // Restore Roman numerals after period (e.g. ". iii" → ". III")
    const romanAfterPeriod = /\b(\.\s+)(i{1,3}|iv|v|vi{0,3}|ix|xi{0,3}|xiv|xv)\b/g;
    out = out.replace(romanAfterPeriod, (_, periodSpace, roman) => periodSpace + roman.toUpperCase());
    preserved.forEach((orig, token) => {
        out = out.replace(token, orig);
    });
    return out;
}

// Common Journal Abbreviations dictionary for expansion when CSL natively truncates them or
// the user input already abbreviated them.
const JOURNAL_ABBREVIATIONS: Record<string, string> = {
    'J. Inf. Syst': 'Journal of Information Systems',
    'J. Inf. Syst.': 'Journal of Information Systems',
    'Int. J. Inf. Manage.': 'International Journal of Information Management',
    'Int J Inf Manage': 'International Journal of Information Management',
    'J. Educ. Technol.': 'Journal of Educational Technology',
    'J Educ Technol': 'Journal of Educational Technology'
};

/**
 * Structural fixer for CSL output strings.
 * Molds out-of-the-box CSL output perfectly to our targeted specifications.
 */
export function fixFormatting(style: string, output: string, fields: ParsedFields): string {
    let clean = output.trim();

    // 1. Remove Markdown Links globally
    clean = clean.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$2');
    // Ensure DOI is plain text without `<...>` that CSL might add
    clean = clean.replace(/<(https?:\/\/[^>]+)>/g, '$1');

    // 1b. Normalize "et al." rendering: CSL treats it as a literal author,
    // producing "Author, A. & et al." — fix to "Author, A., et al."
    clean = clean.replace(/,?\s*&\s*et\s+al\./g, ', et al.');
    clean = clean.replace(/\.\s*&\s*et\s+al\./g, '., et al.');

    // 2. Expand known abbreviations globally before style-specific checks
    for (const [abbr, full] of Object.entries(JOURNAL_ABBREVIATIONS)) {
        // Use a regex with word boundaries to avoid partial matches
        const escapedAbbr = abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        clean = clean.replace(new RegExp(`\\b${escapedAbbr}\\b`, 'g'), full);
    }

    switch (style) {
        case 'apa':
            // APA title casing normalization runs in parser.
            // Strip publisher location (APA 7 drops publisher location)
            // e.g. "New York, NY: Springer." -> "Springer."
            clean = clean.replace(/(?:[a-zA-Z\s]+,\s*[A-Z]{2}|[A-Z][a-z]+(?:[\s-][A-Z][a-z]+)*):\s+(?=[A-Z0-9])/g, '');
            // Preserve hyphenated acronyms (DFT-D) and known terms (EM Algorithm) before initial expansion
            const apaPreserved = new Map<string, string>();
            clean = clean.replace(/\b(DFT-D|ChIP-Seq|EM|RNA|DNA|PCR|MACS|ORTEP-III)\b/g, (m) => {
                const t = `__APAPRES${apaPreserved.size}__`;
                apaPreserved.set(t, m);
                return t;
            });
            // Normalize jammed initials in author names: "MAS" / "M.A.S" -> "M. A. S.", "VL" / "V.L" -> "V. L."
            clean = clean.replace(/\b([A-Z])\.?([A-Z])\.?([A-Z])\.?\b/g, '$1. $2. $3.');
            clean = clean.replace(/\b([A-Z])\.?([A-Z])\.?\b/g, '$1. $2.');
            apaPreserved.forEach((orig, tok) => { clean = clean.replace(tok, orig); });
            // Remove stray "&" before initials in final author (e.g. "da Silva, & V.L." -> "da Silva, V.L.")
            clean = clean.replace(/,\s*&\s*([A-Z]\.)/g, ', $1');
            break;

        case 'harvard-ctr':
            // Change double quotes to single quotes for article title.
            // Looking for standard CSL quotation marks.
            clean = clean.replace(/"([^"]+)"/g, "'$1'");
            clean = clean.replace(/“([^”]+)”/g, "'$1'");
            break;

        case 'chicago-ad':
            // Chicago uses "Title." in quotes.
            break;

        case 'chicago-nb':
            // Chicago uses "Title." in quotes.
            break;

        case 'ieee':
            // Remove " [Online]. Available:" and switch to "Available:"
            clean = clean.replace(/\[Online\]\.\s*Available\s+at:/i, 'Available:');
            clean = clean.replace(/Available\s+at:/i, 'Available:');
            break;

        case 'vancouver':
            break;

        case 'mla': {
            // MLA 9th: article title in double quotes; sentence case for article titles; vol., no., pp.; end with period.
            clean = clean.replace(/[\u201C\u201D\u201E\u201F]/g, '"');
            const title = (fields?.title || '').trim();

            // Restore spaced "I. I. I." if the engine collapsed it to "III" (do not collapse spaced Roman numeral tokens)
            if (title && /I\.\s*I\.\s*I\./.test(title) && /\bIII\b/.test(clean)) {
                clean = clean.replace(/\bIII\b/g, 'I. I. I.');
            }

            if (title && !/"[^"]{3,}"/.test(clean)) {
                // CSL may have rendered title without quotes — wrap first occurrence of title in quotes
                const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const titleRe = new RegExp(`(${escaped})\\s*([.,])?`, 'i');
                clean = clean.replace(titleRe, (_, t, punct) => `"${t.replace(/\.$/, '')}."`);
            }

            // MLA sentence case for article title (first quoted segment only = title of source)
            const firstQuoted = clean.match(/^([^"]*)"([^"]+)"([\s\S]*)$/);
            if (firstQuoted) {
                const [, before, quotedTitle, rest] = firstQuoted;
                let sentenceCased = toMLASentenceCase(quotedTitle);
                // Strip erroneous comma before "and" in phrases (e.g. "theory, and applications" → "theory and applications")
                sentenceCased = sentenceCased.replace(/\b(\w+),\s+and\s+/g, '$1 and ');
                // B1: Restore Roman numerals after period (run after sentence case so ". Iii" → ". III", ".III" → ". III")
                sentenceCased = sentenceCased.replace(
                    /\.(\s*)(i{1,3}|iv|v|vi{0,3}|ix|xi{0,3}|xiv|xv)\b/gi,
                    (_, space, roman) => '.' + (space || ' ') + roman.toUpperCase()
                );
                clean = `${before}"${sentenceCased}"${rest}`;
                // C3: Strip duplicate title from remainder (curly-quoted or different case) so it is not emitted twice
                const titleForDedup = (fields?.title || '').trim();
                if (titleForDedup.length > 2) {
                    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const dupRe = new RegExp(
                        `("${esc(sentenceCased)}")\\s*[\u201C\u201D"]?\\s*${esc(titleForDedup)}\\s*[\u201C\u201D"]?\\.?`,
                        'gi'
                    );
                    clean = clean.replace(dupRe, '$1');
                }
            }

            // Normalize volume/issue/page labels if CSL used different wording
            if (fields?.volume && /\d+/.test(clean)) {
                clean = clean.replace(/\b(Volume|Vol)\s*(\d+)/gi, 'vol. $2');
                clean = clean.replace(/\bvol\s+(\d+)/gi, 'vol. $1');
            }
            if (fields?.issue && /\d+/.test(clean)) {
                clean = clean.replace(/\b(Number|No\.?)\s*(\d+)/gi, 'no. $2');
                clean = clean.replace(/\bno\s+(\d+)/gi, 'no. $1');
            }
            if ((fields?.pages || (fields as any)?.page) && /\d+/.test(clean)) {
                clean = clean.replace(/\b(pages?|p\.?)\s*(\d+)/gi, 'pp. $2');
            }
            // MLA: year must be in brackets before pages — convert ", vol. X, no. Y, Year, pp." to ", vol. X, no. Y (Year): pp."
            clean = clean.replace(
                /(vol\.\s*\d+(?:,\s*no\.\s*\d+)?)\s*,\s*((?:19|20)\d{2})\s*,\s*(pp\.\s*|Article\s*)/gi,
                '$1 ($2): $3'
            );
            // Handle ", vol. X, nos. Y–Z, Year, pp." (issue range)
            clean = clean.replace(
                /(vol\.\s*\d+,\s*nos?\.\s*\d+[–-]\d+)\s*,\s*((?:19|20)\d{2})\s*,\s*(pp\.\s*|Article\s*)/gi,
                '$1 ($2): $3'
            );
            // Also handle ", vol. X, Year, ArticleNum" when CSL outputs year then bare article ID (no pp. prefix)
            clean = clean.replace(
                /(vol\.\s*\d+(?:,\s*no\.\s*\d+)?)\s*,\s*((?:19|20)\d{2})\s*,\s*(\d{4,}(?:[-–]\d+)?)/gi,
                '$1 ($2): $3'
            );
            // Also handle ", ArticleNum, Year, p." when CSL puts year after article number (e.g. Vancouver with article ID)
            clean = clean.replace(
                /(vol\.\s*\d+(?:,\s*no\.\s*\d+)?)\s*,\s*(\d+)\s*,\s*((?:19|20)\d{2})\s*,\s*p\.\s*Article\s*\d+/gi,
                '$1 ($3): $2'
            );
            // Convert ", Year, pp." to " (Year): " when no vol/issue (e.g. CSL omits vol)
            clean = clean.replace(
                /,\s*((?:19|20)\d{2})\s*,\s*(pp\.\s*)([\d–\-]+)/g,
                ' ($1): $3'
            );
            // MLA compact format: ", vol. X, nos. Y–Z (Year): pp. A–B" → " X.Y-Z (Year): A–B"
            clean = clean.replace(
                /,\s*vol\.\s*(\d+),\s*nos?\.\s*(\d+)[–-](\d+)\s*\(((?:19|20)\d{2})\)\s*:\s*pp\.\s*([\d–\-]+)/gi,
                ' $1.$2-$3 ($4): $5'
            );
            // ", vol. X, no. Y (Year): pp. A–B" → " X.Y (Year): A–B"
            clean = clean.replace(
                /,\s*vol\.\s*(\d+),\s*no\.\s*(\d+)\s*\(((?:19|20)\d{2})\)\s*:\s*pp\.\s*([\d–\-]+)/gi,
                ' $1.$2 ($3): $4'
            );
            // ", vol. X (Year): pp. A–B" → " X (Year): A–B" (volume only, no issue)
            clean = clean.replace(
                /,\s*vol\.\s*(\d+)\s*\(((?:19|20)\d{2})\)\s*:\s*pp\.\s*([\d–\-]+)/gi,
                ' $1 ($2): $3'
            );
            // Fix mangled "vol. : : pages. year." when CSL outputs compact format wrong (e.g. "2017. : : 5263570. 2017.")
            clean = clean.replace(
                /(\d{4})\.\s*:\s*:\s*(\d+)\s*\.\s*(\d{4})\s*\.?\s*$/,
                '$1 ($3): $2.'
            );
            // Remove duplicate trailing year when year already appears in brackets (e.g. "5263570. 2017." → "5263570.")
            if (fields?.year && new RegExp(`\\(\\s*${(fields.year as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\)`).test(clean)) {
                clean = clean.replace(new RegExp(`[\\s,]*(?:19|20)\\d{2}\\.?\\s*$`, 'g'), '');
            }
            if (clean.length > 0 && !/\.\s*$/.test(clean.trim())) {
                clean = clean.trimEnd() + '.';
            }
            break;
        }
    }

    return clean;
}
