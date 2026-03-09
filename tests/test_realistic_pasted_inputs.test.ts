import { describe, it, expect, beforeAll } from "vitest";
import { CitationParser } from "../server/services/citationParser";
import { initCSLStyles, parsedReferenceToCSL, formatCSLData } from "../server/services/cslConverter";
import { fixFormatting, runAssertions } from "../server/services/strictRenderer";

const parser = new CitationParser();

beforeAll(() => {
  initCSLStyles();
});

function convertAutoToAPA(raw: string) {
  const normalized = parser.preNormalize(raw);
  const detectedStyle = parser.detectStyle(normalized) || "apa";
  const { parsed } = parser.parseReference(normalized, detectedStyle as any);
  const referenceType = parser.determineReferenceType(parsed);
  const csl = parsedReferenceToCSL(parsed, referenceType, "realistic-ref");
  const rendered = formatCSLData(csl, "apa", { includeDoi: false });
  const output = fixFormatting("apa", rendered, parsed);
  const assertions = runAssertions("apa", output, parsed as any);
  return { detectedStyle, parsed, referenceType, output, assertions };
}

function convertToStyle(raw: string, outputStyle: "apa" | "mla") {
  const normalized = parser.preNormalize(raw);
  const detectedStyle = parser.detectStyle(normalized) || "apa";
  const { parsed } = parser.parseReference(normalized, detectedStyle as any);
  const referenceType = parser.determineReferenceType(parsed);
  const csl = parsedReferenceToCSL(parsed, referenceType, "ref1");
  const rendered = formatCSLData(csl, outputStyle, { includeDoi: false });
  const output = fixFormatting(outputStyle, rendered, parsed);
  const assertions = runAssertions(outputStyle, output, parsed as any);
  return { parsed, output, assertions };
}

describe("Realistic pasted citation regressions", () => {
  it("detects Harvard journal input with year outside parentheses", () => {
    const raw = `Gomes, M.A.S., Kovaleski, J.L., Pagani, R.N. and da Silva, V.L., 2022. Machine learning applied to healthcare: a conceptual review. Journal of Medical Engineering & Technology, 46(7), pp.608-616.`;
    const result = convertAutoToAPA(raw);

    expect(result.detectedStyle).toBe("harvard");
    expect(result.referenceType).toBe("journal");
    expect(result.parsed.year).toBe("2022");
    expect(result.parsed.authors?.[0]).toContain("Gomes");
    expect(result.parsed.journal).toContain("Medical Engineering");
    expect(result.parsed.volume).toBe("46");
    expect(result.parsed.issue).toBe("7");
    expect(result.parsed.pages).toBe("608-616");
    expect(result.output).toContain("Gomes, M. A. S.");
    expect(result.output).toContain("da Silva, V. L.");
    expect(result.output).toContain("608–616");
    expect(result.assertions.warnings).not.toContain("warning:apa:author_particle_handling");
  });

  it("detects Vancouver journal input with embedded publication date", () => {
    const raw = `Gomes MA, Kovaleski JL, Pagani RN, da Silva VL. Machine learning applied to healthcare: a conceptual review. Journal of Medical Engineering & Technology. 2022 Oct 3;46(7):608-16.`;
    const result = convertAutoToAPA(raw);

    expect(result.detectedStyle).toBe("vancouver");
    expect(result.referenceType).toBe("journal");
    expect(result.parsed.year).toBe("2022");
    expect(result.parsed.title).toContain("Machine learning applied to healthcare");
    expect(result.parsed.authors?.[0]).toBe("Gomes MA");
    expect(result.parsed.authors?.[1]).toBe("Kovaleski JL");
    expect(result.parsed.journal).toContain("Medical Engineering");
    expect(result.parsed.volume).toBe("46");
    expect(result.parsed.issue).toBe("7");
    expect(result.parsed.pages).toBe("608-16");
    expect(result.output).toContain("Gomes, M. A.");
    expect(result.output).toContain("Kovaleski, J. L.");
    expect(result.output).toMatch(/608–(?:16|616)/);
    expect(result.output).not.toContain("2022 Oct 3");
    expect(result.output).not.toContain("(2022). (2022)");
    expect(result.assertions.warnings).not.toContain("warning:apa:author_particle_handling");
  });

  it("detects Google-Scholar-style Chicago journal citation", () => {
    const raw = `Gomes, Myller Augusto Santos, João Luiz Kovaleski, Regina Negri Pagani, and Vander Luiz da Silva. "Machine learning applied to healthcare: a conceptual review." Journal of Medical Engineering & Technology 46, no. 7 (2022): 608-616.`;
    const result = convertAutoToAPA(raw);

    expect(result.detectedStyle).toBe("chicago");
    expect(result.referenceType).toBe("journal");
    expect(result.parsed.year).toBe("2022");
    expect(result.parsed.title).toContain("Machine learning applied to healthcare");
    expect(result.parsed.journal).toContain("Medical Engineering");
    expect(result.parsed.volume).toBe("46");
    expect(result.parsed.issue).toBe("7");
    expect(result.parsed.pages).toBe("608-616");
    expect(result.output).toContain("Gomes");
    expect(result.output).toContain("Journal of Medical Engineering & Technology");
    expect(result.output).toContain("608–616");
  });

  it("detects MLA journal input with vol/no/pp instead of misclassifying as IEEE", () => {
    const raw = `Adams, K. L., and R. Chen. "A survey of graph neural networks in medicine." Journal of Medical Informatics, vol. 51, no. 2, 2022, pp. 101-119.`;
    const result = convertAutoToAPA(raw);

    expect(result.detectedStyle).toBe("mla");
    expect(result.referenceType).toBe("journal");
    expect(result.parsed.authors?.[0]).toContain("Adams");
    expect(result.parsed.authors?.[1]).toContain("Chen");
    expect(result.parsed.journal).toContain("Medical Informatics");
    expect(result.parsed.volume).toBe("51");
    expect(result.parsed.issue).toBe("2");
    expect(result.parsed.pages).toBe("101-119");
  });

  it("detects Harvard article-number journal input without parentheses around year", () => {
    const raw = `Hall, S., 2022. Quantum computing advances. Physical Review Letters, 128(4), Article 040501.`;
    const result = convertAutoToAPA(raw);

    expect(result.detectedStyle).toBe("harvard");
    expect(result.referenceType).toBe("journal");
    expect(result.parsed.year).toBe("2022");
    expect(result.parsed.journal).toContain("Physical Review Letters");
    expect(result.parsed.volume).toBe("128");
    expect(result.parsed.issue).toBe("4");
    expect(result.parsed["article-number"] || result.parsed.pages).toContain("040501");
  });

  it("detects Chicago journal input with article number", () => {
    const raw = `Kim, J. "Materials microstructure analysis." Acta Materialia 196 (2020): Article 12345.`;
    const result = convertAutoToAPA(raw);

    expect(result.detectedStyle).toBe("chicago");
    expect(result.referenceType).toBe("journal");
    expect(result.parsed.year).toBe("2020");
    expect(result.parsed.title).toContain("Materials microstructure analysis");
    expect(result.parsed.journal).toContain("Acta Materialia");
    expect(result.parsed.volume).toBe("196");
    expect(result.parsed["article-number"]).toBe("12345");
    expect(result.output).toContain("Article 12345");
  });

  it("detects Chicago conference input without pages", () => {
    const raw = `Vaswani, A., N. Shazeer, N. Parmar, and J. Uszkoreit. "Attention is all you need." In 31st International Conference on Neural Information Processing Systems. IEEE, 2017.`;
    const result = convertAutoToAPA(raw);

    expect(result.detectedStyle).toBe("chicago");
    expect(result.referenceType).toBe("conference");
    expect(result.parsed.year).toBe("2017");
    expect(result.parsed.title).toContain("Attention is all you need");
    expect(result.parsed.conferenceTitle).toContain("Neural Information Processing Systems");
  });

  it("detects Vancouver conference input with particles and multi-word surnames", () => {
    const raw = `Brown LD, Garcia-Lopez JF, van der Berg E. Federated diagnostics for rural clinics. In International Workshop on Digital Health Systems 2021 Sep 10 (pp. 55-63). ACM.`;
    const result = convertAutoToAPA(raw);

    expect(result.detectedStyle).toBe("vancouver");
    expect(result.referenceType).toBe("conference");
    expect(result.parsed.year).toBe("2021");
    expect(result.parsed.title).toContain("Federated diagnostics for rural clinics");
    expect(result.parsed.conferenceTitle).toContain("Digital Health Systems");
    expect(result.parsed.pages).toBe("55-63");
    expect(result.output).toContain("Brown");
    expect(result.output).toContain("Garcia-Lopez");
    expect(result.output).toContain("van der Berg");
  });

  it("converts journal citation to MLA with quoted title, vol., no., pp.", () => {
    const raw = `Adams, K. L., and R. Chen. "A survey of graph neural networks in medicine." Journal of Medical Informatics, vol. 51, no. 2, 2022, pp. 101-119.`;
    const result = convertToStyle(raw, "mla");

    expect(result.output).toMatch(/"[^"]+"/);
    // Accept either verbose (vol., no., pp.) or compact (Vol.Issue (Year): pages)
    const hasVerbose = result.output.includes("vol.") && result.output.includes("no.") && /\bpp\.\s*\d/.test(result.output);
    const hasCompact = /\d+\.\d+(?:[-–]\d+)?\s*\(\d{4}\)\s*:\s*[\d–\-]+/.test(result.output);
    expect(hasVerbose || hasCompact).toBe(true);
    expect(result.output).toMatch(/\.\s*$/);
    expect(result.assertions.assertionSummary.failed).toBe(0);
  });

  it("converts Vancouver to MLA with year in brackets before pages", () => {
    const raw = `Jayatilake SM, Ganegoda GU. Involvement of machine learning tools in healthcare decision making. Journal of healthcare engineering. 2021;2021(1):6679512.`;
    const result = convertToStyle(raw, "mla");

    expect(result.parsed.year).toBe("2021");
    expect(result.parsed.journal).toContain("healthcare engineering");
    expect(result.output).toMatch(/\(\s*2021\s*\)\s*:/);
    expect(result.output).toContain("6679512");
  });

  it("converts Khare MLA-style to correct format: vol (year): articleId, no trailing year", () => {
    const raw = `Khare, Ashish, et al. "Machine learning theory and applications for healthcare." Journal of healthcare engineering 2017 (2017): 5263570.`;
    const result = convertToStyle(raw, "mla");

    expect(result.parsed.year).toBe("2017");
    expect(result.output).toMatch(/\(\s*2017\s*\)\s*:\s*5263570/);
    expect(result.output).not.toMatch(/\s+(?:19|20)\d{2}\.\s*$/);
  });

  it("converts Khare Vancouver to MLA with year in brackets", () => {
    const raw = `Khare A, Jeon M, Sethi IK, Xu B. Machine learning theory and applications for healthcare. Journal of healthcare engineering. 2017 Sep 27;2017:5263570.`;
    const result = convertToStyle(raw, "mla");

    expect(result.parsed.year).toBe("2017");
    expect(result.output).toMatch(/\(\s*2017\s*\)\s*:\s*5263570/);
  });

  it("converts Manogaran to MLA compact format: Vol.IssueRange (Year): pages", () => {
    const raw = `Manogaran, G., and D. Lopez. "A survey of big data architectures and machine learning algorithms in healthcare." International Journal of Biomedical Engineering and Technology, vol. 25, nos. 2–4, 2017, pp. 182–211.`;
    const result = convertToStyle(raw, "mla");

    expect(result.parsed.volume).toBe("25");
    expect(result.parsed.issue).toMatch(/2[-–]?4/);
    expect(result.parsed.pages).toMatch(/182[-–]211/);
    expect(result.output).toMatch(
      /International Journal of Biomedical Engineering and Technology\s+25\.2-4\s+\(2017\):\s*182[-–]211/
    );
  });
});
