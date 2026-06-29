import { describe, expect, it } from "vitest";
import { generateCanonicalIdentity } from "../../../../src/engine/ingestion/canonical.js";

describe("canonical identity generation", () => {
  it("autogenerates DOI-first identity and duplicate hints during normalization", () => {
    const identity = generateCanonicalIdentity({
      rawText:
        "Shannon, C. E. (1948). A mathematical theory of communication. doi:10.1002/j.1538-7305.1948.tb01338.x",
      doi: "https://doi.org/10.1002/J.1538-7305.1948.TB01338.X",
      title: "A Mathematical Theory of Communication",
      year: "1948",
      firstAuthorFamily: "Shannon",
      provenance: "Crossref Import",
    });

    expect(identity.canonicalWorkKey).toBe(
      "doi:10.1002/j.1538-7305.1948.tb01338.x",
    );
    expect(identity.normalizedDoi).toBe("10.1002/j.1538-7305.1948.tb01338.x");
    expect(identity.normalizedTitleHash).toHaveLength(24);
    expect(identity.normalizedHash).toHaveLength(64);
    expect(identity.sourceProvenance).toBe("crossref_import");
    expect(identity.duplicateHints).toEqual(["doi", "raw_text"]);
  });

  it("falls back to a title-author-year work key when no DOI is available", () => {
    const first = generateCanonicalIdentity({
      title: "Citation Engines in Practice",
      year: 2026,
      firstAuthorFamily: "Nguyen",
      provenance: "OpenAlex",
    });
    const second = generateCanonicalIdentity({
      title: "Citation engines in practice",
      year: "2026",
      firstAuthorFamily: "Nguyen",
      provenance: "openalex",
    });

    expect(first.canonicalWorkKey).toMatch(/^work:/);
    expect(first.canonicalWorkKey).toBe(second.canonicalWorkKey);
    expect(first.duplicateHints).toEqual(["title_author_year"]);
  });

  it("uses DOI identity when the DOI appears only as a URL", () => {
    const identity = generateCanonicalIdentity({
      url: "https://doi.org/10.5555/example",
      title: "The DOI URL Case",
      year: 2026,
      firstAuthorFamily: "Rivera",
    });

    expect(identity.normalizedDoi).toBe("10.5555/example");
    expect(identity.normalizedUrl).toBe("https://doi.org/10.5555/example");
    expect(identity.canonicalWorkKey).toBe("doi:10.5555/example");
    expect(identity.duplicateHints).toEqual(["doi", "url"]);
  });
});
