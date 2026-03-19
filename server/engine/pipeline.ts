/**
 * Pipeline — Pure-function engine orchestrator
 * 
 * Extracts the citation processing pipeline from routes.ts into a HTTP-free,
 * testable pure function. This is the heart of the isolated engine.
 */

import { CitationParser } from './citationParser.js';
import { formatCSLData, parsedReferenceToCSL, initCSLStyles } from './cslConverter.js';
import { fixFormatting, runAssertions, type AssertionResult } from './strictRenderer.js';
import { normaliseEncoding } from './stages/normaliseEncoding.js';
import { runSanityCheck } from './stages/sanityCheck.js';
import { getAuthorityData } from '../../shared/authorityLookup.js';
import { calculateConfidence } from '../../shared/confidence.js';
import { hasAuthorInitialsOnly } from '../utils/authorResolution.js';
import { clusterCitations } from '../../shared/clustering.js';
import { computeWorkKey } from '../utils/workKey.js';
import { toRawReferenceText } from '@shared/types/textBrands';
import { autoQueueFailures } from '../store/autoQueue.js';
import pLimit from 'p-limit';

import type {
    ConvertedReference,
    Cluster,
    InsertReference,
    AuthorityStatus,
    ParsedReference,
} from '@shared/schema';
import { normalizeCitationStyle } from '@shared/schema';

// ── Types ──

export interface PipelineOptions {
    inputStyle: string;
    outputStyle: string;
    enrichWithAuthority?: boolean;
    isPro?: boolean;
}

export interface PipelineResult {
    references: ConvertedReference[];
    clusters?: Cluster[];
    errors: string[];
    storageData: Array<InsertReference & { _uiData: ConvertedReference }>;
}

// Safety: max reference length to avoid ReDoS on dynamic patterns
const MAX_REF_LENGTH = 4000;

// Singleton parser instance
let parserInstance: CitationParser | null = null;
let cslInitialized = false;

function getParser(): CitationParser {
    if (!parserInstance) {
        parserInstance = new CitationParser();
    }
    return parserInstance;
}

function ensureCSL(): void {
    if (!cslInitialized) {
        initCSLStyles();
        cslInitialized = true;
    }
}

// ── Core pipeline ──

/**
 * Process an array of raw citation strings through the full pipeline.
 * 
 * Pure function: no HTTP, no Express, no React.
 * Input: raw strings + options → Output: converted references + clusters + errors
 */
export async function processReferences(
    rawInputs: string[],
    options: PipelineOptions
): Promise<PipelineResult> {
    ensureCSL();
    const parser = getParser();
    const outputStyleInternal = normalizeCitationStyle(options.outputStyle);
    const errors: string[] = [];

    const limit = pLimit(5);
    const enrichWithAuthority = options.enrichWithAuthority ?? false;

    const processTasks = rawInputs.map((inputRef, i) => limit(async () => {
        const rawRef = toRawReferenceText(inputRef.trim());
        if (!rawRef) return null;
        if (rawRef.length > MAX_REF_LENGTH) {
            errors.push(`Reference ${i + 1} exceeds ${MAX_REF_LENGTH} character limit — skipped for safety.`);
            return null;
        }

        try {
            // Stage 0a: Encoding normalisation (BOM, ligatures, curly quotes, en-dashes, NBSP, OCR repair)
            const encodingNormalised = normaliseEncoding(rawRef);

            // Stage 0b: Pre-normalize (numbering, HTML, whitespace)
            const normalized = parser.preNormalize(encodingNormalised);
            if (!normalized) return null;

            // Stage 4: Style detection
            let detectedStyle = options.inputStyle;
            let styleDetectionFailed = false;
            if (options.inputStyle === 'auto') {
                const detected = parser.detectStyle(normalized);
                if (detected) {
                    detectedStyle = detected;
                } else {
                    detectedStyle = 'apa';
                    styleDetectionFailed = true;
                    errors.push(`Could not detect citation style for reference ${i + 1} — converted as best-guess stub`);
                }
            }

            // Stage 5: Parse (Attempt 1 — style-based)
            const { parsed: parsedData, patternHits } = parser.parseReference(normalized, detectedStyle as any);

            // Stage 5 Attempt 2 — year-anchored fallback when style detection failed
            if (styleDetectionFailed) {
                const fallback = parser.parseYearAnchored(normalized);
                if (fallback) {
                    // Merge: prefer fields from whichever attempt has data
                    if (!parsedData.title && fallback.title) parsedData.title = fallback.title;
                    if ((!parsedData.authors || parsedData.authors.length === 0) && fallback.authors?.length) {
                        parsedData.authors = fallback.authors;
                    }
                    if (!parsedData.year && fallback.year) parsedData.year = fallback.year;
                    if (!parsedData.journal && fallback.journal) parsedData.journal = fallback.journal;
                    if (!parsedData.volume && fallback.volume) parsedData.volume = fallback.volume;
                    if (!parsedData.issue && fallback.issue) parsedData.issue = fallback.issue;
                    if (!parsedData.pages && fallback.pages) parsedData.pages = fallback.pages;
                    // Mark that fallback was used
                    parsedData.parseWarnings = [...(parsedData.parseWarnings ?? []), 'year-anchored-fallback'];
                }
            }

            (parsedData as any)._inputHadLocator = /\bpp?\.?\s*[A-Z]?\d|\bArt(?:icle)?\.?\s*(?:no\.?\s*)?[A-Z]?\d|\b\d+\(\d+\)\s*:\s*[A-Z]?\d|\bS\d+(?:[-–]S?\d+)?\b/i.test(normalized);
            (parsedData as any).rawInput = rawRef;


            const referenceType = parser.determineReferenceType(parsedData);
            const workKey = computeWorkKey(parsedData);

            // Stage 10: CSL conversion + render
            const cslData = parsedReferenceToCSL(parsedData, referenceType, `ref${i}`);
            const rawConvertedText = formatCSLData(cslData, outputStyleInternal as any, { includeDoi: false });
            const convertedText = fixFormatting(outputStyleInternal, rawConvertedText, parsedData);

            // Post-render assertions (Stage 10 validation)
            const assertionResult = runAssertions(outputStyleInternal, convertedText, parsedData);

            // Stage 11: Sanity check
            const sanityResult = runSanityCheck(convertedText, outputStyleInternal);

            let warnings = assertionResult.warnings;
            const parseWarnings = (parsedData.parseWarnings ?? []).map((w: string) => `parse: ${w}`);
            if (parseWarnings.length > 0) warnings = [...parseWarnings, ...warnings];
            if (sanityResult.warnings.length > 0) warnings = [...warnings, ...sanityResult.warnings];

            if (styleDetectionFailed) {
                warnings = [`warning: Style could not be detected; output is a best-guess stub.`, ...warnings];
            }


            // Stage 8: Confidence scoring
            let baseRulesScore = 100;
            for (const w of warnings) {
                if (w.startsWith('error:')) baseRulesScore -= 30;
                else if (w.startsWith('warning:')) baseRulesScore -= 15;
            }
            baseRulesScore = Math.max(0, baseRulesScore);

            // Stage 7: Authority data enrichment
            let authorityData: any;
            let authorityStatus: AuthorityStatus = 'none';

            if (!options.isPro) {
                authorityStatus = 'blocked';
            } else if (!enrichWithAuthority) {
                authorityStatus = 'skipped';
            } else {
                const result = await getAuthorityData(parsedData);
                authorityStatus = result.status;
                if (result.data) authorityData = result.data;
            }

            const confidence = calculateConfidence(parsedData, baseRulesScore, authorityData);

            // Build storage + UI data
            const refData = {
                originalText: rawRef,
                inputStyle: detectedStyle,
                outputStyle: options.outputStyle,
                parsedData,
                convertedText,
                referenceType,
                confidenceScore: confidence.score,
                workKey,
                patternHits,
                authorityStatus,
            };

            const uiData: ConvertedReference = {
                id: '', // will be assigned after storage
                originalText: rawRef,
                convertedText,
                referenceType,
                parsedData,
                inputStyle: detectedStyle as any,
                outputStyle: options.outputStyle,
                warnings,
                confidence,
                authorityData,
                patternHits,
                authorityStatus,
                workKey,
                styleDetectionFailed,
                assertionSummary: assertionResult.assertionSummary,
                assertionHighlights: assertionResult.assertionHighlights,
                authorInitialsOnly: hasAuthorInitialsOnly(parsedData),
            };

            return { refData, uiData };
        } catch (error) {
            console.error(`Error processing reference ${i + 1}: `, error instanceof Error ? error.message : String(error));
            errors.push(`Error processing reference ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return null;
        }
    }));

    const results = await Promise.all(processTasks);
    const validResults = results.filter((r): r is NonNullable<typeof r> => r !== null);

    // Build storage data (with _uiData attached for easy mapping after storage)
    const storageData = validResults.map(r => ({
        ...r.refData,
        _uiData: r.uiData,
    }));

    // Build references without IDs (caller assigns IDs after storage)
    const references = validResults.map(r => r.uiData);

    // Clustering
    const clusters = clusterCitations(references, 80);

    const result: PipelineResult = {
        references,
        clusters: clusters.length > 0 ? clusters : undefined,
        errors,
        storageData,
    };

    // Fire-and-forget: auto-queue low-confidence / failed citations
    queueMicrotask(() => {
        try {
            autoQueueFailures({ references, clusters: result.clusters });
        } catch (e) {
            console.warn('[pipeline] autoQueueFailures error (non-fatal):', e);
        }
    });

    return result;
}

/**
 * Reformat already-parsed references with a new output style.
 * Used by the style-change UI hook without re-parsing.
 */
export function reformatReferences(
    references: Array<{ id: string; parsedData: ParsedReference; referenceType: string; originalText: string; inputStyle: string }>,
    outputStyle: string
): ConvertedReference[] {
    ensureCSL();
    const outputStyleInternal = normalizeCitationStyle(outputStyle);
    const reformatted: ConvertedReference[] = [];

    for (const ref of references) {
        try {
            const cslData = parsedReferenceToCSL(ref.parsedData, ref.referenceType as any, ref.id);
            const rawText = formatCSLData(cslData, outputStyleInternal as any, { includeDoi: false });
            const convertedText = fixFormatting(outputStyleInternal, rawText, ref.parsedData);
            const assertionResult: AssertionResult = runAssertions(outputStyleInternal, convertedText, ref.parsedData);

            let baseRulesScore = 100;
            for (const w of assertionResult.warnings) {
                if (w.startsWith('error:')) baseRulesScore -= 30;
                else if (w.startsWith('warning:')) baseRulesScore -= 15;
            }
            baseRulesScore = Math.max(0, baseRulesScore);

            const confidence = calculateConfidence(ref.parsedData, baseRulesScore);

            reformatted.push({
                id: ref.id,
                originalText: ref.originalText,
                convertedText,
                referenceType: ref.referenceType as any,
                parsedData: ref.parsedData,
                inputStyle: ref.inputStyle,
                outputStyle,
                warnings: assertionResult.warnings,
                confidence,
                assertionSummary: assertionResult.assertionSummary,
                assertionHighlights: assertionResult.assertionHighlights,
                authorInitialsOnly: hasAuthorInitialsOnly(ref.parsedData),
            });
        } catch (error) {
            console.error(`Reformat error for ref ${ref.id}:`, error);
        }
    }

    return reformatted;
}
