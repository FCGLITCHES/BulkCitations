import { describe, expect, it } from "vitest";

import { filterPredictionFieldsByType } from "../../../src/benchmark/integrity.js";

describe("filterPredictionFieldsByType", () => {
  it("treats article-journal journals as journal/venue in benchmark predictions", () => {
    const result = filterPredictionFieldsByType("article-journal", {
      title: "Example title",
      journal: "Journal of Examples",
      volume: "12",
      issue: "3",
    });

    expect(result.fields["journal/venue"]).toBe("Journal of Examples");
    expect(result.fields).not.toHaveProperty("journal");
  });

  it("backfills conference publishers from institutional organizers for benchmark coverage", () => {
    const result = filterPredictionFieldsByType("conference-paper", {
      title: "French / Russian activities on LOX - LCH4 area",
      conferenceTitle: "57th International Astronautical Congress",
      institution: "American Institute of Aeronautics and Astronautics",
      publisher: null,
      doi: "10.2514/6.iac-06-c4.3.07",
      url: "https://doi.org/10.2514/6.iac-06-c4.3.07",
    });

    expect(result.fields.publisher).toBe("American Institute of Aeronautics and Astronautics");
    expect(result.strippedFields).toContain("institution");
  });

  it("does not invent conference publishers from conferenceTitle alone", () => {
    const result = filterPredictionFieldsByType("conference-paper", {
      title: "Conference title only",
      conferenceTitle: "Proceedings of the International Conference on Examples",
      publisher: null,
      doi: "10.1234/example.2026.1",
      url: "https://doi.org/10.1234/example.2026.1",
    });

    expect(result.fields.publisher).toBeNull();
    expect(result.fields.conferenceTitle).toBe("Proceedings of the International Conference on Examples");
  });

  it("backfills conference titles from venue-like publisher values when the extractor resolved a conference paper", () => {
    const result = filterPredictionFieldsByType("conference-paper", {
      title: "Multi-robot Synchronous Control Based on Multi-thread",
      conferenceTitle: null,
      publisher: "Advances in Intelligent Systems Research",
      doi: "10.2991/cmsa-18.2018.71",
      url: "https://doi.org/10.2991/cmsa-18.2018.71",
    });

    expect(result.fields.conferenceTitle).toBe("Advances in Intelligent Systems Research");
    expect(result.fields.publisher).toBe("Advances in Intelligent Systems Research");
  });

  it("does not backfill conferenceTitle from generic publishers without explicit conference cues", () => {
    const result = filterPredictionFieldsByType("conference-paper", {
      title: "Poster title",
      conferenceTitle: null,
      publisher: "US DOE",
      doi: "10.2172/1888228",
      url: "https://doi.org/10.2172/1888228",
    });

    expect(result.fields.conferenceTitle).toBeNull();
    expect(result.fields.publisher).toBe("US DOE");
  });
});
