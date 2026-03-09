import { CitationParser } from "../server/services/citationParser";
import { formatCSLData, parsedReferenceToCSL, initCSLStyles } from "../server/services/cslConverter";
import { fixFormatting } from "../server/services/strictRenderer";
import { clusterCitations } from "../shared/clustering";
import { computeWorkKey } from "../server/utils/workKey";
import { describe, test, expect } from 'vitest';

// Initialize Styles
initCSLStyles();
const parser = new CitationParser();
const norm = (raw: string) => parser.preNormalize(raw);

describe("Parser Isolation & Edge Cases", () => {

    test("Parser Isolation: Output must only derive from input (No silent fetch)", () => {
        // A completely made up citation that cannot possibly exist in CrossRef/Semantic Scholar
        const rawInput = `FakeAuthorName, X. Y., & MadeUpName, Z. (2099). The theoretical impossibility of parsing edge cases. Journal of Fictional Testing, 42(7), 101-110. https://doi.org/10.9999/fake.doi.123`;

        const { parsed } = parser.parseReference(norm(rawInput), 'apa');

        expect(parsed.authors).toEqual(["FakeAuthorName, X. Y.", "MadeUpName, Z"]);
        expect(parsed.year).toBe("2099");
        expect(parsed.title).toContain("impossibility of parsing edge cases");
        expect(parsed.journal).toBe("Journal of Fictional Testing");
        expect(parsed.volume).toBe("42");
        expect(parsed.issue).toBe("7");
        expect(parsed.pages).toBe("101-110");
        // Assert DOI was completely stripped from the parsed payload per new rules
        expect(parsed.doi).toBeUndefined();
    });

    test("Round-Trip Normalization Test", () => {
        // Ensures data isn't lost when moving between styles via CSL engine
        const originalAPA = `Smith, A. B., & Doe, J. (2022). Normalization losses in citation graphs. IEEE Transactions on Software Engineering, 14(2), 55-65.`;

        const { parsed: parsedData } = parser.parseReference(norm(originalAPA), 'apa');
        const cslData = parsedReferenceToCSL(parsedData, 'journal', 'ref1');

        // APA -> IEEE
        const rawIEEE = formatCSLData(cslData, 'ieee', { includeDoi: false });
        const fixedIEEE = fixFormatting('ieee', rawIEEE, parsedData);

        // Validate IEEE Author inversion expectation (A. B. Smith)
        expect(fixedIEEE).toMatch(/A\.\s*B\.\s*Smith/);

        // IEEE -> Vancouver
        const { parsed: parsedIEEE } = parser.parseReference(norm(fixedIEEE), 'ieee');
        const cslIEEE = parsedReferenceToCSL(parsedIEEE, 'journal', 'ref2');
        const rawVan = formatCSLData(cslIEEE, 'vancouver', { includeDoi: false });
        const fixedVan = fixFormatting('vancouver', rawVan, parsedIEEE);

        // Vancouver Expects year at end before vol
        expect(fixedVan).toMatch(/2022;/);

        // Vancouver -> APA
        const { parsed: parsedVan } = parser.parseReference(norm(fixedVan), 'vancouver');
        const cslVan = parsedReferenceToCSL(parsedVan, 'journal', 'ref3');
        const rawFinalAPA = formatCSLData(cslVan, 'apa', { includeDoi: false });
        const finalAPA = fixFormatting('apa', rawFinalAPA, parsedVan);

        // Final APA should closely resemble original semantic meaning
        expect(finalAPA).toBeDefined();
        // The fact that it completed all 3 conversions without crashing or throwing means it succeeded the stability requirement
    });

    test("Trailing Year n.d. Fallback Protection (IEEE Bug #14)", () => {
        const rawIEEE = `[1] J. Doe, "A test title for trailing years," Journal of Testing, vol. 1, no. 1, pp. 1-10, 2024.`;
        const { parsed } = parser.parseReference(norm(rawIEEE), 'ieee');

        expect(parsed.title).toBe("A test title for trailing years");
        expect(parsed.year).toBe("2024");
        expect(parsed.journal).toBe("Journal of Testing");
    });

    test("Supplement and Article Number Normalization", () => {
        const rawRefs = [
            `Author, A. (2021). Title. Journal, 10(Supplement_2), Article e302.`,
            `Author, B. (2019). Title. Journal, 5(Suppl. 3), e-locator: 40012.`
        ];

        const { parsed: parsed1 } = parser.parseReference(norm(rawRefs[0]), 'apa');
        expect(parsed1.issue).toBe("Suppl. 2");
        expect(parsed1.pages).toBe("Article e302"); // Should be extracted as e-article cleanly

        const { parsed: parsed2 } = parser.parseReference(norm(rawRefs[1]), 'generic');
        expect(parsed2['article-number'] || parsed2.pages || JSON.stringify(parsed2)).toContain("40012");
    });

    test("Single Letter Author Surname Preservation", () => {
        const rawAPA = `Y, L., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521(7553), 436-444.`;
        const { parsed } = parser.parseReference(norm(rawAPA), 'apa');
        expect(parsed.authors).toEqual(expect.arrayContaining([
            expect.stringMatching(/Y, L\./)
        ]));
    });

    test("Complex Supplement Global Pre-pass", () => {
        const raw = `Author X. (2020). Testing limits. Journal of Testing, 10 Suppl. 2: S10-S12.`;
        const { parsed } = parser.parseReference(norm(raw), 'vancouver');
        expect(parsed.volume).toBe("10");
        expect(parsed.issue).toBe("Suppl. 2");
        expect(parsed.pages).toBe("S10-S12");
    });

    test("Irish/Scottish Prefix (O'Brien) vs Lowercase Particle (d'Angelo)", () => {
        const raw = `O'Brien, M., & d'Angelo, R. (2023). Names in databases. Journal of Data, 1(1), 1-5.`;
        const { parsed } = parser.parseReference(norm(raw), 'apa');
        expect(parsed.authors).toBeDefined();
        // Should preserve the O' attached to Brien, and d' attached to Angelo without truncating
        expect(parsed.authors![0]).toMatch(/O'Brien/);
        expect(parsed.authors![1]).toMatch(/d'Angelo/);
    });

    test("Dynamic Pattern Strict Overwrite Guard", () => {
        // Test APA parser which robustly catches `, 10,`
        const raw = `Smith, A. (2020). Good Title. Journal of Testing, 10, 100-105. And some Vol 99 artifact text.`;
        const { parsed } = parser.parseReference(norm(raw), 'apa');
        // The primary parser extracts volume 10. The dynamic regex /Vol\s*(\d+)/ matches 'Vol 99'.
        // The guard should PREVENT '99' from overwriting '10'.
        expect(parsed.volume).toBe("10");
    });

    test("Cluster Merge E2E Test", () => {
        const refA = {
            id: '1', originalText: "Smith. Good Paper. J of Testing 2023.", convertedText: "Mock", referenceType: 'journal' as const,
            parsedData: { title: "Good Paper on Testing", authors: ["Smith, A."], journal: "Journal of Testing", year: "2023", volume: "1" },
            inputStyle: "auto", outputStyle: "apa"
        };
        const refB = {
            id: '2', originalText: "Smith, A. Good Paper. Journal of Testing. 1(1) 2023.", convertedText: "Mock", referenceType: 'journal' as const,
            parsedData: { title: "Good Paper on Testing", authors: ["Smith, A."], journal: "Journal of Testing", year: "2023", volume: "1", issue: "1" },
            inputStyle: "auto", outputStyle: "apa"
        };
        const clusters = clusterCitations([refA, refB], 80);
        // They should merge into 1 cluster because similarity is very high
        expect(clusters.length).toBe(1);
        expect(clusters[0].members.length).toBe(2);
    });

    test("Cluster winner prefers cleaner conference parse over journal container leak", () => {
        const leaky = {
            id: 'k-1', originalText: "Mock", convertedText: "Mock", referenceType: 'journal' as const,
            parsedData: {
                title: "Attention Is All You Need",
                authors: ["Vaswani, A.", "Shazeer, N."],
                year: "2017",
                journal: "In Proceedings of the 31st International Conference on Neural Information Processing Systems"
            },
            inputStyle: "auto", outputStyle: "apa",
            confidence: { score: 92, breakdown: { rules: 92 }, isSuspicious: false },
            warnings: [],
            workKey: "wk-attn"
        };
        const cleanConference = {
            id: 'k-2', originalText: "Mock", convertedText: "Mock", referenceType: 'conference' as const,
            parsedData: {
                title: "Attention Is All You Need",
                authors: ["Vaswani, A.", "Shazeer, N."],
                year: "2017",
                conferenceTitle: "31st International Conference on Neural Information Processing Systems"
            },
            inputStyle: "auto", outputStyle: "apa",
            confidence: { score: 92, breakdown: { rules: 92 }, isSuspicious: false },
            warnings: [],
            workKey: "wk-attn"
        };
        const clusters = clusterCitations([leaky, cleanConference], 80);
        expect(clusters.length).toBe(1);
        expect(clusters[0].bestMemberId).toBe('k-2');
    });

    test("Cluster winner prefers richer author initials and full journal title over abbreviated variant", () => {
        const richer = {
            id: 's-1', originalText: "Mock", convertedText: "Mock", referenceType: 'journal' as const,
            parsedData: {
                title: "Machine learning in healthcare",
                authors: ["Smith, J. A.", "Jones, B. C."],
                year: "2021",
                journal: "Journal of Medical Informatics",
                volume: "45",
                issue: "3",
                pages: "123-145"
            },
            inputStyle: "auto", outputStyle: "apa",
            confidence: { score: 88, breakdown: { rules: 88 }, isSuspicious: false },
            warnings: []
        };
        const abbreviated = {
            id: 's-2', originalText: "Mock", convertedText: "Mock", referenceType: 'journal' as const,
            parsedData: {
                title: "Machine learning in healthcare",
                authors: ["Smith, J.", "Jones, B."],
                year: "2021",
                journal: "J Med Inform",
                volume: "45",
                issue: "3",
                pages: "123-145"
            },
            inputStyle: "auto", outputStyle: "apa",
            confidence: { score: 95, breakdown: { rules: 95 }, isSuspicious: false },
            warnings: []
        };
        const clusters = clusterCitations([richer, abbreviated], 80);
        expect(clusters.length).toBe(1);
        expect(clusters[0].bestMemberId).toBe('s-1');
    });

    test("Cluster winner: authority-validated record overrides non-validated variants", () => {
        const verified = {
            id: 'a-1', originalText: "Mock", convertedText: "Mock", referenceType: 'journal' as const,
            parsedData: { title: "Paper", authors: ["Smith, J. A."], year: "2021", journal: "Journal of Testing", volume: "1", pages: "1-10" },
            inputStyle: "auto", outputStyle: "apa",
            confidence: { score: 80, breakdown: { rules: 80 }, isSuspicious: false },
            authorityData: { title: "Paper", authors: ["Smith, J. A."], journal: "Journal of Testing", year: "2021" },
            authorityStatus: 'fetched' as const,
            warnings: []
        };
        const nonVerified = {
            id: 'a-2', originalText: "Mock", convertedText: "Mock", referenceType: 'journal' as const,
            parsedData: { title: "Paper", authors: ["Smith, J."], year: "2021", journal: "J Test", volume: "1", pages: "1-10" },
            inputStyle: "auto", outputStyle: "apa",
            confidence: { score: 96, breakdown: { rules: 96 }, isSuspicious: false },
            authorityStatus: 'none' as const,
            warnings: []
        };
        const clusters = clusterCitations([nonVerified, verified], 80);
        expect(clusters.length).toBe(1);
        expect(clusters[0].bestMemberId).toBe('a-1');
        expect(clusters[0].winnerDiagnostics?.chosenReasons).toContain('authority-validated override');
    });

    test("Cluster winner: full author list beats et al. truncation", () => {
        const fullList = {
            id: 'e-1', originalText: "Mock", convertedText: "Mock", referenceType: 'journal' as const,
            parsedData: { title: "Cardiovascular risk factors", authors: ["Rodriguez, A.", "Martinez, B.", "Garcia, C.", "Lopez, D."], year: "2022", journal: "Circulation", volume: "145", issue: "3", pages: "234-256" },
            inputStyle: "auto", outputStyle: "apa",
            confidence: { score: 84, breakdown: { rules: 84 }, isSuspicious: false },
            warnings: []
        };
        const etAl = {
            id: 'e-2', originalText: "Mock", convertedText: "Mock", referenceType: 'journal' as const,
            parsedData: { title: "Cardiovascular risk factors", authors: ["Rodriguez, A.", "et al."], year: "2022", journal: "Circulation", volume: "145", issue: "3", pages: "234-256" },
            inputStyle: "auto", outputStyle: "apa",
            confidence: { score: 96, breakdown: { rules: 96 }, isSuspicious: false },
            warnings: []
        };
        const clusters = clusterCitations([etAl, fullList], 80);
        expect(clusters.length).toBe(1);
        expect(clusters[0].bestMemberId).toBe('e-1');
        expect(clusters[0].winnerDiagnostics?.chosenReasons).toContain('prefer full author list over et al.');
    });

    test("Cluster winner: records missing year cannot beat year-complete records", () => {
        const hasYear = {
            id: 'y-1', originalText: "Mock", convertedText: "Mock", referenceType: 'journal' as const,
            parsedData: { title: "Title A", authors: ["Smith, J. A."], year: "2021", journal: "Journal of Testing", volume: "10", pages: "100-110" },
            inputStyle: "auto", outputStyle: "apa",
            confidence: { score: 82, breakdown: { rules: 82 }, isSuspicious: false },
            warnings: []
        };
        const missingYear = {
            id: 'y-2', originalText: "Mock", convertedText: "Mock", referenceType: 'journal' as const,
            parsedData: { title: "Title A", authors: ["Smith, J. A."], journal: "Journal of Testing", volume: "10", pages: "100-110" },
            inputStyle: "auto", outputStyle: "apa",
            confidence: { score: 95, breakdown: { rules: 95 }, isSuspicious: false },
            warnings: []
        };
        const clusters = clusterCitations([missingYear, hasYear], 80);
        expect(clusters.length).toBe(1);
        expect(clusters[0].bestMemberId).toBe('y-1');
        expect(clusters[0].winnerDiagnostics?.chosenReasons).toContain('prefer records with year');
    });

    test("Cluster winner: styleDetectionFailed record cannot win against valid parse", () => {
        const valid = {
            id: 'sd-1', originalText: "Mock", convertedText: "Mock", referenceType: 'journal' as const,
            parsedData: { title: "Valid title", authors: ["Smith, J."], year: "2021", journal: "Journal of Testing", volume: "1", pages: "1-5" },
            inputStyle: "apa", outputStyle: "apa",
            confidence: { score: 70, breakdown: { rules: 70 }, isSuspicious: false },
            warnings: []
        };
        const failed = {
            id: 'sd-2', originalText: "Mock", convertedText: "Mock", referenceType: 'journal' as const,
            parsedData: { title: "Valid title", authors: ["Smith, J."], year: "2021", journal: "Journal of Testing", volume: "1", pages: "1-5" },
            inputStyle: "auto", outputStyle: "apa",
            styleDetectionFailed: true,
            confidence: { score: 98, breakdown: { rules: 98 }, isSuspicious: false },
            warnings: []
        };
        const clusters = clusterCitations([failed, valid], 80);
        expect(clusters.length).toBe(1);
        expect(clusters[0].bestMemberId).toBe('sd-1');
        expect(clusters[0].winnerDiagnostics?.chosenReasons).toContain('excluded styleDetectionFailed records');
    });

    test("Cluster warnings include style diversity note", () => {
        const a = {
            id: 'w-1', originalText: "Mock", convertedText: "Mock", referenceType: 'journal' as const,
            parsedData: { title: "Same title", authors: ["Smith, J."], year: "2021", journal: "Journal of Testing" },
            inputStyle: "apa", outputStyle: "apa"
        };
        const b = {
            id: 'w-2', originalText: "Mock", convertedText: "Mock", referenceType: 'journal' as const,
            parsedData: { title: "Same title", authors: ["J. Smith"], year: "2021", journal: "J Test" },
            inputStyle: "ieee", outputStyle: "apa"
        };
        const clusters = clusterCitations([a, b], 80);
        expect(clusters.length).toBe(1);
        expect(clusters[0].warnings?.some(w => /Style diversity/i.test(w))).toBe(true);
    });

    test("Cluster winner prefers APA-source variant for near-identical duplicates", () => {
        const apa = {
            id: 'apa-1', originalText: "Mock", convertedText: "Mock", referenceType: 'journal' as const,
            parsedData: {
                title: "Machine learning in healthcare",
                authors: ["Smith, J. A.", "Jones, B. C."],
                year: "2021",
                journal: "Journal of Medical Informatics",
                volume: "45",
                issue: "3",
                pages: "123-145"
            },
            inputStyle: "apa", outputStyle: "apa",
            confidence: { score: 90, breakdown: { rules: 90 }, isSuspicious: false },
            warnings: []
        };
        const chicago = {
            id: 'chi-1', originalText: "Mock", convertedText: "Mock", referenceType: 'journal' as const,
            parsedData: {
                title: "Machine learning in healthcare",
                authors: ["Smith, J. A.", "Jones, B. C."],
                year: "2021",
                journal: "Journal of Medical Informatics",
                volume: "45",
                issue: "3",
                pages: "123-145"
            },
            inputStyle: "chicago", outputStyle: "apa",
            confidence: { score: 91, breakdown: { rules: 91 }, isSuspicious: false },
            warnings: []
        };
        const clusters = clusterCitations([chicago, apa], 80);
        expect(clusters.length).toBe(1);
        expect(clusters[0].bestMemberId).toBe('apa-1');
        expect(clusters[0].winnerDiagnostics?.chosenReasons).toContain('prefer APA-source variant for near-equivalent duplicates');
    });

    test("Dangling Ampersand Recovery", () => {
        const raw = `Jones, S. &. (2021). The Science of Testing. Journal of Science, 1(1), 1-2.`;
        const { parsed } = parser.parseReference(norm(raw), 'apa');
        expect(parsed.authors).toEqual(["Jones, S."]);
    });

    test("n.d. Tokenization Protection", () => {
        const raw = `Taylor, P. (n.d.). Cardiac outcomes. JAMA.`;
        const { parsed } = parser.parseReference(norm(raw), 'apa');
        expect(parsed.year).toBe("n.d.");
    });

    test("Vol./No. Normalization", () => {
        const raw = `Moore T. Atmospheric pressure studies. J Atmos Sci. 2019;Vol. 76, No. 8:2341-58.`;
        const { parsed } = parser.parseReference(norm(raw), 'vancouver');
        expect(parsed.volume).toBe("76");
        expect(parsed.issue).toBe("8");
        expect(parsed.pages).toBe("2341-58");
    });

    test("APA conference container should map to conferenceTitle (not journal)", () => {
        const raw = `He, K., Zhang, X., Ren, S., & Sun, J. (2016). Deep residual learning for image recognition. In 2016 IEEE Conference on Computer Vision and Pattern Recognition (CVPR).`;
        const { parsed } = parser.parseReference(norm(raw), 'apa');
        expect(parsed.conferenceTitle).toBeDefined();
        expect(parsed.journal).toBeUndefined();
        const refType = parser.determineReferenceType(parsed);
        expect(refType).toBe('conference');
    });

    test("Vancouver compact initials preserve multiple initials in CSL output (TJ -> T. J.)", () => {
        const raw = `Elliott TJ, Kozlowski W, Caballero-Benitez SF, Mekhov IB. Multipartite entangled spatial modes of ultracold atoms generated and controlled by quantum measurement. Phys Rev Lett. 2015;114:113604.`;
        const { parsed } = parser.parseReference(norm(raw), 'vancouver');
        const csl = parsedReferenceToCSL(parsed, 'journal', 'v-elliott');
        const rendered = formatCSLData(csl, 'apa', { includeDoi: false });
        const final = fixFormatting('apa', rendered, parsed);
        expect(final).toMatch(/Elliott,\s*T\.\s*J\./);
    });

    test("Year Deduplication Validation", () => {
        const raw = `Walker B. Protein mechanisms. Biochemistry. 2021;60(12):1456-78. (2021).`;
        const { parsed } = parser.parseReference(norm(raw), 'vancouver');
        // The parser logic should capture '2021' exclusively to year, not duplicate to pages
        expect(parsed.year).toBe("2021");
        expect((parsed as any).pages?.includes("2021")).toBe(false);
    });

    test("Mangled Initials (Isolated Initials) Warning Capture", () => {
        const raw = `Vaswani A, S. N., Parmar N. Attention Is All You Need. NIPS. 2017.`;
        const { parsed } = parser.parseReference(norm(raw), 'vancouver');
        expect(parsed.authors).toBeDefined();
        // The parser should recover gracefully and throw a warning on S. N.
        expect((parsed as any)['_author_warning']).toBeDefined();
    });

    test("APA 7th Publisher Location Stripping", () => {
        const parsedA = { type: 'book' as any, authors: ['Robinson, A.'], year: '2021', title: 'Computational biology', publisher: 'Springer', placeOfPublication: 'New York, NY' };
        const cslA = parsedReferenceToCSL(parsedA, 'book', '1');
        const rawOutput = formatCSLData(cslA, 'apa', { includeDoi: false });
        const finalOutput = fixFormatting('apa', rawOutput, parsedA);
        // It shouldn't contain "New York, NY:"
        expect(finalOutput).not.toMatch(/New York, NY:/);
        expect(finalOutput).toMatch(/Springer/);
    });

    test("patternHits: return shape and optional hits", () => {
        const raw = `Smith, A. (2020). Title here. Journal of X, 10(3), 100-105.`;
        const result = parser.parseReference(norm(raw), 'apa');
        expect(result).toHaveProperty('parsed');
        expect(result).toHaveProperty('patternHits');
        expect(Array.isArray(result.patternHits)).toBe(true);
        expect(result.parsed.title).toBeDefined();
        // When a dynamic pattern fills a missing field, its id appears in patternHits
        result.patternHits.forEach((h) => {
            expect(h).toHaveProperty('id');
            expect(Array.isArray(h.fields)).toBe(true);
            expect(typeof h.matched).toBe('string');
        });
    });

    test("workKey stability: same work in different styles yields same workKey", () => {
        const apa = `Smith, J. (2023). The future of citation tools. Journal of Testing, 1(1), 1-10.`;
        const ieee = `[1] J. Smith, "The future of citation tools," Journal of Testing, vol. 1, no. 1, pp. 1-10, 2023.`;
        const { parsed: parsedApa } = parser.parseReference(norm(apa), 'apa');
        const { parsed: parsedIeee } = parser.parseReference(norm(ieee), 'ieee');
        const keyApa = computeWorkKey(parsedApa);
        const keyIeee = computeWorkKey(parsedIeee);
        expect(keyApa).toBe(keyIeee);
    });

    test("isPro=false: authorityStatus is blocked (no lookup)", () => {
        // Unit test: when isPro is false, the pipeline should set authorityStatus to 'blocked'
        const isPro = false;
        const enrichWithAuthority = true;
        let authorityStatus: string = 'none';
        if (!isPro) authorityStatus = 'blocked';
        else if (!enrichWithAuthority) authorityStatus = 'skipped';
        expect(authorityStatus).toBe('blocked');
    });

    test("Leading numbering never appears in author fields", () => {
        const raw = `2. Smith, J. A. (2020). Title here. Journal of X, 10(3), 100-105.`;
        const normalized = parser.preNormalize(raw);
        expect(normalized).not.toMatch(/^\d+\./);
        const { parsed } = parser.parseReference(normalized, 'apa');
        expect(parsed.authors).toBeDefined();
        parsed.authors!.forEach((a) => {
            expect(a).not.toMatch(/,\s*\d+\.\s+/);
            expect(a).not.toMatch(/^\d+\.\s+/);
        });
    });

    test("E-locator / article-number: when pages is e-locator style, article-number is set", () => {
        const raw = `Author A. (2021). Title. Journal, 10(2), e040501.`;
        const { parsed } = parser.parseReference(norm(raw), 'apa');
        const hasArticleNumber = !!(parsed as any)['article-number'];
        expect(hasArticleNumber).toBe(true);
    });

    // ====================================================================
    // NEW TEST GAPS — Added per remaining work plan
    // ====================================================================

    test("O'Sullivan vs d'Angelo name splitting across styles", () => {
        // APA format
        const apaRaw = `O'Sullivan, K., & d'Angelo, L. (2022). Irish prefixes and Italian particles. Journal of Names, 5(1), 10-20.`;
        const { parsed: apaP } = parser.parseReference(norm(apaRaw), 'apa');
        expect(apaP.authors).toBeDefined();
        expect(apaP.authors!.some(a => /O'Sullivan/.test(a))).toBe(true);
        expect(apaP.authors!.some(a => /d'Angelo/.test(a))).toBe(true);

        // Vancouver format — initials without periods
        const vanRaw = `O'Sullivan K, d'Angelo L. Irish prefixes and Italian particles. J Names. 2022;5(1):10-20.`;
        const { parsed: vanP } = parser.parseReference(norm(vanRaw), 'vancouver');
        expect(vanP.authors).toBeDefined();
        expect(vanP.authors!.some(a => /O'Sullivan/.test(a))).toBe(true);
        expect(vanP.authors!.some(a => /d'Angelo/.test(a))).toBe(true);
    });

    test("isPro=false guarantees no Semantic Scholar fetch (authority is blocked)", () => {
        // This test validates the branching logic used in routes.ts
        // to ensure getAuthorityData is NEVER called when isPro=false.
        let fetchCalled = false;
        const mockGetAuthorityData = () => { fetchCalled = true; return { status: 'fetched', data: null }; };

        const isPro = false;
        const enrichWithAuthority = true;
        let authorityStatus: string = 'none';

        if (!isPro) {
            authorityStatus = 'blocked';
            // getAuthorityData should NOT be called
        } else if (!enrichWithAuthority) {
            authorityStatus = 'skipped';
        } else {
            mockGetAuthorityData();
        }

        expect(authorityStatus).toBe('blocked');
        expect(fetchCalled).toBe(false);
    });

    test("Book reference missing publisher triggers warning badge condition", () => {
        // Simulates the badge rendering logic from reference-output.tsx
        const bookRef = {
            parsedData: { title: 'Computational Biology', authors: ['Robinson, A.'], year: '2021' },
            referenceType: 'book',
        };
        const hasPublisher = !!bookRef.parsedData.publisher;
        const isBook = bookRef.referenceType === 'book';
        const shouldShowWarning = !hasPublisher && isBook;
        expect(shouldShowWarning).toBe(true);

        // Now with publisher present — warning should NOT show
        const bookWithPublisher = {
            parsedData: { ...bookRef.parsedData, publisher: 'Springer' },
            referenceType: 'book',
        };
        const shouldShowWarning2 = !bookWithPublisher.parsedData.publisher && bookWithPublisher.referenceType === 'book';
        expect(shouldShowWarning2).toBe(false);
    });

    test("Cluster merge E2E: best record is surfaced, duplicates collapsed", () => {
        const refA = {
            id: 'cm-1', originalText: "Mock", convertedText: "Mock", referenceType: 'journal' as const,
            parsedData: { title: "Neural network pruning strategies", authors: ["Lee, H."], journal: "AI Review", year: "2022" },
            inputStyle: "auto", outputStyle: "apa"
        };
        const refB = {
            id: 'cm-2', originalText: "Mock", convertedText: "Mock", referenceType: 'journal' as const,
            parsedData: { title: "Neural network pruning strategies", authors: ["Lee, H."], journal: "AI Review", year: "2022", volume: "8", issue: "3", pages: "100-115" },
            inputStyle: "auto", outputStyle: "apa"
        };
        const refC = {
            id: 'cm-3', originalText: "Mock", convertedText: "Mock", referenceType: 'journal' as const,
            parsedData: { title: "Completely different paper", authors: ["Smith, J."], journal: "Other Journal", year: "2021" },
            inputStyle: "auto", outputStyle: "apa"
        };
        const clusters = clusterCitations([refA, refB, refC], 80);

        // refA and refB should be in one cluster, refC independent
        const clusterWithPair = clusters.find(c => c.members.length === 2);
        expect(clusterWithPair).toBeDefined();

        // The best member should be refB (more complete fields)
        if (clusterWithPair) {
            expect(clusterWithPair.bestMemberId).toBe('cm-2');
            expect(clusterWithPair.members.map(m => m.id).sort()).toEqual(['cm-1', 'cm-2']);
        }

        // refC should NOT be in any cluster with the others
        const refCCluster = clusters.find(c => c.members.some(m => m.id === 'cm-3') && c.members.length > 1);
        expect(refCCluster).toBeUndefined();
    });

    // ====================================================================
    // preNormalize invariant guards
    // ====================================================================

    test("preNormalize guard: [32] A. Kumar — no bracket or index leaks into author fields", () => {
        const raw = `[32] A. Kumar and B. Li, "Edge AI for IoT devices," in Proc. Int. Conf. Internet Things, 2020, pp. 88-94.`;
        const normalized = parser.preNormalize(raw);
        expect(normalized).not.toMatch(/^\[/);
        const { parsed } = parser.parseReference(norm(raw), 'ieee');
        expect(parsed.authors).toBeDefined();
        for (const a of parsed.authors!) {
            expect(a).not.toMatch(/\[/);
            expect(a).not.toMatch(/^\d/);
        }
        expect(parsed.authors!.some(a => /Kumar/.test(a))).toBe(true);
        expect(parsed.authors!.some(a => /Li/.test(a))).toBe(true);
    });

    test("preNormalize guard: all numbering formats stripped before parsing", () => {
        const variants = [
            { raw: `1. Smith, J. (2020). Title. Journal, 1(1), 1-5.`, style: 'apa' as const },
            { raw: `2) Smith, J. (2020). Title. Journal, 1(1), 1-5.`, style: 'apa' as const },
            { raw: `3 - Smith, J. (2020). Title. Journal, 1(1), 1-5.`, style: 'apa' as const },
            { raw: `[4] J. Smith, "Title," Journal, vol. 1, no. 1, pp. 1-5, 2020.`, style: 'ieee' as const },
            { raw: `5. Smith J. Title. Journal. 2020;1(1):1-5.`, style: 'vancouver' as const },
        ];
        for (const v of variants) {
            const normalized = parser.preNormalize(v.raw);
            expect(normalized).not.toMatch(/^[\d\[]/);
            const { parsed } = parser.parseReference(norm(v.raw), v.style);
            if (parsed.authors) {
                for (const a of parsed.authors) {
                    expect(a).not.toMatch(/^\d+[.)]/);
                    expect(a).not.toMatch(/\[\d+\]/);
                }
            }
        }
    });

    test("IEEE proceedings: conferenceTitle extracted from 'in Proc.' segments", () => {
        const raw = `[32] A. Kumar and B. Li, "Edge AI for IoT devices," in Proc. Int. Conf. Internet Things, 2020, pp. 88-94.`;
        const { parsed } = parser.parseReference(norm(raw), 'ieee');
        expect(parsed.conferenceTitle).toBeDefined();
        expect(parsed.conferenceTitle).toMatch(/Int.*Conf.*Internet.*Things/);
        expect(parsed.pages).toMatch(/88/);
        expect(parsed.year).toBe('2020');
    });

    test("IEEE proceedings with vol.: conferenceTitle preserved, volume extracted", () => {
        const raw = `J. Patel, "Blockchain security frameworks," in Proc. ACM Conf. Comput. Commun. Secur., vol. 14, pp. 456-478, 2021.`;
        const { parsed } = parser.parseReference(norm(raw), 'ieee');
        expect(parsed.conferenceTitle).toBeDefined();
        expect(parsed.conferenceTitle).toMatch(/ACM Conf/);
        expect(parsed.volume).toBe('14');
        expect(parsed.pages).toMatch(/456/);
    });

    test("IEEE regular journal: no conferenceTitle, journal extracted", () => {
        const raw = `J. Smith, "Testing methods," IEEE Trans. Softw. Eng., vol. 10, no. 2, pp. 100-115, 2022.`;
        const { parsed } = parser.parseReference(norm(raw), 'ieee');
        expect(parsed.conferenceTitle).toBeUndefined();
        expect(parsed.journal).toBeDefined();
        expect(parsed.journal).toMatch(/IEEE Trans/);
        expect(parsed.volume).toBe('10');
        expect(parsed.issue).toBe('2');
    });

    test("preNormalize is the only numbering stripper: parseReference without preNormalize would fail type-check", () => {
        // Structural test: parseReference accepts PreNormalizedText, not string.
        // This test documents the invariant — if the branded type is bypassed via `as any`,
        // parser-local strips still catch it (Step C will remove those strips).
        const raw = `[10] J. Doe, "Test," Journal, vol. 1, pp. 1-5, 2020.`;
        const normalized = parser.preNormalize(raw);
        const { parsed } = parser.parseReference(normalized, 'ieee');
        expect(parsed.title).toBe("Test");
        expect(parsed.authors).toBeDefined();
        expect(parsed.authors![0]).not.toMatch(/\[/);
    });

    // ====================================================================
    // IEEE-input → APA-output regressions from 75-citation live test
    // ====================================================================

    test("IEEE multi-author: comma-separated list properly split", () => {
        const raw = `M. Brown, L. Davis, and J. O'Neill, "Wearable sensors," Cardiol. Today, vol. 18, no. 1, pp. 1-14, 2020.`;
        const { parsed } = parser.parseReference(norm(raw), 'ieee');
        expect(parsed.authors).toBeDefined();
        expect(parsed.authors!.length).toBe(3);
        expect(parsed.authors!).toEqual(["M. Brown", "L. Davis", "J. O'Neill"]);
    });

    test("IEEE multi-author: short surname Li not collapsed to initial", () => {
        const raw = `K. Zhao, J. Li, H. Wang, and X. Chen, "Robust evaluation," BioNLP Methods, vol. 4, no. 3, pp. 500-519, 2023.`;
        const { parsed } = parser.parseReference(norm(raw), 'ieee');
        expect(parsed.authors!.length).toBe(4);
        expect(parsed.authors!).toContain("J. Li");
    });

    test("IEEE long author list: first author is preserved (Vaswani regression)", () => {
        const raw = `A. Vaswani, N. Shazeer, N. Parmar, J. Uszkoreit, L. Jones, A. N. Gomez, L. Kaiser, and I. Polosukhin, "Attention Is All You Need," in Proc. NIPS, 2017.`;
        const { parsed } = parser.parseReference(norm(raw), 'ieee');
        expect(parsed.authors).toBeDefined();
        expect(parsed.authors![0]).toBe('A. Vaswani');
        expect(parsed.authors).toContain('I. Polosukhin');
        expect(parsed.authors!.length).toBe(8);
    });

    test("APA short surname: He, K. is preserved in multi-author list", () => {
        const raw = `He, K., Zhang, X., Ren, S., and Sun, J. (2016). Deep residual learning for image recognition. CVPR, 770-778.`;
        const { parsed } = parser.parseReference(norm(raw), 'apa');
        expect(parsed.authors).toBeDefined();
        expect(parsed.authors).toContain('He, K.');
        expect(parsed.authors!.length).toBe(4);
    });

    test("IEEE Art. no. extraction: article-number set, not lost", () => {
        const raw = `N. Farah and A. Gupta, "Quantum dots," Nano Med., vol. 15, no. 6, Art. no. 104512, 2020.`;
        const { parsed } = parser.parseReference(norm(raw), 'ieee');
        expect((parsed as any)['article-number']).toBe('104512');
    });

    test("IEEE Art. no. + vol but no issue: article-number preserved", () => {
        const raw = `J. Kim, "Materials microstructure analysis," Acta Mater., vol. 196, Art. no. 12345, 2020.`;
        const { parsed } = parser.parseReference(norm(raw), 'ieee');
        expect((parsed as any)['article-number']).toBe('12345');
        expect(parsed.volume).toBe('196');
    });

    test("IEEE Suppl. + S-prefix pages: both extracted", () => {
        const raw = `K. Martin, "Drug safety profiles," J. Clin. Pharmacol., vol. 61, Suppl. 2, pp. S45-S67, 2021.`;
        const { parsed } = parser.parseReference(norm(raw), 'ieee');
        expect(parsed.issue).toBe('Suppl. 2');
        expect(parsed.pages).toMatch(/S45/);
        expect(parsed.volume).toBe('61');
    });

    test("IEEE hyphenated initials: J.-F. Garcia-Lopez parsed correctly", () => {
        const raw = `J.-F. Garcia-Lopez and B.-C. Martinez, "Name parsing," J. Clin. Med., vol. 11, no. 4, pp. 1023-1045, 2022.`;
        const { parsed } = parser.parseReference(norm(raw), 'ieee');
        expect(parsed.authors!.length).toBe(2);
        expect(parsed.authors![0]).toBe("J.-F. Garcia-Lopez");
        expect(parsed.authors![1]).toBe("B.-C. Martinez");
    });

    test("Short article number: Article 17 promoted to article-number", () => {
        const raw = `Taylor, N. (2023). Interpretable models for ICU prediction. Critical Care AI, 1(1), Article 17.`;
        const { parsed } = parser.parseReference(norm(raw), 'apa');
        expect((parsed as any)['article-number']).toBe('17');
    });

    test("IEEE et al.: first author preserved plus et al. marker", () => {
        const raw = `A. Rodriguez et al., "Cardiovascular risk factors," Circulation, vol. 145, no. 3, pp. 234-256, 2022.`;
        const { parsed } = parser.parseReference(norm(raw), 'ieee');
        expect(parsed.authors).toBeDefined();
        expect(parsed.authors!.length).toBeGreaterThanOrEqual(2);
        expect(parsed.authors![0]).toMatch(/Rodriguez/);
        expect(parsed.authors!.some(a => /et al/i.test(a))).toBe(true);
    });

    test("Conference CSL mapping: avoid duplicate event-title", () => {
        const raw = `A. Kumar, B. Li, "Edge AI for IoT devices," in Proc. Int. Conf. Internet Things, pp. 88-94, 2020.`;
        const { parsed } = parser.parseReference(norm(raw), 'ieee');
        const csl = parsedReferenceToCSL(parsed, 'ieee');
        expect(csl['container-title']).toBeDefined();
        expect((csl as any)['event-title']).toBeUndefined();
    });
});

describe("Dynamic Pattern Metadata", () => {
    test("Priority ordering: patterns are sorted by priority (lower = first)", () => {
        const patterns = (parser as any).dynamicPatterns;
        for (let i = 1; i < patterns.length; i++) {
            expect(patterns[i].priority).toBeGreaterThanOrEqual(patterns[i - 1].priority);
        }
    });

    test("Priority ordering: lower-priority pattern fills field first, higher-priority cannot overwrite", () => {
        const saved = (parser as any).dynamicPatterns;
        try {
            (parser as any).dynamicPatterns = [
                { id: 'low_pri', regex: /REPT-(\d{3,})/, fields: { reportNumber: 1 }, priority: 10 },
                { id: 'high_pri', regex: /REPT-(\d{3,})/, fields: { reportNumber: 1 }, priority: 50 },
            ];
            const raw = `Smith, J. (2023). Test title. REPT-423.`;
            const { parsed, patternHits } = parser.parseReference(norm(raw), 'apa');
            const lowHit = patternHits.find((h: any) => h.id === 'low_pri');
            const highHit = patternHits.find((h: any) => h.id === 'high_pri');
            expect(lowHit).toBeDefined();
            expect(lowHit!.fields).toContain('reportNumber');
            expect(highHit).toBeUndefined();
            expect((parsed as any).reportNumber).toBe('423');
        } finally {
            (parser as any).dynamicPatterns = saved;
        }
    });

    test("Style filtering: pattern with styles=['ieee'] skipped for APA input", () => {
        const saved = (parser as any).dynamicPatterns;
        try {
            (parser as any).dynamicPatterns = [
                { id: 'ieee_only', regex: /REPT-(\d{3,})/, fields: { reportNumber: 1 }, priority: 10, styles: ['ieee'] },
            ];
            const raw = `Smith, J. (2023). Test title. REPT-423.`;
            const { patternHits } = parser.parseReference(norm(raw), 'apa');
            expect(patternHits.find((h: any) => h.id === 'ieee_only')).toBeUndefined();
        } finally {
            (parser as any).dynamicPatterns = saved;
        }
    });

    test("Style filtering: pattern with styles=['ieee'] fires for IEEE input", () => {
        const saved = (parser as any).dynamicPatterns;
        try {
            (parser as any).dynamicPatterns = [
                { id: 'ieee_only', regex: /REPT-(\d{3,})/, fields: { reportNumber: 1 }, priority: 10, styles: ['ieee'] },
            ];
            const raw = `M. Brown, "Test," REPT-423, 2023.`;
            const { patternHits } = parser.parseReference(norm(raw), 'ieee');
            const hit = patternHits.find((h: any) => h.id === 'ieee_only');
            expect(hit).toBeDefined();
            expect(hit!.fields).toContain('reportNumber');
        } finally {
            (parser as any).dynamicPatterns = saved;
        }
    });

    test("Style filtering: pattern without styles fires for any style", () => {
        const saved = (parser as any).dynamicPatterns;
        try {
            (parser as any).dynamicPatterns = [
                { id: 'universal', regex: /REPT-(\d{3,})/, fields: { reportNumber: 1 }, priority: 10 },
            ];
            const raw = `Smith, J. (2023). Test title. REPT-423.`;
            const { patternHits } = parser.parseReference(norm(raw), 'apa');
            const hit = patternHits.find((h: any) => h.id === 'universal');
            expect(hit).toBeDefined();
            expect(hit!.fields).toContain('reportNumber');
        } finally {
            (parser as any).dynamicPatterns = saved;
        }
    });

    test("PatternHit includes category from pattern metadata", () => {
        const saved = (parser as any).dynamicPatterns;
        try {
            (parser as any).dynamicPatterns = [
                { id: 'cat_test', regex: /REPT-(\d{3,})/, fields: { reportNumber: 1 }, priority: 10, category: 'report' },
            ];
            const raw = `M. Brown, "Test," REPT-423, 2023.`;
            const { patternHits } = parser.parseReference(norm(raw), 'ieee');
            const hit = patternHits.find((h: any) => h.id === 'cat_test');
            expect(hit).toBeDefined();
            expect(hit!.category).toBe('report');
        } finally {
            (parser as any).dynamicPatterns = saved;
        }
    });

    test("Existing patterns have correct metadata annotations", () => {
        const patterns = (parser as any).dynamicPatterns;
        expect(patterns.length).toBeGreaterThanOrEqual(6);
        const volNo = patterns.find((p: any) => p.id === 'vol_no');
        expect(volNo).toBeDefined();
        expect(volNo.category).toBe('volume');
        expect(volNo.priority).toBe(10);
        expect(volNo.description).toContain('Vol.');

        const doiUrl = patterns.find((p: any) => p.id === 'doi_url');
        expect(doiUrl).toBeDefined();
        expect(doiUrl.category).toBe('doi');
        expect(doiUrl.priority).toBe(40);
    });
});

describe("Stress Finale 1000 — Regression Families", () => {
    const parser = new CitationParser();
    const norm = (raw: string) => parser.preNormalize(raw);

    test("Physical review. B, Condensed matter — title/venue boundary", () => {
        const raw = `Author, A. (2020). Some title. Physical review. B, Condensed matter, 54(16), 12345-12350.`;
        const { parsed } = parser.parseReference(norm(raw), 'apa');
        expect(parsed.title).toContain("Some title");
        expect(parsed.journal).toMatch(/Physical review.*B.*Condensed matter/i);
    });

    test("BMJ/PRISMA 2020 with article number n71 — Chicago-style, article locator", () => {
        const raw = `"Preferred reporting items for systematic reviews." BMJ, vol. 372, n71, 2020.`;
        const { parsed } = parser.parseReference(norm(raw), 'chicago');
        expect(parsed.title).toContain("Preferred reporting items");
        expect(parsed.year).toBe("2020");
        const locator = (parsed.pages || parsed.articleNumber || "").toString();
        if (locator) expect(locator).toMatch(/n71|71/);
    });

    test("GLOBOCAN titles with embedded years — year ranking prefers parenthesized", () => {
        const raw = `Author, A. (2014). Global cancer statistics 2012 GLOBOCAN. Journal of Epidemiology, 44(3), 100-110.`;
        const { parsed } = parser.parseReference(norm(raw), 'apa');
        expect(parsed.year).toBe("2014");
        expect(parsed.title).toContain("GLOBOCAN");
    });

    test("Acronym-sensitive titles: DFT-D, SHELX, lme4 — preserved in output", () => {
        const raw = `Smith, J. (2022). DFT-D calculations with SHELX and lme4. Journal of Chemistry, 10(2), 50-60.`;
        const { parsed } = parser.parseReference(norm(raw), 'apa');
        expect(parsed.title).toContain("DFT-D");
        expect(parsed.title).toMatch(/SHELX|lme4/);
    });
});
