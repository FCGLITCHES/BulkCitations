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
  const csl = parsedReferenceToCSL(parsed, referenceType, "shailaja-ref");
  const rendered = formatCSLData(csl, "apa", { includeDoi: false });
  const output = fixFormatting("apa", rendered, parsed);
  const assertions = runAssertions("apa", output, parsed as any);
  return { detectedStyle, parsed, referenceType, output, assertions };
}

describe("Shailaja conference regressions", () => {
  const cases = [
    {
      label: "quoted conference without explicit In",
      input: `Shailaja, K., Banoth Seetharamulu, and M. A. Jabbar. "Machine learning in healthcare: A review." 2018 Second international conference on electronics, communication and aerospace technology (ICECA). IEEE, 2018.`,
      expectPages: false,
      expectedStyle: "mla",
    },
    {
      label: "APA conference with month and pages",
      input: `Shailaja, K., Seetharamulu, B., & Jabbar, M. A. (2018, March). Machine learning in healthcare: A review. In 2018 Second international conference on electronics, communication and aerospace technology (ICECA) (pp. 910-914). IEEE.`,
      expectPages: true,
      expectedStyle: "apa",
    },
    {
      label: "quoted conference with In and pages",
      input: `Shailaja, K., Banoth Seetharamulu, and M. A. Jabbar. "Machine learning in healthcare: A review." In 2018 Second international conference on electronics, communication and aerospace technology (ICECA), pp. 910-914. IEEE, 2018.`,
      expectPages: true,
      expectedStyle: "chicago",
    },
    {
      label: "Harvard-like conference with month and pages",
      input: `Shailaja, K., Seetharamulu, B. and Jabbar, M.A., 2018, March. Machine learning in healthcare: A review. In 2018 Second international conference on electronics, communication and aerospace technology (ICECA) (pp. 910-914). IEEE.`,
      expectPages: true,
      expectedStyle: "harvard",
    },
    {
      label: "Vancouver conference with embedded date",
      input: `Shailaja K, Seetharamulu B, Jabbar MA. Machine learning in healthcare: A review. In2018 Second international conference on electronics, communication and aerospace technology (ICECA) 2018 Mar 29 (pp. 910-914). IEEE.`,
      expectPages: true,
      expectedStyle: "vancouver",
    },
  ] as const;

  for (const testCase of cases) {
    it(testCase.label, () => {
      const { detectedStyle, parsed, referenceType, output, assertions } = convertAutoToAPA(testCase.input);

      expect(detectedStyle).toBe(testCase.expectedStyle);
      expect(referenceType).toBe("conference");
      expect(parsed.year).toBe("2018");
      expect(parsed.title).toContain("Machine learning in healthcare: A review");
      expect(parsed.conferenceTitle).toContain("electronics, communication and aerospace technology");
      expect(parsed.conferenceTitle).not.toContain("Mar 29");
      expect(output).toContain("Machine learning in healthcare: A review");
      expect(output).toContain("Jabbar, M. A.");
      expect(output).not.toContain("Jabbar MA");
      expect(output).not.toContain("A. review");
      expect(output.match(/\(2018\)/g)?.length ?? 0).toBe(1);

      if (testCase.expectPages) {
        expect(parsed.pages).toBe("910-914");
        expect(output).toContain("910–914");
      } else {
        expect(parsed.pages).toBeUndefined();
      }

      expect(assertions.warnings).not.toContain("warning:missing_locator");
      expect(assertions.warnings).not.toContain("warning:apa:author_particle_handling");
    });
  }
});
