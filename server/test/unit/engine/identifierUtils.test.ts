import { describe, expect, it } from "vitest";

import {
  normalizeArxiv,
  normalizeDoi,
  normalizeHandle,
  normalizeIsbn,
  normalizeIssn,
  normalizePatent,
  normalizePmid,
} from "../../../src/engine/identifierUtils.js";

describe("identifierUtils", () => {
  it("normalizes supported identifier fields", () => {
    expect(normalizeDoi("https://doi.org/10.1000/xyz123")).toBe("10.1000/xyz123");
    expect(normalizePmid("PMID: 12345678")).toBe("12345678");
    expect(normalizeArxiv("10.48550/arXiv.1706.03762")).toBe("1706.03762");
    expect(normalizeArxiv("https://arxiv.org/abs/1706.03762")).toBe("1706.03762");
    expect(normalizeHandle("https://hdl.handle.net/10871/12345")).toBe("10871/12345");
  });

  it("does not infer arxiv identifiers from unrelated DOIs", () => {
    expect(normalizeArxiv("10.37702/2175-957x.cobenge.2023.4540")).toBeNull();
    expect(normalizeArxiv("10.1049/cp.2016.1556")).toBeNull();
  });

  it("validates isbn and issn checksums", () => {
    expect(normalizeIsbn("978-0-262-03384-8")).toBe("9780262033848");
    expect(normalizeIssn("2049-3630")).toBe("20493630");
  });

  it("does not treat bare years as patents", () => {
    expect(normalizePatent("2015")).toBeNull();
    expect(normalizePatent("2024")).toBeNull();
  });

  it("accepts patent identifiers when explicit patent context exists", () => {
    expect(normalizePatent("Patent 6285999")).toBe("6285999");
    expect(normalizePatent("US6285999B1")).toBe("US6285999B1");
    expect(normalizePatent("https://patents.google.com/patent/US20060235842A1/en")).toBe("US20060235842A1");
  });
});
