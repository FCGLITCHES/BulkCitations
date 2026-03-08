import { describe, it, expect, beforeAll } from "vitest";
import { CitationParser } from "../server/services/citationParser";
import { initCSLStyles, parsedReferenceToCSL, formatCSLData } from "../server/services/cslConverter";
import { fixFormatting } from "../server/services/strictRenderer";

const parser = new CitationParser();

beforeAll(() => {
  initCSLStyles();
});

function convertAutoToAPA(raw: string) {
  const normalized = parser.preNormalize(raw);
  const detectedStyle = parser.detectStyle(normalized);
  const { parsed } = parser.parseReference(normalized, detectedStyle || "apa");
  const referenceType = parser.determineReferenceType(parsed);
  const csl = parsedReferenceToCSL(parsed, referenceType, "matrix-ref");
  const rendered = formatCSLData(csl, "apa", { includeDoi: false });
  const output = fixFormatting("apa", rendered, parsed);
  return { normalized, detectedStyle, parsed, referenceType, output };
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.toLowerCase().split(needle.toLowerCase()).length - 1;
}

type MatrixCase = {
  label: string;
  input: string;
  expected: {
    detectedStyleIn?: string[];
    referenceType?: string;
    year?: string;
    titleIncludes?: string;
    journalIncludes?: string;
    conferenceIncludes?: string;
    firstAuthorIncludes?: string;
    volume?: string;
    issue?: string;
    pagesIncludes?: string;
    articleNumber?: string;
    outputIncludes?: string;
    outputNotIncludes?: string;
  };
};

const CASES: MatrixCase[] = [
  {
    label: "APA journal baseline",
    input: `Adams, K. L., & Chen, R. (2022). A survey of graph neural networks in medicine. Journal of Medical Informatics, 51(2), 101-119.`,
    expected: {
      detectedStyleIn: ["apa"],
      referenceType: "journal",
      year: "2022",
      firstAuthorIncludes: "Adams",
      journalIncludes: "Medical Informatics",
      volume: "51",
      issue: "2",
      pagesIncludes: "101",
    },
  },
  {
    label: "IEEE journal baseline",
    input: `K. L. Adams and R. Chen, "A survey of graph neural networks in medicine," J. Med. Inform., vol. 51, no. 2, pp. 101-119, 2022.`,
    expected: {
      detectedStyleIn: ["ieee"],
      referenceType: "journal",
      year: "2022",
      firstAuthorIncludes: "Adams",
      volume: "51",
      issue: "2",
      pagesIncludes: "101",
    },
  },
  {
    label: "Vancouver journal baseline",
    input: `Adams KL, Chen R. A survey of graph neural networks in medicine. J Med Inform. 2022;51(2):101-119.`,
    expected: {
      detectedStyleIn: ["vancouver"],
      referenceType: "journal",
      year: "2022",
      firstAuthorIncludes: "Adams",
      volume: "51",
      issue: "2",
      pagesIncludes: "101",
    },
  },
  {
    label: "Harvard journal baseline",
    input: `Adams, K.L. and Chen, R., 2022. A survey of graph neural networks in medicine. Journal of Medical Informatics, 51(2), pp.101-119.`,
    expected: {
      referenceType: "journal",
      year: "2022",
      firstAuthorIncludes: "Adams",
      volume: "51",
      issue: "2",
      pagesIncludes: "101",
    },
  },
  {
    label: "MLA journal baseline",
    input: `Adams, K. L., and Chen, R. "A survey of graph neural networks in medicine." Journal of Medical Informatics, vol. 51, no. 2, 2022, pp. 101-119.`,
    expected: {
      referenceType: "journal",
      year: "2022",
      journalIncludes: "Medical Informatics",
      volume: "51",
      issue: "2",
      pagesIncludes: "101",
    },
  },
  {
    label: "Chicago journal baseline",
    input: `Adams, K. L., and R. Chen. "A survey of graph neural networks in medicine." Journal of Medical Informatics 51, no. 2 (2022): 101-119.`,
    expected: {
      detectedStyleIn: ["chicago"],
      referenceType: "journal",
      year: "2022",
      journalIncludes: "Medical Informatics",
      volume: "51",
      issue: "2",
      pagesIncludes: "101",
    },
  },
  {
    label: "IEEE proceedings (Vaswani) conference extraction",
    input: `A. Vaswani, N. Shazeer, N. Parmar, J. Uszkoreit, L. Jones, A. N. Gomez, L. Kaiser, and I. Polosukhin, "Attention is All You Need," in Proc. 31st International Conference on Neural Information Processing Systems, 2017.`,
    expected: {
      detectedStyleIn: ["ieee"],
      referenceType: "conference",
      year: "2017",
      conferenceIncludes: "Neural Information Processing Systems",
      firstAuthorIncludes: "Vaswani",
      outputIncludes: "Proceedings of the 31st International Conference on Neural Information Processing Systems",
    },
  },
  {
    label: "APA conference container becomes conference type",
    input: `He, K., Zhang, X., Ren, S., & Sun, J. (2016). Deep residual learning for image recognition. In 2016 IEEE Conference on Computer Vision and Pattern Recognition (CVPR).`,
    expected: {
      referenceType: "conference",
      year: "2016",
      conferenceIncludes: "Computer Vision and Pattern Recognition",
      firstAuthorIncludes: "He",
      outputNotIncludes: "In In ",
    },
  },
  {
    label: "IEEE proceedings (He) conference extraction",
    input: `K. He, X. Zhang, S. Ren, and J. Sun, "Deep residual learning for image recognition," in Proc. IEEE Conference on Computer Vision and Pattern Recognition (CVPR), 2016.`,
    expected: {
      detectedStyleIn: ["ieee"],
      referenceType: "conference",
      year: "2016",
      conferenceIncludes: "Computer Vision and Pattern Recognition",
      firstAuthorIncludes: "He",
    },
  },
  {
    label: "PRL eLocator from compact volume(issue):locator",
    input: `Hall, S. (2022). Quantum computing advances. Phys Rev Lett. 128(4):040501.`,
    expected: {
      referenceType: "journal",
      year: "2022",
      volume: "128",
      issue: "4",
      articleNumber: "040501",
      outputIncludes: "Article 040501",
    },
  },
  {
    label: "IEEE Art. no. preserved",
    input: `N. Farah and A. Gupta, "Quantum dots in bioimaging: Recent advances," Nano Med., vol. 15, no. 6, Art. no. 104512, 2020.`,
    expected: {
      detectedStyleIn: ["ieee"],
      referenceType: "journal",
      year: "2020",
      volume: "15",
      issue: "6",
      articleNumber: "104512",
      outputIncludes: "Article 104512",
    },
  },
  {
    label: "Vancouver compact locator becomes article number",
    input: `Kim J. Materials microstructure analysis. Acta Mater. 2020;196:12345.`,
    expected: {
      detectedStyleIn: ["vancouver"],
      referenceType: "journal",
      year: "2020",
      volume: "196",
      articleNumber: "12345",
      outputIncludes: "Article 12345",
    },
  },
  {
    label: "Supplement + S-pages extraction",
    input: `Martin K. Drug safety profiles in elderly patients. J Clin Pharmacol. 2021;61 Suppl 2:S45-S67.`,
    expected: {
      detectedStyleIn: ["vancouver"],
      referenceType: "journal",
      year: "2021",
      volume: "61",
      issue: "Suppl. 2",
      pagesIncludes: "S45",
    },
  },
  {
    label: "Vol/No compact normalization",
    input: `Walker B. Protein mechanisms. Biochemistry. 2021;Vol. 60, No. 12:1456-78.`,
    expected: {
      detectedStyleIn: ["vancouver"],
      referenceType: "journal",
      year: "2021",
      volume: "60",
      issue: "12",
      pagesIncludes: "1456",
      outputNotIncludes: "Vol. 60",
    },
  },
  {
    label: "Hyphenated initials stay attached to surnames",
    input: `J.-F. García-López and B.-C. Martínez, "Name parsing in multilingual bibliographies," J. Clin. Med., vol. 11, no. 4, pp. 1023-1045, 2022.`,
    expected: {
      detectedStyleIn: ["ieee"],
      referenceType: "journal",
      year: "2022",
      firstAuthorIncludes: "García-López",
      outputIncludes: "García-López",
    },
  },
  {
    label: "Particles and apostrophes survive",
    input: `K. O'Sullivan and F. d'Angelo, "Spinal rehabilitation outcomes," Eur. Spine J., vol. 30, no. 7, pp. 1923-1934, 2021.`,
    expected: {
      detectedStyleIn: ["ieee"],
      referenceType: "journal",
      year: "2021",
      outputIncludes: "O'Sullivan",
    },
  },
  {
    label: "Book chapter In: editor path",
    input: `Wilson, K. (2021). Protein structure analysis. In: Thompson R, editor. Molecular Biology. 3rd ed. New York, NY: Elsevier; 2021. p. 234-256.`,
    expected: {
      referenceType: "bookChapter",
      year: "2021",
      pagesIncludes: "234",
      outputIncludes: "Molecular Biology",
    },
  },
  {
    label: "Book publisher-location extraction",
    input: `Robinson A. Computational biology methods. New York, NY: Springer; 2021.`,
    expected: {
      referenceType: "book",
      year: "2021",
      outputIncludes: "Springer",
      outputNotIncludes: "New York, NY:",
    },
  },
];

describe("Format-to-APA matrix verification", () => {
  for (const c of CASES) {
    it(c.label, () => {
      const { detectedStyle, parsed, referenceType, output } = convertAutoToAPA(c.input);

      if (c.expected.detectedStyleIn) {
        expect(c.expected.detectedStyleIn).toContain((detectedStyle || "").toLowerCase());
      }
      if (c.expected.referenceType) expect(referenceType).toBe(c.expected.referenceType);
      if (c.expected.year) expect(parsed.year).toBe(c.expected.year);
      if (c.expected.titleIncludes) expect(parsed.title || "").toContain(c.expected.titleIncludes);
      if (c.expected.journalIncludes) expect(parsed.journal || "").toContain(c.expected.journalIncludes);
      if (c.expected.conferenceIncludes) expect(parsed.conferenceTitle || "").toContain(c.expected.conferenceIncludes);
      if (c.expected.firstAuthorIncludes) expect(parsed.authors?.[0] || "").toContain(c.expected.firstAuthorIncludes);
      if (c.expected.volume) expect(parsed.volume).toBe(c.expected.volume);
      if (c.expected.issue) expect(parsed.issue).toBe(c.expected.issue);
      if (c.expected.pagesIncludes) expect(parsed.pages || "").toContain(c.expected.pagesIncludes);
      if (c.expected.articleNumber) expect((parsed as any)["article-number"]).toBe(c.expected.articleNumber);
      if (c.expected.outputIncludes) {
        const normOut = output.replace(/\u2019/g, "'");
        const normExpected = c.expected.outputIncludes.replace(/\u2019/g, "'");
        expect(normOut).toContain(normExpected);
      }
      if (c.expected.outputNotIncludes) expect(output).not.toContain(c.expected.outputNotIncludes);

      // universal sanity checks
      if (parsed.authors) {
        for (const a of parsed.authors) {
          expect(a).not.toMatch(/^\s*[\[(]?\d+[\])]?\s*[.):\-]/);
          expect(a).not.toMatch(/,\s*\d+[.)]/);
          expect(a).not.toMatch(/\[\d+\]/);
        }
      }
      // guard against duplicate conference title rendering
      if (parsed.conferenceTitle) {
        expect(countOccurrences(output, parsed.conferenceTitle)).toBeLessThanOrEqual(1);
      }
    });
  }
});

