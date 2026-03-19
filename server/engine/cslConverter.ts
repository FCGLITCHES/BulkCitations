import Cite from 'citation-js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ParsedReference, CitationStyle, ReferenceType } from '@shared/schema';

/**
 * CSL-powered Citation Converter
 * 
 * Uses citation-js (citeproc-js under the hood) for formatting output.
 * This is the industry-standard CSL engine that powers Zotero, Mendeley, etc.
 * 
 * Architecture:
 *   Our custom parser (regex-based) → ParsedReference → CSL-JSON → citeproc → formatted string
 *   
 * Why hybrid:
 *   - No JS library can parse free-text citations (that requires our custom regex parser)
 *   - But formatting OUTPUT is perfectly handled by the CSL engine with 10,000+ styles
 *   - This gives us pixel-perfect formatting for every style
 */

let stylesLoaded = false;

/**
 * Initialize CSL styles. Call this once at server startup.
 */
export function initCSLStyles(): void {
    if (stylesLoaded) return;

    try {
        const config = (Cite as any).plugins.config.get('@csl');

        // Load custom CSL style files for Chicago, MLA, IEEE
        const stylesDir = join(process.cwd(), 'server', 'csl-styles');

        const stylesToLoad: Record<string, string> = {
            'chicago': 'chicago.csl',
            'mla': 'mla.csl',
            'ieee': 'ieee.csl',
        };

        for (const [name, file] of Object.entries(stylesToLoad)) {
            try {
                const cslXml = readFileSync(join(stylesDir, file), 'utf8');
                config.templates.add(name, cslXml);
            } catch (e) {
                console.warn(`Could not load CSL style '${name}' from ${file}:`, e instanceof Error ? e.message : String(e));
            }
        }

        stylesLoaded = true;
        console.log('CSL styles loaded: apa, vancouver, harvard1, chicago, mla, ieee');
    } catch (e) {
        console.error('Failed to initialize CSL styles:', e instanceof Error ? e.message : String(e));
    }
}

/**
 * Map our internal CitationStyle to the CSL template name used by citation-js.
 * Callers (e.g. routes) should pass normalized style: harvard → harvard-ctr, chicago → chicago-ad.
 */
function getCSLTemplateName(style: CitationStyle): string {
    switch (style) {
        case 'apa': return 'apa';
        case 'mla': return 'mla';
        case 'harvard-ctr': return 'harvard1'; // We override the quotes in post-processor
        case 'chicago-ad': return 'chicago';
        case 'chicago-nb': return 'chicago';
        case 'ieee': return 'ieee';
        case 'vancouver': return 'vancouver';
        default: return 'apa';
    }
}

/**
 * Map our ReferenceType to CSL type.
 */
function getCSLType(type: ReferenceType): string {
    switch (type) {
        case 'journal': return 'article-journal';
        case 'book': return 'book';
        case 'bookChapter': return 'chapter';
        case 'conference': return 'paper-conference';
        case 'website': return 'webpage';
        case 'report': return 'report';
        case 'thesis': return 'thesis';
        case 'preprint': return 'article';
        default: return 'article-journal';
    }
}

type CSLName = { family?: string; given?: string; literal?: string };

/**
 * Parse a single author name string into CSL name parts.
 * Handles: "Surname, I." | "I. Surname" | "First Last" | "Brown T" | org names
 */
function parseOneAuthorToCSL(name: string): CSLName {
    const trimmed = name.trim();
    if (!trimmed) return { literal: 'Unknown' };

    // "et al." marker — pass through as literal so CSL engine renders it
    if (/^et\s+al\.?$/i.test(trimmed)) {
        return { literal: trimmed };
    }

    // Guard: pure initials (e.g. "J.-F.", "B.-C.", "T.J.") should never be a family name
    if (/^[A-Z](?:[.\-\s]*[A-Z])*\.?$/.test(trimmed)) {
        return { given: trimmed };
    }

    // Organization/group author: multiple words, no comma, no initial pattern
    if (!trimmed.includes(',') && !/^[A-Z]\.?\s/.test(trimmed) && /^[A-Z][a-zA-Z]+(\s+[A-Za-z]+){2,}$/.test(trimmed)) {
        return { literal: trimmed };
    }

    const normalizeGivenInitials = (givenRaw: string): string | undefined => {
        const g = givenRaw.trim();
        if (!g) return undefined;
        const compact = g.replace(/\s+/g, '');
        // Patterns like "MAS" or "M.A.S" → "M. A. S."
        if (/^[A-Z]{2,4}$/.test(compact) || /^[A-Z](?:\.[A-Z])+\.?$/.test(compact)) {
            const letters = compact.replace(/\./g, '').split('');
            return letters.map(ch => `${ch}.`).join(' ');
        }
        return g;
    };

    // "Surname, Given" format (most common)
    if (trimmed.includes(',')) {
        const commaIdx = trimmed.indexOf(',');
        const family = trimmed.substring(0, commaIdx).trim();
        const rawGiven = trimmed.substring(commaIdx + 1).trim();
        const given = normalizeGivenInitials(rawGiven);
        return { family, given };
    }

    // "I. Surname" or "I. I. Surname" or "I.-I. Surname" (IEEE) - initials before surname
    const ieeeMatch = trimmed.match(/^((?:[A-Z]\.(?:-[A-Z]\.)?\s*)+)\s*(.+)$/);
    if (ieeeMatch && /^[A-Z]\./.test(trimmed)) {
        return { family: ieeeMatch[2].trim(), given: ieeeMatch[1].trim() };
    }

    // "Surname Initial" (Vancouver) - e.g., "Brown T", "Li Q", "van Houten P", "d'Silva K"
    // Looks for a string ending in 1-3 capital letters (the initials), preceded by a space.
    const vcMatch = trimmed.match(/^(.+?)\s+([A-Z]{1,4}(?:-[A-Z]{1,4})?)$/);
    if (vcMatch) {
        // Normalize compact Vancouver initials ("TJ", "SF") into dotted form ("T. J.", "S. F.")
        const dotted = vcMatch[2]
            .split('-')
            .map(part => part.split('').map(ch => `${ch}.`).join(' '))
            .join('-');
        return { family: vcMatch[1].trim(), given: dotted };
    }

    // "First Last" with full names
    const parts = trimmed.split(/\s+/);
    if (parts.length === 2 && /^[A-Z][a-z]+$/.test(parts[0]) && /^[A-Z][a-z]+$/.test(parts[1])) {
        return { family: parts[1], given: parts[0] };
    }
    if (parts.length === 1) {
        return { family: parts[0] };
    }

    // Fallback: check for multi-part surnames (e.g., "van der Berg", "de la Rosa", "d'Silva")
    let surnameStartIndex = parts.length - 1;
    for (let i = parts.length - 2; i >= 0; i--) {
        // Simple check for common particles or lowercase words preceding the last name
        if (/^(van|der|de|la|von|d'|l'|O')[A-Z]?/.test(parts[i]) || /^[a-z]/.test(parts[i])) {
            surnameStartIndex = i;
        } else {
            break;
        }
    }

    const familyTokens = parts.slice(surnameStartIndex);
    const givenTokens = parts.slice(0, surnameStartIndex);

    // If the final family token is pure-initial-like (e.g. "J."), treat it as given and
    // pull the previous token into the family to avoid "M.atheww"-style corruption.
    if (familyTokens.length >= 2) {
        const last = familyTokens[familyTokens.length - 1];
        if (/^[A-Z]\.?$/.test(last)) {
            givenTokens.push(last);
            familyTokens.pop();
        }
    }

    return {
        family: familyTokens.join(' '),
        given: givenTokens.join(' ') || undefined
    };
}

/**
 * Parse an author string that may contain multiple comma-separated "Surname, I." entries
 * (happens when our parser doesn't properly split multi-author lists).
 * Returns array of CSL name objects.
 */
function parseAuthorsToCSL(authorStr: string): CSLName[] {
    const trimmed = authorStr.trim();

    // Drop clearly broken chunks (just punctuation/ampersands or too short)
    if (!trimmed || trimmed.length < 2 || /^[&,\s]+$/.test(trimmed) || /^&$/.test(trimmed)) {
        return [];
    }

    const normalizeGivenInitials = (givenRaw: string): string | undefined => {
        const g = givenRaw.trim();
        if (!g) return undefined;
        const compact = g.replace(/\s+/g, '');
        if (/^[A-Z]{2,4}$/.test(compact) || /^[A-Z](?:\.[A-Z])+\.?$/.test(compact)) {
            const letters = compact.replace(/\./g, '').split('');
            return letters.map(ch => `${ch}.`).join(' ');
        }
        return g;
    };

    // Detect multiple "Surname, I." patterns joined by commas ONLY if the string is clearly
    // a merged list that our upstream parser failed to split (e.g. it still contains ' and ' or '&').
    // Otherwise, assume it's a single author that has already been extracted into the array by `parseAuthorList`.
    if (trimmed.includes(' and ') || trimmed.includes('&')) {
        const multiMatch = trimmed.match(/([A-Z\u00c0-\u00ff][a-z\u00c0-\u00ff']+(?:\s+[a-z]+\s+[A-Z][a-z]+)?(?:\s+[A-Z][a-z]+)*),\s*([A-Z](?:\.\s*)?(?:[A-Z-](?:\.\s*)?)*(?:-[A-Z]\.)?)/g);

        if (multiMatch && multiMatch.length > 1) {
            return multiMatch.map(m => {
                const ci = m.indexOf(',');
                const family = m.substring(0, ci).trim();
                const rawGiven = m.substring(ci + 1).trim().replace(/,\s*$/, '');
                const given = normalizeGivenInitials(rawGiven);
                return { family, given };
            });
        }
    }

    // Single author (or an author pre-split perfectly by the parser)
    return [parseOneAuthorToCSL(trimmed)];
}

/**
 * Convert our ParsedReference to CSL-JSON format.
 * This is the bridge between our custom parser and the CSL engine.
 */
export function parsedReferenceToCSL(
    parsed: ParsedReference,
    type: ReferenceType,
    id: string = 'ref1'
): Record<string, any> {
    const csl: Record<string, any> = {
        id,
        type: getCSLType(type),
    };

    // Title — skip if it's actually a DOI URL (DOI-only citations)
    if (parsed.title) {
        const titleDOIMatch = parsed.title.match(/^https?:\/\/doi\.org\/(.+)$/i);
        if (titleDOIMatch) {
            // Title is actually a DOI URL — don't use it as title, store as DOI
            if (!parsed.doi) {
                csl.DOI = titleDOIMatch[1];
            }
        } else {
            csl.title = parsed.title;
        }
    }

    // Authors - use flatMap to handle multi-author strings that weren't split
    if (parsed.authors && parsed.authors.length > 0) {
        csl.author = parsed.authors.flatMap(a => parseAuthorsToCSL(a));
    }

    // Year/Date
    if (parsed.year) {
        const year = parseInt(parsed.year, 10);
        if (!isNaN(year)) {
            csl.issued = { 'date-parts': [[year]] };
        }
    }

    // Journal / Container title
    if (parsed.journal) {
        csl['container-title'] = parsed.journal;
    } else if (parsed.bookTitle) {
        csl['container-title'] = parsed.bookTitle;
    } else if (parsed.conferenceTitle) {
        csl['container-title'] = parsed.conferenceTitle;
    }

    // Volume
    if (parsed.volume) {
        csl.volume = parsed.volume;
    }

    // Issue
    if (parsed.issue) {
        csl.issue = parsed.issue;
    }

    // Pages and article-number (e-locator)
    if ((parsed as any)['article-number']) {
        const artNum = (parsed as any)['article-number'];
        csl.number = artNum;
        // For journal articles, render eLocators as "Article XXXXX" in the page field
        // so APA/Harvard CSL templates display them correctly (APA 7th ed. format)
        if (csl.type === 'article-journal' && !parsed.pages) {
            csl.page = `Article ${artNum.replace(/^[eE]/, '')}`;
        }
    }
    if (parsed.pages) {
        if (/^Article\s+/i.test(parsed.pages)) {
            csl.number = parsed.pages.replace(/^Article\s+/i, '');
        } else {
            csl.page = parsed.pages;
        }
    }

    // DOI
    if (parsed.doi) {
        csl.DOI = parsed.doi;
    }

    // URL (only if no DOI, to avoid duplication)
    if (parsed.url && !parsed.doi) {
        csl.URL = parsed.url;
    }

    // Publisher (thesis/report: use institution when publisher missing)
    const publisher = parsed.publisher ?? ((type === 'thesis' || type === 'report') && parsed.institution ? parsed.institution : undefined);
    if (publisher) {
        csl.publisher = publisher;
    }

    // Place of publication
    if (parsed.placeOfPublication) {
        csl['publisher-place'] = parsed.placeOfPublication;
    }

    // Edition
    if (parsed.edition) {
        csl.edition = parsed.edition;
    }

    // Editor
    if (parsed.editor) {
        // Simple parsing of editor names
        csl.editor = [parseOneAuthorToCSL(parsed.editor)];
    }

    // Accessed date
    if (parsed.accessed) {
        // Try to parse access date
        const dateMatch = parsed.accessed.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
        if (dateMatch) {
            const months: Record<string, number> = {
                'january': 1, 'february': 2, 'march': 3, 'april': 4,
                'may': 5, 'june': 6, 'july': 7, 'august': 8,
                'september': 9, 'october': 10, 'november': 11, 'december': 12
            };
            const month = months[dateMatch[2].toLowerCase()];
            if (month) {
                csl.accessed = { 'date-parts': [[parseInt(dateMatch[3]), month, parseInt(dateMatch[1])]] };
            }
        }
    }

    return csl;
}

/**
 * Format a parsed reference using the CSL engine.
 * This is the simple path — no enrichment, just parse→CSL→format.
 */
export function formatWithCSL(
    parsed: ParsedReference,
    targetStyle: CitationStyle,
    referenceType: ReferenceType,
    options?: { includeDoi?: boolean }
): string {
    const cslData = parsedReferenceToCSL(parsed, referenceType);
    return formatCSLData(cslData, targetStyle, options);
}

/**
 * Format pre-built CSL-JSON data using the CSL engine.
 * This is the enriched path — CSL-JSON has already been merged with Crossref data.
 */
export function formatCSLData(
    cslData: Record<string, any>,
    targetStyle: CitationStyle,
    options?: { includeDoi?: boolean }
): string {
    // Ensure styles are loaded
    initCSLStyles();

    // Clone to avoid mutating the input
    const data = { ...cslData };

    // Ensure an ID exists
    if (!data.id) data.id = 'ref1';

    // If DOI should be excluded, remove it
    if (options?.includeDoi === false) {
        delete data.DOI;
    }

    try {
        const cite = new Cite([data]);
        const templateName = getCSLTemplateName(targetStyle);

        let result = cite.format('bibliography', {
            format: 'text',
            template: templateName,
            lang: 'en-US'
        });

        // Clean up: remove leading numbering from some styles (IEEE needs [N] so keep it)
        result = result.trim().replace(/^1\.\s+/, '');
        if (targetStyle !== 'ieee') {
            result = result.replace(/^\[1\]\s*/, '');
        }

        // Decode HTML entities that citation-js sometimes produces
        result = result.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

        return result;
    } catch (error) {
        console.error('CSL formatting error:', error instanceof Error ? error.message : String(error));
        return fallbackFormat(cslData);
    }
}

/**
 * Simple fallback formatter if CSL engine fails.
 */
function fallbackFormat(csl: Record<string, any>): string {
    const parts: string[] = [];

    if (csl.author?.length) {
        parts.push(csl.author.map((a: any) => a.literal || `${a.family || ''}, ${a.given || ''}`).join(', '));
    }
    if (csl.issued?.['date-parts']?.[0]?.[0]) {
        parts.push(`(${csl.issued['date-parts'][0][0]})`);
    }
    if (csl.title) {
        parts.push(csl.title);
    }
    if (csl['container-title']) {
        parts.push(csl['container-title']);
    }
    if (csl.volume) {
        let vol = csl.volume;
        if (csl.issue) vol += `(${csl.issue})`;
        parts.push(vol);
    }
    if (csl.page) {
        parts.push(csl.page);
    }

    return parts.join('. ') + '.';
}
