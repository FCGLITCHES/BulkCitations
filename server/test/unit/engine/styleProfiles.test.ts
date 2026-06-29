import { describe, expect, it } from "vitest";
import {
  getStyleProfile,
  STYLE_PROFILES,
} from "../../../src/engine/styleProfiles.js";

describe("style profiles", () => {
  it("uses simple style profiles instead of nested rule-pack contracts", () => {
    const apa = getStyleProfile("apa7");

    expect(apa?.label).toBe("APA 7");
    expect(apa?.requiredFieldsByType["article-journal"]).toEqual([
      "authors",
      "year",
      "title",
      "journal",
    ]);
    expect(apa?.commonRepairRules).toContain("doi_url_normalization");
    expect(apa?.abstainRules).toContain("missing_required_field");
  });

  it("keeps every public concrete style mapped to one profile", () => {
    expect(Object.keys(STYLE_PROFILES).sort()).toEqual([
      "acs",
      "ama",
      "apa7",
      "chicago-author-date",
      "chicago-notes-bib",
      "harvard-ctr",
      "ieee",
      "mla9",
      "vancouver",
    ]);
    expect(getStyleProfile("auto")).toBeNull();
    expect(getStyleProfile("unknown")).toBeNull();
  });
});
