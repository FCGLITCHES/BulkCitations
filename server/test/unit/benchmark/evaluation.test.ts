import { describe, expect, it } from "vitest";

import {
  compareField,
  evaluateBenchmark,
  evaluateBenchmarkContractSanity,
} from "../../../src/benchmark/evaluation.js";
import type {
  BenchmarkManifestRow,
  BenchmarkPredictionRow,
} from "../../../src/benchmark/types.js";

describe("benchmark evaluation", () => {
  it("matches identifiers exactly after normalization", () => {
    expect(compareField("doi", "https://doi.org/10.1000/xyz123", "10.1000/xyz123", "soft")).toBe(true);
    expect(compareField("pmid", "PMID:12345678", "12345678", "soft")).toBe(true);
    expect(compareField("patent", "US6285999B1", "US6285999B1", "soft")).toBe(true);
  });

  it("tolerates near year matches and author token overlap", () => {
    expect(compareField("year", "2021", "2020", "soft")).toBe(true);
    expect(compareField("authors", ["Page, Lawrence", "Brin, Sergey"], ["Page, Lawrence", "Brin, Sergey"], "soft")).toBe(true);
    expect(compareField("firstAuthor", "Page, Lawrence", "Page, Lawrence", "soft")).toBe(true);
  });

  it("treats compound comma-name variants as compatible authors", () => {
    expect(
      compareField(
        "authors",
        ["Shaebani, M. Reza"],
        ["Reza Shaebani, M."],
        "soft",
      ),
    ).toBe(true);
    expect(
      compareField(
        "authors",
        ["Devi, M. Uma"],
        ["Uma Devi, M."],
        "soft",
      ),
    ).toBe(true);
  });

  it("treats hyphenated surname initials as compatible with full given names", () => {
    expect(
      compareField(
        "authors",
        ["Quealy-Gainer, K"],
        ["Quealy-Gainer, Kate"],
        "soft",
      ),
    ).toBe(true);
    expect(
      compareField(
        "firstAuthor",
        "Quealy-Gainer, K.",
        "Quealy-Gainer, Kate",
        "soft",
      ),
    ).toBe(true);
  });

  it("treats explicitly condensed author lists as compatible when the visible authors stay in order", () => {
    expect(
      compareField(
        "authors",
        [
          "Elgaafary, S.",
          "Hlevnjak, M.",
          "Schulze, M.",
          "Thewes, V.",
          "… Schneeweiss, A",
        ],
        [
          "Elgaafary, S",
          "Hlevnjak, M",
          "Schulze, M",
          "Thewes, V",
          "Seitz, J",
          "Fremd, C",
          "Schneeweiss, A",
        ],
        "soft",
      ),
    ).toBe(true);
  });

  it("treats et al citation leads as compatible with full canonical author lists when the visible authors stay in order", () => {
    expect(
      compareField(
        "authors",
        ["Bonhomme, C."],
        [
          "Bonhomme, C.",
          "Theron, M.",
          "Louaas, E.",
          "Beaurain, A.",
          "Seleznev, E. P.",
        ],
        "soft",
        "Bonhomme, C., et al. “French / Russian Activities on LOX - LCH4 Area.” 2006, 57th International Astronautical Congress, https://doi.org/10.2514/6.iac-06-c4.3.07.",
      ),
    ).toBe(true);
  });

  it("treats surname-particle shifts as compatible conference authors", () => {
    expect(
      compareField(
        "authors",
        ["Paulo Santos da Silva, Marcos", "Martins, Cátia de Paula"],
        ["Paulo Santos da Silva, Marcos", "de Paula Martins, Cátia"],
        "soft",
      ),
    ).toBe(true);
    expect(
      compareField(
        "authors",
        ["Acácio, Mariana da Silva", "DE SOUZA, MARIA APARECIDA"],
        ["Acácio, Mariana da Silva", "SOUZA, MARIA APARECIDA DE"],
        "soft",
      ),
    ).toBe(true);
    expect(
      compareField(
        "authors",
        ["FERREIRA, T A C", "OLVEIRA, B C D", "LEITÃO, P H A"],
        ["FERREIRA, THAIS ANGELICA CARDOSO", "OLVEIRA, BELMIRO CARDOSO DE", "LEITÃO, PEDRO HENRIQUE ALVES"],
        "soft",
      ),
    ).toBe(true);
  });

  it("accepts stable acronym and full-name container matches", () => {
    expect(
      compareField(
        "journal/venue",
        "IJERPH",
        "International Journal of Environmental Research and Public Health",
        "soft",
      ),
    ).toBe(true);
    expect(
      compareField(
        "conferenceTitle",
        "ICCA",
        "2024 International Conference on Computer and Applications (ICCA)",
        "soft",
      ),
    ).toBe(true);
  });

  it("builds clean/noisy partitions with soft cell metrics", () => {
    const manifest: BenchmarkManifestRow[] = [
      {
        record_id: "r1",
        variant_id: "r1:apa7:clean",
        variant_kind: "clean",
        reference_type: "article-journal",
        citation_style: "apa7",
        formatted_string: "Page, L. (2001). Method for node ranking in a linked database.",
        formatted_hash: "hash-clean",
        noise_applied: [],
        source: "manual",
        source_url: "https://example.test/r1",
        source_hash: "hash-r1",
        language: "en",
        input_structure: "structured",
        input_source_kind: "csl_rendered",
        expected_fields: {
          authors: ["Page, Lawrence"],
          title: "Method for node ranking in a linked database",
          year: 2001,
          doi: "10.1000/test",
        },
        required_fields: ["authors", "title", "year", "doi"],
      },
      {
        record_id: "r1",
        variant_id: "r1:apa7:noisy",
        variant_kind: "noisy",
        reference_type: "article-journal",
        citation_style: "apa7",
        formatted_string: "Page, L. Method for node ranking in a linked database. doi:10.1000/test",
        formatted_hash: "hash-noisy",
        noise_applied: ["missing_field"],
        source: "manual",
        source_url: "https://example.test/r1",
        source_hash: "hash-r1-noisy",
        language: "en",
        input_structure: "structured",
        input_source_kind: "csl_rendered",
        expected_fields: {
          authors: ["Page, Lawrence"],
          title: "Method for node ranking in a linked database",
          year: 2001,
          doi: "10.1000/test",
        },
        required_fields: ["authors", "title", "doi"],
      },
    ];
    const predictions: BenchmarkPredictionRow[] = [
      {
        record_id: "r1",
        variant_id: "r1:apa7:clean",
        citation_style: "apa7",
        reference_type: "article-journal",
        formatted_hash: "hash-clean",
        fields: {
          authors: ["Page, Lawrence"],
          title: "Method for node ranking in a linked database",
          year: 2001,
          doi: "10.1000/test",
        },
        venue: undefined,
        detected_style: "apa7",
        detected_style_family: "author_date",
        detected_type: "article-journal",
        parse_outcome: "high_confidence_parse",
        public_status: "ready",
        status: "ok",
        field_move_ledger: [
          {
            phaseId: "shared_repair",
            reasonCode: "publisher_to_journal_repair",
            sourceField: "publisher",
            destinationField: "journal",
            action: "mutate",
            previousValue: "Journal of Examples",
            nextValue: "Journal of Examples",
            beforeConfidence: 0.81,
            afterConfidence: 0.81,
          },
        ],
        output_latency_ms: 10,
        duration_ms: 20,
        warnings: [],
      },
      {
        record_id: "r1",
        variant_id: "r1:apa7:noisy",
        citation_style: "apa7",
        reference_type: "article-journal",
        formatted_hash: "hash-noisy",
        fields: {
          authors: ["Page, Lawrence"],
          title: "Method for node ranking in a linked database",
          year: 2001,
          doi: "10.1000/test",
        },
        venue: undefined,
        detected_style: "apa7",
        detected_style_family: "author_date",
        detected_type: "article-journal",
        parse_outcome: "partial_parse_with_abstentions",
        public_status: "needs_review",
        status: "ok",
        output_latency_ms: 10,
        duration_ms: 20,
        warnings: [],
      },
    ];

    const result = evaluateBenchmark(manifest, predictions, "pilot", "heuristic-only", {
      parseProfile: "core_parse_fast",
      sourceType: "text",
      hardwareProfile: "benchmark_5600h",
      benchmarkVariant: "grobid_compare",
      artifactNamespace: "full_canonical",
      slicePreset: "pathological_3001_3400",
      semanticOutputHash: "sha256:test",
      fieldHash: "sha256:field",
      contractHash: "sha256:contract",
      sliceRange: {
        startRow: 3001,
        endRow: 3400,
      },
      runtimeMetrics: {
        measurement_basis: "wall_clock",
        wall_clock_ms: 40,
        prediction_count: 2,
        throughput_refs_per_sec: 50,
        cpu_user_ms: 10,
        cpu_system_ms: 3,
        provider_call_count: 0,
        stage_totals_ms: {
          extraction: 20,
        },
        worker_stats: [],
        slow_chunks: [],
        slow_rows: [],
        gc_stats: {
          total_collections: 0,
          total_duration_ms: 0,
          max_pause_ms: 0,
        },
        memory_stats: {
          rss_start_bytes: 1024,
          rss_end_bytes: 2048,
          rss_peak_bytes: 4096,
          heap_used_start_bytes: 512,
          heap_used_end_bytes: 768,
          heap_used_peak_bytes: 1024,
        },
        throughput_decay: {
          sample_count: 0,
          initial_refs_per_sec: null,
          final_refs_per_sec: null,
          decline_ratio: null,
        },
        worker_imbalance: {
          worker_count: 0,
          prediction_count_ratio: null,
          wall_clock_ratio: null,
          throughput_ratio: null,
        },
      },
    });
    const clean = result.partitions.find((partition) => partition.partition === "clean");
    const noisy = result.partitions.find((partition) => partition.partition === "noisy");

    expect(result.scoring_spec_version).toBe("grobid-soft-v3");
    expect(result.profile).toBe("heuristic-only");
    expect(result.thresholds.normalized_citation_exact_match_floor).toBe(0.02);
    expect(result.parse_profile).toBe("core_parse_fast");
    expect(result.source_type).toBe("text");
    expect(result.hardware_profile).toBe("benchmark_5600h");
    expect(result.benchmark_variant).toBe("grobid_compare");
    expect(result.artifact_namespace).toBe("full_canonical");
    expect(result.slice_preset).toBe("pathological_3001_3400");
    expect(result.semantic_output_hash).toBe("sha256:test");
    expect(result.field_hash).toBe("sha256:field");
    expect(result.contract_hash).toBe("sha256:contract");
    expect(result.slice_start).toBe(3001);
    expect(result.slice_end).toBe(3400);
    expect(result.slice_row_count).toBe(400);
    expect(result.runtime_metrics).toEqual({
      measurement_basis: "wall_clock",
      wall_clock_ms: 40,
      prediction_count: 2,
      throughput_refs_per_sec: 50,
      cpu_user_ms: 10,
      cpu_system_ms: 3,
      provider_call_count: 0,
      stage_totals_ms: {
        extraction: 20,
      },
      worker_stats: [],
      slow_chunks: [],
      slow_rows: [],
      gc_stats: {
        total_collections: 0,
        total_duration_ms: 0,
        max_pause_ms: 0,
      },
      memory_stats: {
        rss_start_bytes: 1024,
        rss_end_bytes: 2048,
        rss_peak_bytes: 4096,
        heap_used_start_bytes: 512,
        heap_used_end_bytes: 768,
        heap_used_peak_bytes: 1024,
      },
      throughput_decay: {
        sample_count: 0,
        initial_refs_per_sec: null,
        final_refs_per_sec: null,
        decline_ratio: null,
      },
      worker_imbalance: {
        worker_count: 0,
        prediction_count_ratio: null,
        wall_clock_ratio: null,
        throughput_ratio: null,
      },
    });
    expect(result.contract_sanity.failures).toEqual([]);
    expect(clean?.by_tier.soft.instance.f1).toBe(1);
    expect(noisy?.by_tier.soft.instance.f1).toBe(1);
    expect(clean?.type_accuracy.accuracy).toBe(1);
    expect(clean?.style_accuracy.accuracy).toBe(1);
    expect(clean?.style_family_accuracy.accuracy).toBe(1);
    expect(clean?.adversarial_pair_accuracy.find((pair) => pair.pair_name === "apa7_vs_harvard-ctr")).toEqual({
      pair_name: "apa7_vs_harvard-ctr",
      styles: ["apa7", "harvard-ctr"],
      correct: 1,
      compared: 1,
      accuracy: 1,
    });
    expect(clean?.cell_soft_instance_f1.find((cell) => cell.citation_style === "apa7" && cell.reference_type === "article-journal")?.f1).toBe(1);
    expect(clean?.field_contract.find((row) => row.field === "doi")).toMatchObject({
      coverage: 1,
      exact_f1: 1,
      canonical_f1: 1,
      exact_precision_non_abstained: 1,
      canonical_precision_non_abstained: 1,
    });
    expect(clean?.topline).toMatchObject({
      normalized_citation_exact_match_rate: 0,
      normalized_citation_exact_match_compared: 0,
      required_field_completeness: 1,
      false_fill_rate: 0,
      accepted_without_edit_rate: 1,
      mean_normalized_edit_distance: 0,
      mean_normalized_edit_distance_compared: 0,
      unsupported_false_commit_rate: 0,
      unsupported_false_commit_compared: 0,
      abstain_precision: 1,
      abstain_precision_compared: 0,
      abstain_coverage: 1,
      abstain_coverage_required: 0,
    });
    expect(clean?.by_input_profile.find((row) => row.input_profile === "structured_clean")).toMatchObject({
      compared: 1,
      high_confidence_parse_rate: 1,
      partial_parse_with_abstentions_rate: 0,
      needs_action_rate: 0,
      abstain_rate: 0,
      required_field_completeness: 1,
      false_fill_rate: 0,
      accepted_without_edit_rate: 1,
      normalized_citation_exact_match_rate: 0,
    });
    expect(noisy?.by_input_profile.find((row) => row.input_profile === "structured_noisy")).toMatchObject({
      compared: 1,
      high_confidence_parse_rate: 0,
      partial_parse_with_abstentions_rate: 1,
      needs_action_rate: 0,
      abstain_rate: 0,
      required_field_completeness: 1,
      false_fill_rate: 0,
      accepted_without_edit_rate: 0,
      normalized_citation_exact_match_rate: 0,
    });
    expect(clean?.move_level_repairs).toEqual([
      {
        phase_id: "shared_repair",
        reason_code: "publisher_to_journal_repair",
        total_repairs: 1,
        successful_repairs: 0,
        precision: 0,
      },
    ]);
  });

  it("treats article-journal journal and venue as the same journal/venue benchmark field", () => {
    const manifest: BenchmarkManifestRow[] = [
      {
        record_id: "r1",
        variant_id: "r1:apa7:clean",
        variant_kind: "clean",
        reference_type: "article-journal",
        citation_style: "apa7",
        formatted_string: "Smith, J. (2020). Example title. Journal of Examples.",
        formatted_hash: "hash-clean",
        noise_applied: [],
        source: "manual",
        source_url: "https://example.test/r1",
        source_hash: "hash-r1",
        language: "en",
        input_structure: "structured",
        input_source_kind: "csl_rendered",
        expected_fields: {
          title: "Example title",
          year: 2020,
          journal: "Journal of Examples",
        },
        required_fields: ["title", "year", "journal/venue"],
      },
    ];
    const predictions: BenchmarkPredictionRow[] = [
      {
        record_id: "r1",
        variant_id: "r1:apa7:clean",
        citation_style: "apa7",
        reference_type: "article-journal",
        formatted_hash: "hash-clean",
        fields: {
          title: "Example title",
          year: 2020,
          "journal/venue": "Journal of Examples",
        },
        venue: "Journal of Examples",
        detected_style: "apa7",
        detected_type: "article-journal",
        output_latency_ms: 10,
        duration_ms: 20,
        warnings: [],
      },
    ];

    const result = evaluateBenchmark(manifest, predictions, "pilot");
    const clean = result.partitions.find((partition) => partition.partition === "clean");

    expect(clean?.by_tier.soft.fields["journal/venue"]?.tp).toBe(1);
    expect(clean?.missing_expected_field_count).toBe(0);
    expect(result.contract_sanity.samples).toEqual([]);
  });

  it("flags hard coverage failures before quality scoring", () => {
    const manifest: BenchmarkManifestRow[] = [
      {
        record_id: "r1",
        variant_id: "r1:apa7:clean",
        variant_kind: "clean",
        reference_type: "article-journal",
        citation_style: "apa7",
        formatted_string: "Page, L. (2001). Method for node ranking in a linked database.",
        formatted_hash: "hash-clean",
        noise_applied: [],
        source: "manual",
        source_url: "https://example.test/r1",
        source_hash: "hash-r1",
        language: "en",
        input_structure: "structured",
        input_source_kind: "csl_rendered",
        expected_fields: {
          authors: ["Page, Lawrence"],
          title: "Method for node ranking in a linked database",
          year: 2001,
        },
        required_fields: ["authors", "title", "year"],
      },
    ];
    const predictions: BenchmarkPredictionRow[] = [
      {
        record_id: "r1",
        variant_id: "r1:apa7:clean",
        citation_style: "apa7",
        reference_type: "article-journal",
        formatted_hash: "hash-clean",
        fields: {
          year: 2001,
        },
        output_latency_ms: 10,
        duration_ms: 20,
        warnings: [],
      },
    ];

    const sanity = evaluateBenchmarkContractSanity(manifest, predictions);
    expect(sanity.failures).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/authors/i),
        expect.stringMatching(/title/i),
      ]),
    );
  });

  it("treats 0.9000 coverage as a hard failure so core fields must stay above 90 percent", () => {
    const manifest: BenchmarkManifestRow[] = Array.from({ length: 10 }, (_, index) => ({
      record_id: `r${index}`,
      variant_id: `r${index}:apa7:clean`,
      variant_kind: "clean" as const,
      reference_type: "article-journal" as const,
      citation_style: "apa7" as const,
      formatted_string: `Page, L. (${2000 + index}). Example ${index}.`,
      formatted_hash: `hash-${index}`,
      noise_applied: [],
      source: "manual",
      source_url: `https://example.test/r${index}`,
      source_hash: `source-${index}`,
      language: "en",
      input_structure: "structured" as const,
      input_source_kind: "csl_rendered" as const,
      expected_fields: {
        title: `Example ${index}`,
      },
      required_fields: ["title"],
    }));
    const predictions: BenchmarkPredictionRow[] = manifest.slice(0, 9).map((row) => ({
      record_id: row.record_id,
      variant_id: row.variant_id,
      citation_style: row.citation_style,
      reference_type: row.reference_type,
      formatted_hash: row.formatted_hash,
      fields: {
        title: row.expected_fields.title,
      },
      output_latency_ms: 10,
      duration_ms: 20,
      warnings: [],
    }));

    const sanity = evaluateBenchmarkContractSanity(manifest, predictions);
    expect(sanity.failures).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/title/i),
        expect.stringMatching(/0\.9/i),
      ]),
    );
  });

  it("recomputes required fields from the rendered benchmark input instead of stale manifest metadata", () => {
    const manifest: BenchmarkManifestRow[] = [
      {
        record_id: "r1",
        variant_id: "r1:vancouver:noisy",
        variant_kind: "noisy",
        reference_type: "article-journal",
        citation_style: "vancouver",
        formatted_string:
          "[1]Pillai R, Valappil NN, Parambil DAC. An updated methodology for sediment distribution maps using conditional strings in Arc GIS 10.X. Arabian Journal of Geosciences 2021;14. https://doi.org/.",
        formatted_hash: "hash-r1",
        noise_applied: ["missing_field"],
        source: "manual",
        source_url: "https://example.test/r1",
        source_hash: "source-r1",
        language: "en",
        input_structure: "structured",
        input_source_kind: "csl_rendered",
        expected_fields: {
          authors: [
            "Pillai, Rachna",
            "Valappil, Nisha Nayakkam",
            "Parambil, Dinesh Aynipulli Chulli",
          ],
          title: "An updated methodology for sediment distribution maps using conditional strings in Arc GIS 10.X",
          year: 2021,
          journal: "Arabian Journal of Geosciences",
          volume: "14",
          issue: "20",
        },
        required_fields: ["authors", "title", "year", "journal/venue", "volume", "issue"],
      },
    ];
    const predictions: BenchmarkPredictionRow[] = [
      {
        record_id: "r1",
        variant_id: "r1:vancouver:noisy",
        citation_style: "vancouver",
        reference_type: "article-journal",
        formatted_hash: "hash-r1",
        fields: {
          authors: [
            "Pillai, R",
            "Valappil, N N",
            "Parambil, D A C",
          ],
          title: "An updated methodology for sediment distribution maps using conditional strings in Arc GIS 10.X",
          year: 2021,
          journal: "Arabian Journal of Geosciences",
          volume: "14",
          url: "https://doi.org/",
        },
        output_latency_ms: 10,
        duration_ms: 20,
        warnings: [],
      },
    ];

    const sanity = evaluateBenchmarkContractSanity(manifest, predictions);

    expect(sanity.samples).toEqual([]);
  });
});
