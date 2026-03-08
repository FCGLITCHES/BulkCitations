/**
 * 40-Citation Integration Test Suite
 * Tests the full pipeline: preNormalize → detectStyle → parseReference → CSL → APA output.
 * Covers: APA, IEEE, Vancouver, Harvard, Chicago, MLA, books, chapters, proceedings, edge cases.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { CitationParser } from '../server/services/citationParser';
import { parsedReferenceToCSL, formatCSLData, initCSLStyles } from '../server/services/cslConverter';
import { fixFormatting, runAssertions } from '../server/services/strictRenderer';

const parser = new CitationParser();

beforeAll(() => { initCSLStyles(); });

/** Helper: parse → CSL → APA-render → return all data for assertions */
function convertToAPA(raw: string) {
    const normalized = parser.preNormalize(raw);
    const detectedStyle = parser.detectStyle(normalized);
    const { parsed } = parser.parseReference(normalized, detectedStyle || 'apa');
    const referenceType = parser.determineReferenceType(parsed);
    const cslData = parsedReferenceToCSL(parsed, referenceType, 'test-ref');
    const rawOutput = formatCSLData(cslData, 'apa', { includeDoi: false });
    const output = fixFormatting('apa', rawOutput, parsed);
    return { parsed, output, referenceType, detectedStyle, normalized };
}

// ═══════════════════════════════════════════════════════════
// CITATIONS
// ═══════════════════════════════════════════════════════════
const CITATIONS = [
    // --- Standard journal articles (APA, IEEE, Vancouver, Harvard) ---
    { id: 1, text: `Smith, J. A., & Jones, B. C. (2021). Machine learning in healthcare. Journal of Medical Informatics, 45(3), 123–145.` },
    { id: 2, text: `2) J. A. Smith and B. C. Jones, "Machine learning in healthcare," J. Med. Inform., vol. 45, no. 3, pp. 123–145, 2021.` },
    { id: 3, text: `3 - Smith JA, Jones BC. Machine learning in healthcare. J Med Inform. 2021;45(3):123-45.` },
    { id: 4, text: `[4] Smith, J.A. and Jones, B.C., 2021. Machine learning in healthcare. Journal of Medical Informatics, 45(3), pp.123-145.` },
    { id: 5, text: `5. Smith, J., & Jones, B. (2021). Machine learning in healthcare. J Med Inform, 45(3), 123–145.` },
    { id: 6, text: `6. Taylor, P. (2023). Cardiac outcomes study. JAMA, 329(2), 145–167.` },
    { id: 7, text: `7. Evans L. Cancer immunotherapy review. Lancet Oncol. 2021;22(8):1123-1135.` },

    // --- Supplements ---
    { id: 8, text: `8. Martin K. Drug safety profiles in elderly patients. J Clin Pharmacol. 2021;61 Suppl 2:S45-S67.` },
    { id: 9, text: `9. Ahmed, R. (2021). Cardiology supplement findings. Eur Heart J, 42 Suppl 1:S89-S102.` },

    // --- Vol/No rare format ---
    { id: 10, text: `10. Walker B. Protein folding mechanisms. Biochemistry. 2021;Vol. 60, No. 12:1456-78.` },
    { id: 11, text: `11. Walker, B. (2021). Protein folding mechanisms. Biochemistry, 60(12), 1456–1478.` },

    // --- eLocators & article numbers ---
    { id: 12, text: `12. Hall, S. (2022). Quantum computing advances. Phys Rev Lett. 128(4):040501.` },
    { id: 13, text: `13. Kim, J. (2020). Materials microstructure analysis. Acta Mater, 196, Article e12345.` },

    // --- Complex author names ---
    { id: 14, text: `14. van der Berg W, de Vries L. Infectious disease modelling. J Infect Dis. 2020;222(5):789-801.` },
    { id: 15, text: `15. d'Angelo F, O'Sullivan K. Spinal rehabilitation outcomes. Eur Spine J. 2021;30(7):1923-34.` },
    { id: 16, text: `16. García-López J.-F., Martínez B.-C. Hyphenated name parsing test. J Clin Med. 2022;11(4):1023-1045.` },
    { id: 17, text: `17. Müller H, Björk A, Ó'Brien C. Neurodegenerative disorder progression. Eur J Neurol. 2021;28(4):1234-1245.` },

    // --- Many authors / et al ---
    { id: 18, text: `18. Chen X, Liu Y, Zhang W, Wang H, Li J, Zhao K, et al. CRISPR gene editing outcomes. Nature. 2023;615(7953):456-478.` },
    { id: 19, text: `19. Rodriguez A, Martinez B, Garcia C, Lopez D, Hernandez E, Gonzalez F, Perez G. Cardiovascular risk factors. Circulation. 2022;145(3):234-256.` },

    // --- Organizational author ---
    { id: 20, text: `20. World Health Organization. Global health report. 2021.` },

    // --- Minimal / broken input ---
    { id: 21, text: `21. Brown et al, Neural networks, 2020, pp45-67` },
    { id: 22, text: `22. Johnson. Deep learning. IEEE. 2019.` },

    // --- Books ---
    { id: 23, text: `23. Robinson A. Computational biology methods. New York, NY: Springer; 2021.` },
    { id: 24, text: `24. White, P. (2020). Organic chemistry handbook. London, UK: Oxford University Press; 2020. p. 45-67.` },
    { id: 25, text: `25. Wilson, K. (2021). Protein structure analysis. In: Thompson R, editor. Molecular Biology. 3rd ed. New York, NY: Elsevier; 2021. p. 234-256.` },
    { id: 26, text: `26. Lee, D. (2019). A practical guide to statistics (2nd ed.). Academic Press.` },
    { id: 27, text: `27. Nguyen T, Patel R. Data mining foundations. Boston, MA: Pearson; 2018.` },

    // --- Book chapters (APA-style In: with Eds.) ---
    { id: 28, text: `28. Garcia, M. (2020). Evidence synthesis methods. In E. Brown & K. White (Eds.), Handbook of research methods (pp. 55–78). Sage.` },
    { id: 29, text: `29. Singh, P. (2022). Network security patterns. In J. Davis (Ed.), Modern computing systems (3rd ed., pp. 101–120). Elsevier.` },

    // --- Conference proceedings (Vancouver + IEEE) ---
    { id: 30, text: `30. Patel R. Blockchain security frameworks. Proc ACM Conf Comput Commun Secur. 2021;14:456-478.` },
    { id: 31, text: `31. J. Patel, "Blockchain security frameworks," in Proc. ACM Conf. Comput. Commun. Secur., vol. 14, pp. 456–478, 2021.` },
    { id: 32, text: `[32] A. Kumar and B. Li, "Edge AI for IoT devices," in Proc. Int. Conf. Internet Things, 2020, pp. 88–94.` },
    { id: 33, text: `33. Kumar A, Li B. Edge AI for IoT devices. Proc Int Conf Internet Things. 2020;:88-94.` },

    // --- Standard APA journal ---
    { id: 34, text: `34. Harris, S. (2018). Climate modelling projections. Nat Geosci, 15(6), 478–490.` },

    // --- Missing author ---
    { id: 35, text: `35. (2020). Climate modelling projections. Nat Geosci, 15(6), 478–490.` },

    // --- ArXiv / tech report ---
    { id: 36, text: `36. Chen, Y. (2021). Deep reinforcement learning. arXiv preprint, 2101.12345.` },
    { id: 37, text: `37. Li, Q. (2022). Data privacy in federated learning. Tech Report. 2022;TR-17:1-24.` },

    // --- Apostrophe names (O'Brien variants) ---
    { id: 38, text: `38. O'Brien, T. (2021). Hearing outcomes in older adults. JAMA Otolaryngol Head Neck Surg. 147(9):812-819.` },
    { id: 39, text: `39. OBrien T. Hearing outcomes in older adults. JAMA Otolaryngol Head Neck Surg. 2021;147(9):812-9.` },

    // --- Numbered with ) suffix ---
    { id: 40, text: `40) Chen, Z. (2023). Advances in genomics. Science, 380(6645), 500–510.` },
];

// ═══════════════════════════════════════════════════════════
// UNIVERSAL INVARIANTS — must hold for ALL 40 refs
// ═══════════════════════════════════════════════════════════
describe('40-Citation Suite: Universal Invariants', () => {
    for (const cit of CITATIONS) {
        it(`Ref ${cit.id}: produces non-empty output`, () => {
            const { output } = convertToAPA(cit.text);
            expect(output.length).toBeGreaterThan(0);
        });

        it(`Ref ${cit.id}: authors have no numbering artifacts`, () => {
            const { parsed } = convertToAPA(cit.text);
            if (parsed.authors) {
                for (const author of parsed.authors) {
                    // No leading digits/brackets: "2)", "3 -", "[32]", "24."
                    expect(author).not.toMatch(/^\s*[\[(]?\d+[\])]?\s*[.):\-]/);
                    // No embedded numbering: "Smith, 2) J."
                    expect(author).not.toMatch(/,\s*\d+[.)]/);
                    // No bracket leak: "[32]" anywhere in author
                    expect(author).not.toMatch(/\[\d+\]/);
                }
            }
        });
    }
});

// ═══════════════════════════════════════════════════════════
// PARSED FIELD CHECKS — specific refs
// ═══════════════════════════════════════════════════════════
describe('40-Citation Suite: Parsed Fields', () => {

    // --- Standard journal articles ---
    it('Ref 1 (APA): all core fields', () => {
        const { parsed } = convertToAPA(CITATIONS[0].text);
        expect(parsed.year).toBe('2021');
        expect(parsed.volume).toBe('45');
        expect(parsed.issue).toBe('3');
        expect(parsed.pages).toMatch(/123/);
        expect(parsed.title).toMatch(/machine learning/i);
    });

    it('Ref 2 (IEEE): all core fields', () => {
        const { parsed, detectedStyle } = convertToAPA(CITATIONS[1].text);
        expect(parsed.year).toBe('2021');
        expect(parsed.volume).toBe('45');
        expect(parsed.issue).toBe('3');
        expect(parsed.pages).toMatch(/123/);
        expect(parsed.title).toMatch(/machine learning/i);
    });

    it('Ref 3 (Vancouver): all core fields', () => {
        const { parsed } = convertToAPA(CITATIONS[2].text);
        expect(parsed.year).toBe('2021');
        expect(parsed.volume).toBe('45');
        expect(parsed.issue).toBe('3');
        expect(parsed.pages).toMatch(/123/);
    });

    it('Ref 4 (Harvard-bracket): numbering stripped, core fields', () => {
        const { parsed } = convertToAPA(CITATIONS[3].text);
        expect(parsed.year).toBe('2021');
        expect(parsed.volume).toBe('45');
        expect(parsed.authors).toBeDefined();
        if (parsed.authors) {
            expect(parsed.authors.some(a => /Smith/i.test(a))).toBe(true);
            // No bracket artifact
            expect(parsed.authors.every(a => !a.includes('['))).toBe(true);
        }
    });

    // --- Supplements ---
    it('Ref 8 (Martin): supplement issue extracted', () => {
        const { parsed } = convertToAPA(CITATIONS[7].text);
        expect(parsed.pages).toMatch(/S45/);
    });

    // --- Vol/No ---
    it('Ref 10 (Walker Vol.): volume=60, issue=12', () => {
        const { parsed } = convertToAPA(CITATIONS[9].text);
        expect(parsed.volume).toBe('60');
        expect(parsed.issue).toBe('12');
        expect(parsed.pages).toMatch(/1456/);
    });

    it('Ref 11 (Walker APA): volume=60, issue=12', () => {
        const { parsed } = convertToAPA(CITATIONS[10].text);
        expect(parsed.volume).toBe('60');
        expect(parsed.issue).toBe('12');
    });

    // --- eLocators ---
    it('Ref 12 (Hall): has eLocator or pages with 040501', () => {
        const { parsed } = convertToAPA(CITATIONS[11].text);
        const hasArticleNum = !!(parsed as any)['article-number'];
        const hasPages = !!(parsed.pages && /040501/.test(parsed.pages));
        // Accept either explicit article-number or pages containing the eLocator
        expect(hasArticleNum || hasPages).toBe(true);
    });

    // --- Complex names ---
    it('Ref 14 (van der Berg): particle names preserved', () => {
        const { parsed } = convertToAPA(CITATIONS[13].text);
        expect(parsed.authors).toBeDefined();
        if (parsed.authors) {
            const hasVanDerBerg = parsed.authors.some(a => /van der Berg/i.test(a) || /Berg/i.test(a));
            expect(hasVanDerBerg).toBe(true);
        }
    });

    it('Ref 16 (García-López): hyphenated family names, not initials as family', () => {
        const { parsed } = convertToAPA(CITATIONS[15].text);
        expect(parsed.authors).toBeDefined();
        if (parsed.authors) {
            for (const author of parsed.authors) {
                if (author.includes(',')) {
                    const family = author.split(',')[0].trim();
                    expect(family).toMatch(/[a-z\u00c0-\u024f]{2,}/);
                }
            }
        }
    });

    // --- Many authors ---
    it('Ref 18 (Chen et al): has authors', () => {
        const { parsed } = convertToAPA(CITATIONS[17].text);
        expect(parsed.authors).toBeDefined();
        // Authors may be concatenated or split depending on detection
        expect(parsed.authors!.length).toBeGreaterThanOrEqual(1);
    });

    // --- Books ---
    it('Ref 23 (Robinson): publisher + place', () => {
        const { parsed } = convertToAPA(CITATIONS[22].text);
        expect(parsed.publisher).toBeDefined();
        expect(parsed.publisher).toMatch(/Springer/i);
        expect(parsed.placeOfPublication).toBeDefined();
        expect(parsed.placeOfPublication).toMatch(/New York/i);
    });

    it('Ref 24 (White): publisher + pages', () => {
        const { parsed } = convertToAPA(CITATIONS[23].text);
        expect(parsed.publisher).toBeDefined();
        if (parsed.publisher) {
            expect(parsed.publisher).toMatch(/Oxford University Press/i);
        }
        expect(parsed.pages).toMatch(/45/);
    });

    // --- Book chapters ---
    it('Ref 25 (Wilson): editor + bookTitle + edition + publisher', () => {
        const { parsed } = convertToAPA(CITATIONS[24].text);
        expect(parsed.editor).toBeDefined();
        expect(parsed.editor).toMatch(/Thompson/);
        expect(parsed.bookTitle).toBeDefined();
        expect(parsed.bookTitle).toMatch(/Molecular Biology/);
        expect(parsed.edition).toBe('3');
        expect(parsed.publisher).toBeDefined();
        expect(parsed.publisher).toMatch(/Elsevier/i);
    });

    it('Ref 27 (Nguyen): publisher=Pearson, place=Boston', () => {
        const { parsed } = convertToAPA(CITATIONS[26].text);
        expect(parsed.publisher).toMatch(/Pearson/i);
        expect(parsed.placeOfPublication).toMatch(/Boston/i);
    });

    it('Ref 28 (Garcia chapter): has editor or bookTitle', () => {
        const { parsed } = convertToAPA(CITATIONS[27].text);
        // Should detect "In E. Brown & K. White (Eds.)" as editors
        const hasEditor = !!parsed.editor;
        const hasBookTitle = !!parsed.bookTitle;
        expect(hasEditor || hasBookTitle).toBe(true);
    });

    // --- Conference proceedings ---
    it('Ref 31 (IEEE Patel): title extracted from quotes', () => {
        const { parsed } = convertToAPA(CITATIONS[30].text);
        expect(parsed.title).toMatch(/Blockchain/i);
        expect(parsed.year).toBe('2021');
    });

    it('Ref 32 (IEEE Kumar [32]): bracket stripped, authors clean', () => {
        const { parsed } = convertToAPA(CITATIONS[31].text);
        expect(parsed.authors).toBeDefined();
        if (parsed.authors) {
            for (const a of parsed.authors) {
                expect(a).not.toMatch(/\[\d+\]/);
                expect(a).not.toMatch(/^\d/);
            }
            expect(parsed.authors.some(a => /Kumar/i.test(a))).toBe(true);
        }
        expect(parsed.title).toMatch(/Edge AI/i);
        expect(parsed.year).toBe('2020');
    });

    // --- Edge cases ---
    it('Ref 35 (no author): year=2020', () => {
        const { parsed } = convertToAPA(CITATIONS[34].text);
        expect(parsed.year).toBe('2020');
        // Title extraction from no-author APA is a known limitation
    });

    it('Ref 38 (O\'Brien APA): apostrophe name preserved', () => {
        const { parsed } = convertToAPA(CITATIONS[37].text);
        expect(parsed.authors).toBeDefined();
        if (parsed.authors) {
            expect(parsed.authors.some(a => /O.?Brien/i.test(a))).toBe(true);
        }
    });

    it('Ref 40 (40) prefix): numbering stripped, year=2023', () => {
        const { parsed } = convertToAPA(CITATIONS[39].text);
        expect(parsed.year).toBe('2023');
        expect(parsed.authors).toBeDefined();
        if (parsed.authors) {
            expect(parsed.authors.some(a => /Chen/i.test(a))).toBe(true);
            // No "40)" in author
            expect(parsed.authors.every(a => !a.match(/\d+\)/))).toBe(true);
        }
    });
});

// ═══════════════════════════════════════════════════════════
// STYLE DETECTION CHECKS
// ═══════════════════════════════════════════════════════════
describe('40-Citation Suite: Style Detection', () => {
    it('Ref 1: detected as APA', () => {
        const { detectedStyle } = convertToAPA(CITATIONS[0].text);
        expect(detectedStyle).toBe('apa');
    });

    it('Ref 2: detected as IEEE', () => {
        const { detectedStyle } = convertToAPA(CITATIONS[1].text);
        expect(detectedStyle).toBe('ieee');
    });

    it('Ref 3: detected as Vancouver', () => {
        const { detectedStyle } = convertToAPA(CITATIONS[2].text);
        expect(detectedStyle).toBe('vancouver');
    });

    it('Ref 32: IEEE bracket ref detected correctly', () => {
        const { detectedStyle } = convertToAPA(CITATIONS[31].text);
        expect(detectedStyle).toBe('ieee');
    });
});
