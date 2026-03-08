/**
 * Integration test: 25-citation batch covering all 6 reported bugs.
 * Validates numbering stripping, Vol/No normalization, eLocator mapping,
 * hyphenated-initials parsing, book/chapter extraction, and style-detect failures.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { CitationParser } from '../server/services/citationParser';
import { parsedReferenceToCSL, formatCSLData, initCSLStyles } from '../server/services/cslConverter';
import { fixFormatting, runAssertions } from '../server/services/strictRenderer';

const parser = new CitationParser();

beforeAll(() => {
    initCSLStyles();
});

/** Helper: parse → CSL → APA-render → return { parsed, output } */
function convertToAPA(raw: string) {
    const normalized = parser.preNormalize(raw);
    const detectedStyle = parser.detectStyle(normalized);
    const { parsed } = parser.parseReference(normalized, detectedStyle);
    const referenceType = parser.determineReferenceType(parsed);
    const cslData = parsedReferenceToCSL(parsed, referenceType, 'test-ref');
    const rawOutput = formatCSLData(cslData, 'apa', { includeDoi: false });
    const output = fixFormatting('apa', rawOutput, parsed);
    return { parsed, output, referenceType, detectedStyle };
}

const CITATIONS = [
    { id: 1, text: `Smith, J. A., & Jones, B. C. (2021). Machine learning in healthcare. Journal of Medical Informatics, 45(3), 123–145.` },
    { id: 2, text: `2) J. A. Smith and B. C. Jones, "Machine learning in healthcare," J. Med. Inform., vol. 45, no. 3, pp. 123–145, 2021.` },
    { id: 3, text: `3 - Smith JA, Jones BC. Machine learning in healthcare. J Med Inform. 2021;45(3):123-45.` },
    { id: 4, text: `4. Smith, J.A. and Jones, B.C., 2021. Machine learning in healthcare. Journal of Medical Informatics, 45(3), pp.123-145.` },
    { id: 5, text: `5. Smith, J., & Jones, B. (2021). Machine learning in healthcare. J Med Inform, 45(3), 123–145.` },
    { id: 6, text: `6. Taylor, P. (2023). Cardiac outcomes study. JAMA, 329(2), 145–167.` },
    { id: 7, text: `7. Evans L. Cancer immunotherapy review. Lancet Oncol. 2021;22(8):1123-1135.` },
    { id: 8, text: `8. Martin K. Drug safety profiles in elderly patients. J Clin Pharmacol. 2021;61 Suppl 2:S45-S67.` },
    { id: 9, text: `9. Walker B. Protein folding mechanisms. Biochemistry. 2021;Vol. 60, No. 12:1456-78.` },
    { id: 10, text: `10. Hall, S. (2022). Quantum computing advances. Phys Rev Lett. 128(4):040501.` },
    { id: 11, text: `11. Ahmed R. Cardiology supplement findings. Eur Heart J. 2021;42 Suppl 1:S89-S102.` },
    { id: 12, text: `12. van der Berg W, de Vries L. Infectious disease modelling. J Infect Dis. 2020;222(5):789-801.` },
    { id: 13, text: `13. d'Angelo F, O'Sullivan K. Spinal rehabilitation outcomes. Eur Spine J. 2021;30(7):1923-34.` },
    { id: 14, text: `14. García-López J.-F., Martínez B.-C. Hyphenated name parsing test. J Clin Med. 2022;11(4):1023-1045.` },
    { id: 15, text: `15. Müller H, Björk A, Ó'Brien C. Neurodegenerative disorder progression. Eur J Neurol. 2021;28(4):1234-1245.` },
    { id: 16, text: `16. Chen X, Liu Y, Zhang W, Wang H, Li J, Zhao K, et al. CRISPR gene editing outcomes. Nature. 2023;615(7953):456-478.` },
    { id: 17, text: `17. Rodriguez A, Martinez B, Garcia C, Lopez D, Hernandez E, Gonzalez F, Perez G. Cardiovascular risk factors. Circulation. 2022;145(3):234-256.` },
    { id: 18, text: `18. Brown et al, Neural networks, 2020, pp45-67` },
    { id: 19, text: `19. Johnson. Deep learning. IEEE. 2019.` },
    { id: 20, text: `20. Robinson A. Computational biology methods. New York, NY: Springer; 2021.` },
    { id: 21, text: `21. White, P. (2020). Organic chemistry handbook. London, UK: Oxford University Press; 2020. p. 45-67.` },
    { id: 22, text: `22. Wilson, K. (2021). Protein structure analysis. In: Thompson R, editor. Molecular Biology. 3rd ed. New York, NY: Elsevier; 2021. p. 234-256.` },
    { id: 23, text: `23. Patel R. Blockchain security frameworks. Proc ACM Conf Comput Commun Secur. 2021;14:456-478.` },
    { id: 24, text: `24. J. Patel, "Blockchain security frameworks," in Proc. ACM Conf. Comput. Commun. Secur., vol. 14, pp. 456–478, 2021.` },
    { id: 25, text: `25. (2020). Climate modelling projections. Nat Geosci, 15(6), 478–490.` },
];


describe('25-Citation Batch Integration Tests', () => {

    // ===== BUG 1: No digit prefixes in authors =====
    describe('Bug 1: No numbering in authors', () => {
        for (const cit of CITATIONS) {
            it(`Ref ${cit.id}: authors have no digit prefixes`, () => {
                const { parsed } = convertToAPA(cit.text);
                if (parsed.authors) {
                    for (const author of parsed.authors) {
                        // No leading digits like "2)", "3 -", "24."
                        expect(author).not.toMatch(/^\s*\d+\s*[.):\-]/);
                        // No embedded numbering like "Smith, 2) J."
                        expect(author).not.toMatch(/,\s*\d+[.)]/);
                    }
                }
            });
        }
    });

    // ===== BUG 2: Vol/No normalization (Walker) =====
    describe('Bug 2: Vol/No normalization', () => {
        it('Ref 9 (Walker): volume=60, issue=12, pages extracted', () => {
            const { parsed } = convertToAPA(CITATIONS[8].text);
            expect(parsed.volume).toBe('60');
            expect(parsed.issue).toBe('12');
            expect(parsed.pages).toBeDefined();
            expect(parsed.pages).toMatch(/1456/);
        });

        it('Ref 9 (Walker): parsed data normalized (no raw Vol. in fields)', () => {
            const { parsed } = convertToAPA(CITATIONS[8].text);
            // Parsed fields should have clean numeric values, not raw "Vol. 60"
            if (parsed.volume) expect(parsed.volume).not.toMatch(/Vol/i);
            if (parsed.journal) expect(parsed.journal).not.toMatch(/Vol\./i);
        });
    });

    // ===== BUG 3: eLocator renders as "Article" =====
    describe('Bug 3: eLocator mapping', () => {
        it('Ref 10 (Hall): output has article-number or "Article" for eLocator 040501', () => {
            const { parsed, output } = convertToAPA(CITATIONS[9].text);
            // Should detect as article-number
            const hasArticleNum = !!(parsed as any)['article-number'];
            // output should contain "Article" (APA 7th format)
            const hasArticleInOutput = /Article\s+\d+/i.test(output) || /040501/.test(output);
            expect(hasArticleNum || hasArticleInOutput).toBe(true);
        });
    });

    // ===== BUG 4: Hyphenated initials =====
    describe('Bug 4: Hyphenated initials', () => {
        it('Ref 14 (García-López): family names have lowercase runs, initials are given', () => {
            const { parsed } = convertToAPA(CITATIONS[13].text);
            expect(parsed.authors).toBeDefined();
            if (parsed.authors) {
                // None of the authors should be just initials like "J.-F." or "B.-C."
                for (const author of parsed.authors) {
                    // Author should not be a bare initial string
                    if (author.includes(',')) {
                        const family = author.split(',')[0].trim();
                        // Family name must have 2+ consecutive lowercase letters
                        expect(family).toMatch(/[a-z\u00c0-\u024f]{2,}/);
                    }
                }
                // Output should mention García-López as a family name
                const hasGarciaLopez = parsed.authors.some(a => /Garc[ií]a/i.test(a) && /L[oó]pez/i.test(a));
                expect(hasGarciaLopez).toBe(true);
            }
        });
    });

    // ===== BUG 5: Book/chapter extraction =====
    describe('Bug 5: Book/chapter publisher extraction', () => {
        it('Ref 20 (Robinson): publisher = Springer', () => {
            const { parsed } = convertToAPA(CITATIONS[19].text);
            expect(parsed.publisher).toBeDefined();
            expect(parsed.publisher).toContain('Springer');
        });

        it('Ref 20 (Robinson): place of publication includes New York', () => {
            const { parsed } = convertToAPA(CITATIONS[19].text);
            expect(parsed.placeOfPublication).toBeDefined();
            if (parsed.placeOfPublication) {
                expect(parsed.placeOfPublication).toMatch(/New York/i);
            }
        });

        it('Ref 21 (White): publisher = Oxford University Press, has pages', () => {
            const { parsed } = convertToAPA(CITATIONS[20].text);
            expect(parsed.publisher).toBeDefined();
            if (parsed.publisher) {
                expect(parsed.publisher).toContain('Oxford University Press');
            }
            expect(parsed.pages).toBeDefined();
        });

        it('Ref 22 (Wilson chapter): has editor, bookTitle, edition, publisher', () => {
            const { parsed } = convertToAPA(CITATIONS[21].text);
            expect(parsed.editor).toBeDefined();
            if (parsed.editor) {
                expect(parsed.editor).toMatch(/Thompson/);
            }
            expect(parsed.bookTitle).toBeDefined();
            if (parsed.bookTitle) {
                expect(parsed.bookTitle).toMatch(/Molecular Biology/);
            }
            expect(parsed.edition).toBeDefined();
            expect(parsed.publisher).toBeDefined();
            if (parsed.publisher) {
                expect(parsed.publisher).toContain('Elsevier');
            }
        });
    });

    // ===== BUG 6: Style-detect failures still produce output =====
    describe('Bug 6: Style-detect failures produce stubs', () => {
        it('Ref 18 (Brown): produces some output even if style detection failed', () => {
            const { parsed, output } = convertToAPA(CITATIONS[17].text);
            expect(output.length).toBeGreaterThan(10);
            // Should have parsed at least a year
            expect(parsed.year).toBe('2020');
        });

        it('Ref 19 (Johnson): produces some output', () => {
            const { parsed, output } = convertToAPA(CITATIONS[18].text);
            // Ultra-minimal stub — may only produce a few chars
            expect(output.length).toBeGreaterThan(0);
            expect(parsed.year).toBe('2019');
        });
    });

    // ===== General: All refs produce non-empty output =====
    describe('General: all 25 refs produce output', () => {
        for (const cit of CITATIONS) {
            it(`Ref ${cit.id}: produces non-empty output`, () => {
                const { output } = convertToAPA(cit.text);
                // Some ultra-minimal refs (19, 25) produce very short stubs
                expect(output.length).toBeGreaterThan(0);
            });
        }
    });
});
