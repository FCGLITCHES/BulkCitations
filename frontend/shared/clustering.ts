import type { ParsedReference, Cluster, ConvertedReference } from './schema';
import { JOURNAL_ABBREVIATIONS } from './journalAbbreviations';
import * as fuzzball from 'fuzzball';

/**
 * Normalizes a string: lowercase, punctuation removed.
 */
function normalize(str?: string): string {
    if (!str) return '';
    return str.toLowerCase().replace(/[^\w\s]/gi, '').replace(/\s+/g, ' ').trim();
}

/**
 * Expands a known journal abbreviation to its full title.
 * E.g., "J Digit Libr" -> "Journal of Digital Libraries"
 */
function expandJournal(journal?: string): string {
    if (!journal) return '';
    let expanded = journal.trim();

    // Try exact match first
    if (JOURNAL_ABBREVIATIONS[expanded]) {
        return JOURNAL_ABBREVIATIONS[expanded];
    }

    // If not exact, maybe we just have the abbreviation inside it, or with periods
    // So we strip periods and check the map.
    const normalizedNoPeriods = expanded.replace(/\./g, '');
    if (JOURNAL_ABBREVIATIONS[normalizedNoPeriods]) {
        return JOURNAL_ABBREVIATIONS[normalizedNoPeriods];
    }

    // Iterate over words and see if it's a known string mapped
    // This is a rough fallback if they provided something slightly off
    for (const [abbr, full] of Object.entries(JOURNAL_ABBREVIATIONS)) {
        if (expanded.toLowerCase() === abbr.toLowerCase()) {
            return full;
        }
    }

    return expanded; // Fallback to original
}

/**
 * Normalizes author lists to be order-agnostic for clustering.
 * "Smith J, Doe A" vs "Doe A, Smith J" should match highly.
 */
function authorString(authors?: string[]): string {
    if (!authors || authors.length === 0) return '';
    // Extract just the normalized last names, sort alphabetically, and join
    const lastNames = authors.map(a => {
        // Basic heuristic: take family name before comma, or parse Vancouver-style
        // trailing initials (e.g., "Smith JA", "de Silva J. P.") as non-family tokens.
        const cleaned = a.replace(/[^\w\s,-]/gi, ' ').trim();
        if (!cleaned) return '';
        if (cleaned.includes(',')) return cleaned.split(',')[0].trim().toLowerCase();

        const parts = cleaned.split(/\s+/).filter(Boolean);
        if (parts.length === 0) return '';
        if (parts.length === 1) return parts[0].toLowerCase();

        let familyEnd = parts.length;
        while (familyEnd > 0 && /^[A-Z]{1,3}$/.test(parts[familyEnd - 1])) {
            familyEnd -= 1;
        }

        if (familyEnd > 0 && familyEnd < parts.length) {
            return parts.slice(0, familyEnd).join(' ').trim().toLowerCase();
        }

        return parts[parts.length - 1].toLowerCase();
    }).filter(Boolean).sort();

    return lastNames.join(' ');
}

function extractGivenPart(author: string): string {
    const trimmed = author.trim();
    if (!trimmed) return '';

    if (trimmed.includes(',')) {
        const parts = trimmed.split(',');
        return parts.slice(1).join(',').trim();
    }

    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return '';

    // IEEE-style: "J. A. Smith" => given before family
    if (/^[A-Z](?:\.[A-Z]?|\.|-|[A-Z])/.test(parts[0])) {
        return parts.slice(0, -1).join(' ');
    }

    // Vancouver-style: "Smith JA" => compact initials after family
    return parts.slice(1).join(' ');
}

function countGivenInitials(givenPart: string): number {
    if (!givenPart) return 0;

    let total = 0;
    const compactTokens = givenPart.match(/\b[A-Z]{2,}\b/g) || [];
    for (const t of compactTokens) total += t.length;

    const dotted = givenPart.match(/\b[A-Z]\./g) || [];
    total += dotted.length;

    const hyphenated = givenPart.match(/\b[A-Z]\.-[A-Z]\./g) || [];
    total += hyphenated.length; // already partly counted above, but keep a slight boost

    // For full given names (rare in these inputs), count as at least one detail token.
    const fullGivenWords = givenPart.match(/\b[A-Z][a-z]{2,}\b/g) || [];
    total += fullGivenWords.length;

    return total;
}

function authorDetailScore(authors?: string[]): number {
    if (!authors || authors.length === 0) return 0;
    let total = 0;
    for (const author of authors) {
        const given = extractGivenPart(author);
        total += countGivenInitials(given);
    }
    return total;
}

function isLikelyJournalAbbreviation(journal?: string): boolean {
    if (!journal) return false;
    const trimmed = journal.trim();
    if (!trimmed) return false;

    const noPeriods = trimmed.replace(/\./g, '');
    const mapped = JOURNAL_ABBREVIATIONS[trimmed] || JOURNAL_ABBREVIATIONS[noPeriods];
    if (mapped) {
        // If mapping expands to the same normalized string, this is already full form.
        const normInput = normalize(trimmed);
        const normMapped = normalize(mapped);
        return normInput !== normMapped;
    }

    // Heuristic fallback: very short tokens + no "Journal" keyword often indicates abbreviation.
    const words = noPeriods.split(/\s+/).filter(Boolean);
    if (words.length > 0 && words.every(w => w.length <= 5) && !/journal|review|letters|transactions|proceedings/i.test(trimmed)) {
        return true;
    }
    return false;
}

function hasEtAl(authors?: string[]): boolean {
    if (!authors || authors.length === 0) return false;
    return authors.some(a => /^et\s+al\.?$/i.test(a.trim()) || /\bet\s+al\.?$/i.test(a.trim()));
}

function getArticleNumber(parsed: ParsedReference): string | undefined {
    return parsed['article-number'];
}

function hasLocator(parsed: ParsedReference): boolean {
    return !!(parsed.pages || getArticleNumber(parsed));
}

function hasAuthorityValidation(ref: ConvertedReference): boolean {
    const status = (ref.authorityStatus || '').toLowerCase();
    const statusValidated = status === 'fetched' || status === 'cache_hit';
    return !!(ref.authorityData && statusValidated && !ref.confidence?.isSuspicious);
}

function venueString(parsed: ParsedReference): string {
    return parsed.conferenceTitle || parsed.journal || parsed.bookTitle || '';
}

function isNearEquivalentDuplicate(a: ConvertedReference, b: ConvertedReference): boolean {
    const parsedA = a.parsedData || {};
    const parsedB = b.parsedData || {};

    const titleA = normalize(parsedA.title || '');
    const titleB = normalize(parsedB.title || '');
    const authorA = authorString(parsedA.authors);
    const authorB = authorString(parsedB.authors);
    const venueA = normalize(expandJournal(venueString(parsedA)));
    const venueB = normalize(expandJournal(venueString(parsedB)));

    if (!titleA || !titleB) return false;
    if (parsedA.year && parsedB.year && parsedA.year !== parsedB.year) return false;
    if ((a.referenceType || '') !== (b.referenceType || '')) return false;

    const titleScore = fuzzball.token_set_ratio(titleA, titleB);
    const authorScore = authorA && authorB ? fuzzball.token_set_ratio(authorA, authorB) : 100;
    const venueScore = venueA && venueB ? fuzzball.token_set_ratio(venueA, venueB) : 100;
    const fieldDelta = Math.abs(countFilledFields(parsedA) - countFilledFields(parsedB));

    return titleScore >= 97 && authorScore >= 95 && venueScore >= 92 && fieldDelta <= 1;
}

function titleCompletenessAdjustment(ref: ConvertedReference, members: ConvertedReference[]): number {
    const t = (ref.parsedData?.title || '').trim();
    if (!t) return -12;

    const lengths = members
        .map(m => (m.parsedData?.title || '').trim().length)
        .filter(n => n > 0);
    if (lengths.length === 0) return 0;
    const maxLen = Math.max(...lengths);
    if (maxLen < 20) return 0;

    if (t.length < maxLen * 0.6) {
        // Extra penalty when it also looks abruptly cut (no terminal punctuation).
        return /[.!?]$/.test(t) ? -6 : -12;
    }
    return 0;
}

function countFilledFields(parsed: ParsedReference): number {
    return Object.entries(parsed || {})
        .filter(([k, v]) => !k.startsWith('_') && v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0) && `${v}`.trim() !== '')
        .length;
}

function memberQualityScore(ref: ConvertedReference): number {
    const parsed = ref.parsedData || {};
    let score = ref.confidence?.score ?? 0;

    // Completeness: reward core bibliographic structure.
    const coreSignals = [
        !!parsed.title,
        !!parsed.year,
        !!(parsed.authors && parsed.authors.length > 0),
        !!(parsed.journal || parsed.bookTitle || parsed.conferenceTitle),
        !!(parsed.pages || getArticleNumber(parsed) || parsed.volume),
    ];
    const coreRatio = coreSignals.filter(Boolean).length / coreSignals.length;
    score += Math.round(coreRatio * 25);

    // Missing year is a major deficiency compared to missing secondary fields.
    if (parsed.year) score += 8;
    else score -= 40;

    // Richer parsed payload tends to indicate better extraction.
    score += Math.min(15, countFilledFields(parsed) * 2);

    // Prefer richer author detail (middle initials/full initials) over abbreviated variants.
    const details = authorDetailScore(parsed.authors);
    score += Math.min(30, details * 4);

    // Penalize known noisy leak where conference containers are misfiled as journal text.
    if (parsed.journal && /^in\s+(?:proc(?:eedings)?|proceedings|(?:\d{4}\s+)?(?:ieee\s+)?conference|symposium|workshop)\b/i.test(parsed.journal)) {
        score -= 12;
    }

    if (parsed.conferenceTitle) score += 6;

    // Prefer full journal titles when both records otherwise overlap.
    if (parsed.journal) {
        if (isLikelyJournalAbbreviation(parsed.journal)) score -= 6;
        else score += 6;
        if (/\bjournal\b/i.test(parsed.journal)) score += 8;
        const words = parsed.journal.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
        const shortWords = words.filter(w => w.length <= 4).length;
        if (words.length >= 2 && shortWords / words.length >= 0.6 && !/\bjournal\b/i.test(parsed.journal)) {
            score -= 6; // abbreviation-like container form (e.g., "J Med Inform")
        }
    }

    // Journal completeness nuance: volume + locator is stronger than volume alone.
    if ((ref.referenceType === 'journal' || !!parsed.journal) && parsed.volume) {
        if (hasLocator(parsed)) score += 8;
        else score -= 6;
    }

    // Author integrity penalties for obviously malformed tokens.
    const authors = parsed.authors ?? [];
    if (authors.length === 0) {
        score -= 10;
    } else {
        score += Math.min(6, authors.length);
        const avgGivenDetail = details / Math.max(authors.length, 1);
        if (avgGivenDetail >= 1.8) score += 8;
        else if (avgGivenDetail <= 1.05) score -= 8;
        for (const a of authors) {
            if (/^\s*[A-Z](?:[.\-\s]*[A-Z])*\.?\s*$/.test(a)) score -= 6; // pure initials token
            if (/(^|[\s,])-+[A-Z]\./.test(a)) score -= 4; // "-F." style corruption
            if (/^\s*\d+[\].)\-:\s]/.test(a) || /,\s*\d+\.\s*/.test(a)) score -= 4; // numbering leak
        }
    }
    if (hasEtAl(authors)) score -= 25;

    // Runtime quality signals from pipeline.
    if (ref.styleDetectionFailed) score -= 20;
    for (const w of ref.warnings ?? []) {
        if (w.startsWith('error:')) score -= 8;
        else if (w.startsWith('warning:')) score -= 3;
    }

    if (ref.authorityData) score += 5;

    return score;
}

/**
 * Calculates similarity between two parsed citations.
 * Returns 0-100 score. Threshold for clustering is usually >85.
 * Weights: Title(50%), Authors(30%), Journal(20%).
 */
export function calculateCitationSimilarity(a: ParsedReference, b: ParsedReference): number {
    if (!a.title || !b.title) return 0; // Hard requirement for clustering

    // 1. Title Score (50%)
    const titleA = normalize(a.title);
    const titleB = normalize(b.title);
    // use token_set_ratio to handle partial drops like subtitle absence
    const titleScore = fuzzball.token_set_ratio(titleA, titleB);

    // 2. Author Score (30%)
    const authA = authorString(a.authors);
    const authB = authorString(b.authors);
    let authScore = 0;
    if (authA && authB) {
        authScore = fuzzball.token_set_ratio(authA, authB);
    } else if (!authA && !authB) {
        // Both missing, neutral to positive contribution so we don't rank them to 0 on missing authors
        authScore = 100;
    }

    // 3. Journal Score (20%)
    const jourA = normalize(expandJournal(a.journal));
    const jourB = normalize(expandJournal(b.journal));
    let jourScore = 0;
    if (jourA && jourB) {
        jourScore = fuzzball.token_set_ratio(jourA, jourB);
    } else if (!jourA && !jourB) {
        jourScore = 100;
    }

    // Base weighted score
    let finalScore = (titleScore * 0.5) + (authScore * 0.3) + (jourScore * 0.2);

    // Soft Penalty: Year Delta
    // Same title, different year usually means preprint vs published version. 
    // We apply a soft penalty so they cluster if everything else is identical, but 
    // keeps disjoint papers apart.
    if (a.year && b.year && a.year !== b.year) {
        const yearA = parseInt(a.year, 10);
        const yearB = parseInt(b.year, 10);
        if (!isNaN(yearA) && !isNaN(yearB)) {
            const delta = Math.abs(yearA - yearB);
            if (delta > 0) {
                // e.g., 2 year delta = -10 points. 10 year delta = -50 points.
                finalScore -= Math.min((delta * 5), 50);
            }
        }
    }

    return Math.max(0, Math.round(finalScore));
}

/**
 * Clusters a batch of converted references based on similarity threshold.
 * Returns cluster-local member copies with clusterId set; does not mutate input.
 */
export function clusterCitations(references: ConvertedReference[], threshold: number = 85): Cluster[] {
    const localReferences = references.map(ref => ({ ...ref }));
    const clusters: Cluster[] = [];
    const workKeyMap = new Map<string, Cluster>(); // Pre-index for O(1) exact match
    let nextClusterId = 1;

    // Pre-calculate normalized data for all references to avoid doing it in the N^2 loop
    const refMetaData = localReferences.map(ref => ({
        id: ref.id,
        normTitle: normalize(ref.parsedData?.title || ''),
        authStr: authorString(ref.parsedData?.authors),
        jourStr: normalize(expandJournal(ref.parsedData?.journal || ref.parsedData?.bookTitle || ref.parsedData?.conferenceTitle || ''))
    }));
    const metaById = new Map(refMetaData.map(m => [m.id, m]));

    for (const ref of localReferences) {
        let placed = false;
        const meta = metaById.get(ref.id);
        if (!meta) continue;

        // 1. FAST PATH: Exact workKey match (O(1))
        if (ref.workKey && workKeyMap.has(ref.workKey)) {
            const cluster = workKeyMap.get(ref.workKey)!;
            if (cluster.members.length < 5) {
                cluster.members.push(ref);
                ref.clusterId = cluster.clusterId;
                placed = true;
            }
        }

        // 2. FUZZY PATH: Compare against existing clusters (O(C))
        if (!placed) {
            for (const cluster of clusters) {
                if (cluster.members.length >= 5) continue;

                let bestSimilarity = 0;
                let bestTitleSimilarity = 0;
                let workKeyMatched = false;

                for (const member of cluster.members) {
                    if (ref.workKey && member.workKey && ref.workKey === member.workKey) {
                        bestSimilarity = 100;
                        bestTitleSimilarity = 100;
                        workKeyMatched = true;
                        break;
                    }

                    // Calculate similarity using pre-normalized metadata
                    const memberMeta = metaById.get(member.id);
                    if (!memberMeta) {
                        continue;
                    }

                    // Inline logic of calculateCitationSimilarity but using pre-cached values
                    if (!meta.normTitle || !memberMeta.normTitle) continue;

                    const titleSimilarity = fuzzball.token_set_ratio(meta.normTitle, memberMeta.normTitle);
                    if (titleSimilarity > bestTitleSimilarity) bestTitleSimilarity = titleSimilarity;

                    const authSim = (meta.authStr && memberMeta.authStr) ? fuzzball.token_set_ratio(meta.authStr, memberMeta.authStr) : 100;
                    const jourSim = (meta.jourStr && memberMeta.jourStr) ? fuzzball.token_set_ratio(meta.jourStr, memberMeta.jourStr) : 100;

                    let similarity = (titleSimilarity * 0.5) + (authSim * 0.3) + (jourSim * 0.2);

                    // Year delta penalty
                    if (ref.parsedData?.year && member.parsedData?.year && ref.parsedData.year !== member.parsedData.year) {
                        const yA = parseInt(ref.parsedData.year, 10);
                        const yB = parseInt(member.parsedData.year, 10);
                        if (!isNaN(yA) && !isNaN(yB)) {
                            similarity -= Math.min(Math.abs(yA - yB) * 5, 50);
                        }
                    }

                    if (similarity > bestSimilarity) bestSimilarity = similarity;
                }

                if (bestSimilarity >= threshold && (workKeyMatched || bestTitleSimilarity >= 85)) {
                    cluster.members.push(ref);
                    ref.clusterId = cluster.clusterId;
                    placed = true;
                    // If we matched a cluster fuzzy but it has a workKey, index this ref's workKey too
                    if (ref.workKey) workKeyMap.set(ref.workKey, cluster);
                    break;
                }
            }
        }

        // 3. NEW CLUSTER PATH
        if (!placed) {
            const newClusterId = `C${nextClusterId++}`;
            ref.clusterId = newClusterId;
            const newCluster = {
                clusterId: newClusterId,
                members: [ref]
            };
            clusters.push(newCluster);
            if (ref.workKey) workKeyMap.set(ref.workKey, newCluster);
        }
    }

    // Post-process clusters to find the "best" member (quality-first with explicit guards).
    for (const cluster of clusters) {
        if (cluster.members.length > 1) {
            const clusterWarnings: string[] = [];
            const styleSet = new Set(cluster.members.map(m => (m.inputStyle || '').toLowerCase()).filter(Boolean));
            if (styleSet.size > 1) {
                clusterWarnings.push(`Style diversity in cluster: ${Array.from(styleSet).join(', ')}`);
            }

            // Diagnostics table used by dev-mode "why this winner" UI.
            const memberDiagnostics = cluster.members.map((m) => {
                const reasons: string[] = [];
                let score = memberQualityScore(m);
                const titleAdj = titleCompletenessAdjustment(m, cluster.members);
                score += titleAdj;

                if (hasAuthorityValidation(m)) reasons.push('authority-validated');
                if (m.styleDetectionFailed) reasons.push('style-detection-failed');
                if (!m.parsedData?.year) reasons.push('missing-year');
                if (hasEtAl(m.parsedData?.authors)) reasons.push('contains-et-al');
                if (m.referenceType === 'conference' || !!m.parsedData?.conferenceTitle) reasons.push('conference-typed');
                if (m.referenceType === 'journal' && m.parsedData?.volume && !hasLocator(m.parsedData)) reasons.push('volume-without-locator');
                if (titleAdj < 0) reasons.push('possibly-truncated-title');
                if (m.parsedData?.journal && isLikelyJournalAbbreviation(m.parsedData.journal)) reasons.push('abbrev-journal-container');

                return {
                    id: m.id,
                    score: Math.round(score),
                    reasons,
                    referenceType: m.referenceType,
                    styleDetectionFailed: !!m.styleDetectionFailed,
                    hasEtAl: hasEtAl(m.parsedData?.authors),
                    hasAuthorityValidation: hasAuthorityValidation(m),
                    hasYear: !!m.parsedData?.year,
                };
            });
            const diagById = new Map(memberDiagnostics.map(d => [d.id, d]));

            let candidates = [...cluster.members];
            const chosenReasons: string[] = [];

            // 1) Authority-validated records override all non-validated records.
            const authoritative = candidates.filter(hasAuthorityValidation);
            if (authoritative.length > 0) {
                candidates = authoritative;
                chosenReasons.push('authority-validated override');
            }

            // 2) Never allow style-detection-failed records to win if valid alternatives exist.
            const nonFailed = candidates.filter(c => !c.styleDetectionFailed);
            if (nonFailed.length > 0 && nonFailed.length !== candidates.length) {
                candidates = nonFailed;
                chosenReasons.push('excluded styleDetectionFailed records');
            }

            // 3) Missing year is a veto when year-bearing candidates exist.
            const withYear = candidates.filter(c => !!c.parsedData?.year);
            if (withYear.length > 0 && withYear.length !== candidates.length) {
                candidates = withYear;
                chosenReasons.push('prefer records with year');
            }

            // 4) Full author list preferred over et al. truncation.
            const nonEtAl = candidates.filter(c => !hasEtAl(c.parsedData?.authors));
            if (nonEtAl.length > 0 && nonEtAl.length !== candidates.length) {
                candidates = nonEtAl;
                chosenReasons.push('prefer full author list over et al.');
            }

            // 5) Reference type coherence for proceedings clusters.
            const conferenceTyped = candidates.filter(c => c.referenceType === 'conference' || !!c.parsedData?.conferenceTitle);
            if (conferenceTyped.length > 0 && conferenceTyped.length !== candidates.length) {
                candidates = conferenceTyped;
                chosenReasons.push('prefer conference-typed records');
            }

            let bestMember = candidates[0];
            let bestQuality = (diagById.get(bestMember.id)?.score ?? memberQualityScore(bestMember));
            let usedApaSourcePreference = false;

            for (let i = 1; i < candidates.length; i++) {
                const candidate = candidates[i];
                const candidateQuality = (diagById.get(candidate.id)?.score ?? memberQualityScore(candidate));
                if (candidateQuality > bestQuality) {
                    bestQuality = candidateQuality;
                    bestMember = candidate;
                } else if (candidateQuality === bestQuality) {
                    const candidateConf = candidate.confidence?.score || 0;
                    const bestConf = bestMember.confidence?.score || 0;
                    if (candidateConf > bestConf) {
                        bestMember = candidate;
                    } else if (candidateConf === bestConf) {
                        const fieldsI = countFilledFields(candidate.parsedData || {});
                        const fieldsBest = countFilledFields(bestMember.parsedData || {});
                        if (fieldsI > fieldsBest) {
                            bestMember = candidate;
                        } else if (fieldsI === fieldsBest) {
                            const candidateIsApa = (candidate.inputStyle || '').toLowerCase() === 'apa';
                            const bestIsApa = (bestMember.inputStyle || '').toLowerCase() === 'apa';
                            if (candidateIsApa && !bestIsApa && isNearEquivalentDuplicate(candidate, bestMember)) {
                                bestMember = candidate;
                                usedApaSourcePreference = true;
                            }
                        }
                    }
                } else {
                    const candidateIsApa = (candidate.inputStyle || '').toLowerCase() === 'apa';
                    const bestIsApa = (bestMember.inputStyle || '').toLowerCase() === 'apa';
                    if (
                        candidateIsApa &&
                        !bestIsApa &&
                        candidateQuality >= bestQuality - 2 &&
                        isNearEquivalentDuplicate(candidate, bestMember)
                    ) {
                        bestQuality = candidateQuality;
                        bestMember = candidate;
                        usedApaSourcePreference = true;
                    }
                }
            }

            // Final APA-source bias: if an APA input variant is nearly as good quality-wise
            // and clearly the same work, let it win as the cluster representative.
            if (!usedApaSourcePreference) {
                const apaCandidates = candidates.filter(c => (c.inputStyle || '').toLowerCase() === 'apa');
                for (const apa of apaCandidates) {
                    if (apa.id === bestMember.id) continue;
                    const diagApa = diagById.get(apa.id);
                    const apaQuality = (diagApa?.score ?? memberQualityScore(apa));
                    // Only consider APA variants that are not materially worse.
                    if (apaQuality + 2 < bestQuality) continue;
                    const apaParsed: ParsedReference = apa.parsedData ?? {};
                    const bestParsed: ParsedReference = bestMember.parsedData ?? {};
                    const sim = calculateCitationSimilarity(apaParsed, bestParsed);
                    if (sim >= 90) {
                        bestMember = apa;
                        bestQuality = apaQuality;
                        usedApaSourcePreference = true;
                        break;
                    }
                }
            }

            if (usedApaSourcePreference) {
                chosenReasons.push('prefer APA-source variant for near-equivalent duplicates');
            }

            cluster.bestMemberId = bestMember.id;
            cluster.bestConfidenceScore = bestMember.confidence?.score || 0;
            if (clusterWarnings.length > 0) cluster.warnings = clusterWarnings;
            cluster.winnerDiagnostics = {
                chosenMemberId: bestMember.id,
                chosenReasons,
                memberDiagnostics,
            };
        }
    }

    // Only return clusters that actually have more than 1 item, to clean up UX response.
    return clusters.filter(c => c.members.length > 1);
}
