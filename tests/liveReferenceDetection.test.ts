import { describe, expect, it } from "vitest";
import { countEngineLikeInputReferences } from "@shared/liveReferenceDetection";

describe("countEngineLikeInputReferences", () => {
  it("counts blank-line-separated references", () => {
    const input = [
      "Smith, J. A. (2020). The future of testing. Journal of Quality, 10(2), 11-19.",
      "",
      "Page, M. J. (2021). The PRISMA 2020 statement: an updated guideline for reporting systematic reviews. BMJ, 372, n71.",
    ].join("\n");

    expect(countEngineLikeInputReferences(input)).toBe(2);
  });

  it("counts multiline numbered references using engine-like opener rules", () => {
    const input = [
      "1. Smith, J. A. (2020). The future of testing.",
      "Journal of Quality, 10(2), 11-19.",
      "",
      "2. Page, M. J. (2021). The PRISMA 2020 statement: an updated guideline",
      "for reporting systematic reviews. BMJ, 372, n71.",
      "",
      "3. McCoy, L. G., Banja, J. D., Ghassemi, M., & Celi, L. A. (2020).",
      "Ensuring machine learning for healthcare works for all.",
      "BMJ Health & Care Informatics, 27(3), e100237.",
    ].join("\n");

    expect(countEngineLikeInputReferences(input)).toBe(3);
  });

  it("counts DOI lists with the same explicit-schema rule as ingest", () => {
    const input = [
      "10.1136/bmj.n71",
      "10.1136/bmjhci-2020-100237",
      "10.1016/j.jclinepi.2010.03.004",
    ].join("\n");

    expect(countEngineLikeInputReferences(input)).toBe(3);
  });

  it("counts RIS records with the same explicit-schema rule as ingest", () => {
    const input = [
      "TY  - JOUR",
      "TI  - First article",
      "ER  -",
      "",
      "TY  - JOUR",
      "TI  - Second article",
      "ER  -",
    ].join("\n");

    expect(countEngineLikeInputReferences(input)).toBe(2);
  });
});
