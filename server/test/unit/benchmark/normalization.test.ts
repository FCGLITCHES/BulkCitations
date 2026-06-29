import { describe, expect, it } from "vitest";

import {
  deriveVirtualVenue,
  fieldLooksPresentInFormatted,
  flattenPredictionFields,
  flattenManifestFields,
  inferRequiredFields,
  normalizeSoftText,
} from "../../../src/benchmark/normalization.js";
import type { BenchmarkManifestRow, BenchmarkPredictionRow } from "../../../src/benchmark/types.js";

describe("benchmark normalization", () => {
  it("derives the virtual venue from the reference type", () => {
    expect(
      deriveVirtualVenue("article-journal", {
        journal: "Nature",
      }),
    ).toBe("Nature");

    expect(
      deriveVirtualVenue("conference-paper", {
        conferenceTitle: "NeurIPS",
      }),
    ).toBe("NeurIPS");

    expect(
      deriveVirtualVenue("webpage", {
        siteName: "MDN Web Docs",
      }),
    ).toBe("MDN Web Docs");

    expect(
      deriveVirtualVenue("article-journal", {
        venue: "Nature",
        journal: "Should stay hidden",
      }),
    ).toBe("Nature");
  });

  it("treats normalized identifiers as present in the formatted citation", () => {
    expect(
      fieldLooksPresentInFormatted(
        "doi",
        "10.1000/xyz123",
        "Smith, J. Example article. https://doi.org/10.1000/xyz123",
      ),
    ).toBe(true);

    expect(
      fieldLooksPresentInFormatted(
        "patent",
        "US6285999B1",
        "Page, L. Patent US 6,285,999 B1. 2001.",
      ),
    ).toBe(true);
  });

  it("applies the shared soft-text normalization symmetrically", () => {
    expect(normalizeSoftText("pp. 123–126")).toBe("pp 123 126");
    expect(normalizeSoftText("https://doi.org/10.1000/xyz123")).toBe("10 1000 xyz123");
    expect(normalizeSoftText("A & B")).toBe("a and b");
    expect(normalizeSoftText("Anesthesia &amp; Analgesia")).toBe("anesthesia and analgesia");
    expect(normalizeSoftText("LEITÃO, P H A")).toBe("leitão p h a");
  });

  it("derives required fields from what is actually rendered", () => {
    const row: Pick<
      BenchmarkManifestRow,
      "reference_type" | "expected_fields" | "formatted_string"
    > = {
      reference_type: "article-journal",
      expected_fields: {
        authors: ["Smith, Jane"],
        title: "Example title",
        year: 2020,
        journal: "Journal of Examples",
        doi: "10.1000/xyz123",
        issue: "4",
      },
      formatted_string:
        "Smith, Jane. (2020). Example title. Journal of Examples. https://doi.org/10.1000/xyz123",
    };

    expect(inferRequiredFields(row)).toEqual([
      "authors",
      "title",
      "year",
      "journal/venue",
      "doi",
    ]);
  });

  it("does not make journal pages mandatory benchmark fields when the locator is absent", () => {
    const row: Pick<
      BenchmarkManifestRow,
      "reference_type" | "expected_fields" | "formatted_string"
    > = {
      reference_type: "article-journal",
      expected_fields: {
        authors: ["Smith, Jane"],
        title: "Example title",
        year: 2020,
        journal: "Journal of Examples",
        volume: "12",
        pages: "44-50",
      },
      formatted_string:
        "Smith, Jane. (2020). Example title. Journal of Examples, 12.",
    };

    expect(inferRequiredFields(row)).toEqual([
      "authors",
      "title",
      "year",
      "journal/venue",
      "volume",
    ]);
  });

  it("canonicalizes article journals to journal/venue in flattened benchmark fields", () => {
    const flattened = flattenManifestFields({
      record_id: "r1",
      variant_id: "r1:apa7:clean",
      variant_kind: "clean",
      reference_type: "article-journal",
      citation_style: "apa7",
      formatted_string: "Smith, Jane. (2020). Example title. Journal of Examples.",
      formatted_hash: "hash-r1",
      noise_applied: [],
      source: "manual",
      source_url: "https://example.test",
      source_hash: "source-r1",
      language: "en",
      input_structure: "structured",
      input_source_kind: "csl_rendered",
      expected_fields: {
        authors: ["Smith, Jane"],
        title: "Example title",
        year: 2020,
        journal: "Journal of Examples",
      },
      required_fields: ["authors", "title", "year", "journal/venue"],
    });

    expect(flattened["journal/venue"]).toBe("Journal of Examples");
    expect(flattened).not.toHaveProperty("journal");
  });

  it("derives journal/venue from conferenceTitle for conference-paper predictions", () => {
    const flattened = flattenPredictionFields({
      record_id: "r2",
      variant_id: "r2:mla9:clean",
      citation_style: "mla9",
      reference_type: "conference-paper",
      detected_type: "conference-paper",
      formatted_hash: "hash-r2",
      fields: {
        authors: ["Smith, Jane"],
        title: "Example conference paper",
        year: 2024,
        conferenceTitle: "International Conference on Example Systems",
      },
      output_latency_ms: 12,
      duration_ms: 12,
      warnings: [],
    } satisfies BenchmarkPredictionRow);

    expect(flattened["journal/venue"]).toBe("International Conference on Example Systems");
  });
});
