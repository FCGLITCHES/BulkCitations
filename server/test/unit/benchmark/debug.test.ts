import { describe, expect, it } from "vitest";

import {
  buildBenchmarkDebugSummary,
  classifyBenchmarkStructure,
} from "../../../src/benchmark/debug.js";
import type {
  BenchmarkEvaluationResult,
  BenchmarkManifestRow,
  BenchmarkPredictionRow,
} from "../../../src/benchmark/types.js";

describe("benchmark debug", () => {
  it("classifies structured and unstructured looking inputs", () => {
    expect(
      classifyBenchmarkStructure(
        "Smith, J. (2020). Example title. Journal of Examples, 12(3), 1-10. https://doi.org/10.1000/xyz123",
      ),
    ).toBe("structured");
    expect(classifyBenchmarkStructure("Example title and some loose words only")).toBe("unstructured");
  });

  it("builds a debug summary with priorities and mismatch clusters", () => {
    const manifest: BenchmarkManifestRow[] = [
      {
        record_id: "r1",
        variant_id: "r1:apa7:clean",
        variant_kind: "clean",
        reference_type: "article-journal",
        citation_style: "apa7",
        formatted_string:
          "Smith, J. (2020). Example title. Journal of Examples, 12(3), 1-10. https://doi.org/10.1000/xyz123",
        formatted_hash: "hash-r1",
        noise_applied: [],
        source: "manual",
        source_url: "https://example.test",
        source_hash: "hash-r1",
        language: "en",
        input_structure: "structured",
        input_source_kind: "csl_rendered",
        expected_fields: {
          authors: ["Smith, Jane"],
          title: "Example title",
          year: 2020,
          journal: "Journal of Examples",
          doi: "10.1000/xyz123",
        },
        required_fields: ["authors", "title", "year", "journal/venue", "doi"],
      },
    ];
    const predictions: BenchmarkPredictionRow[] = [
      {
        record_id: "r1",
        variant_id: "r1:apa7:clean",
        citation_style: "apa7",
        reference_type: "book",
        formatted_hash: "hash-r1",
        fields: {
          title: "Wrong title",
          year: 2020,
        },
        raw_fields: {
          title: "Wrong title",
          year: 2020,
          siteName: "Wrong Site",
        },
        adapter_stripped_fields: ["siteName"],
        detected_style: "ieee",
        detected_type: "book",
        output_latency_ms: 10,
        duration_ms: 20,
        warnings: ["style_mismatch"],
      },
    ];
    const result: BenchmarkEvaluationResult = {
      generated_at: "2026-04-05T00:00:00.000Z",
      mode: "pilot",
      profile: "heuristic-only",
      parse_profile: "core_parse_fast",
      source_type: "text",
      hardware_profile: "benchmark_5600h",
      benchmark_variant: "parallel",
      slice_preset: "pathological_3001_3400",
      semantic_output_hash: "sha256:test",
      slice_start: 3001,
      slice_end: 3400,
      slice_row_count: 400,
      scoring_spec_version: "grobid-soft-v2",
      thresholds: {
        clean_macro_soft_f1_floor: 0.84,
        clean_instance_soft_f1_floor: 0.55,
        per_cell_soft_f1_floor: 0.75,
        target_macro_soft_f1: 0.9,
        normalized_citation_exact_match_floor: 0.02,
        required_field_completeness_floor: 0.75,
        false_fill_rate_ceiling: 0.3,
        accepted_without_edit_rate_floor: 0.15,
        mean_normalized_edit_distance_ceiling: 0.7,
        unsupported_false_commit_rate_ceiling: 0.05,
        abstain_precision_floor: 0.5,
        abstain_coverage_floor: 0.25,
        citation_field_exact_match_floor: {
          author: 0.7,
          title: 0.7,
          year: 0.8,
          source: 0.55,
          link: 0.7,
        },
        citation_field_hard_gate_groups: ["year", "link"],
        citation_field_warning_groups: ["author", "title", "source"],
        citation_field_hard_gate_min_compared: 20,
        citation_field_warning_min_compared: 40,
        citation_field_raw_false_positive_repair_rate_floor: 0.95,
        citation_field_raw_false_positive_repair_min_compared: 20,
      },
      contract_sanity: {
        failures: [],
        warnings: [],
        field_coverage: [
          {
            field: "authors",
            expected_rows: 1,
            predicted_non_empty_rows: 0,
            coverage: 0,
            hard_failure: true,
            warning: false,
          },
        ],
        samples: [
          {
            variant_id: "r1:apa7:clean",
            required_fields: ["authors", "title", "year", "journal/venue", "doi"],
            expected_keys: ["authors", "doi", "firstAuthor", "journal/venue", "title", "year"],
            predicted_keys: ["title", "year"],
            missing_required_fields: ["authors", "journal/venue", "doi"],
          },
        ],
      },
      partitions: [
        {
          partition: "clean",
          by_tier: {
            strict: { fields: {}, macro_field_f1: 0, instance: { tp: 0, fp: 1, fn: 1, precision: 0, recall: 0, f1: 0 }, total_rows: 1 },
            soft: {
              fields: {
                title: { tp: 0, fp: 1, fn: 0, precision: 0, recall: 0, f1: 0 },
                year: { tp: 1, fp: 0, fn: 0, precision: 1, recall: 1, f1: 1 },
                doi: { tp: 0, fp: 0, fn: 1, precision: 0, recall: 0, f1: 0 },
                "journal/venue": { tp: 0, fp: 0, fn: 1, precision: 0, recall: 0, f1: 0 },
                authors: { tp: 0, fp: 0, fn: 1, precision: 0, recall: 0, f1: 0 },
              },
              macro_field_f1: 0.1667,
              instance: { tp: 0, fp: 1, fn: 1, precision: 0, recall: 0, f1: 0 },
              total_rows: 1,
            },
            levenshtein: { fields: {}, macro_field_f1: 0, instance: { tp: 0, fp: 1, fn: 1, precision: 0, recall: 0, f1: 0 }, total_rows: 1 },
            ratcliff_obershelp: { fields: {}, macro_field_f1: 0, instance: { tp: 0, fp: 1, fn: 1, precision: 0, recall: 0, f1: 0 }, total_rows: 1 },
          },
          topline: {
            normalized_citation_exact_match_rate: 0,
            normalized_citation_exact_match_compared: 0,
            required_field_completeness: 0.4,
            false_fill_rate: 0.2,
            accepted_without_edit_rate: 0,
            mean_normalized_edit_distance: 0,
            mean_normalized_edit_distance_compared: 0,
            unsupported_false_commit_rate: 0,
            unsupported_false_commit_compared: 0,
            abstain_precision: 1,
            abstain_precision_compared: 1,
            abstain_coverage: 1,
            abstain_coverage_required: 1,
          },
          citation_field_exactness: [],
          field_contract: [],
          cell_soft_instance_f1: [
            {
              citation_style: "apa7",
              reference_type: "article-journal",
              compared: 1,
              f1: 0,
              below_threshold: true,
            },
          ],
          by_input_profile: [
            {
              input_profile: "structured_clean",
              compared: 1,
              soft_instance_f1: 0,
              high_confidence_parse_rate: 0,
              partial_parse_with_abstentions_rate: 1,
              needs_action_rate: 0,
              abstain_rate: 1,
              required_field_completeness: 0.4,
              false_fill_rate: 0.2,
              accepted_without_edit_rate: 0,
              normalized_citation_exact_match_rate: 0,
            },
          ],
          by_style: [{ citation_style: "apa7", compared: 1, soft_instance_f1: 0 }],
          by_type: [{ reference_type: "article-journal", compared: 1, soft_instance_f1: 0 }],
          by_noise_type: [],
          move_level_repairs: [],
          type_accuracy: { correct: 0, compared: 1, accuracy: 0 },
          style_accuracy: { correct: 0, compared: 1, accuracy: 0 },
          style_family_accuracy: { correct: 0, compared: 1, accuracy: 0 },
          adversarial_pair_accuracy: [
            {
              pair_name: "apa7_vs_harvard-ctr",
              styles: ["apa7", "harvard-ctr"],
              correct: 0,
              compared: 1,
              accuracy: 0,
            },
          ],
          type_confusions: [{ expected_type: "article-journal", detected_type: "book", count: 1 }],
          style_confusions: [{ expected_style: "apa7", detected_style: "ieee", count: 1 }],
          throughput_refs_per_sec: 50,
          missing_prediction_count: 0,
          missing_expected_field_count: 3,
          unsupported_predicted_field_count: 1,
        },
        {
          partition: "noisy",
          by_tier: {
            strict: { fields: {}, macro_field_f1: 0, instance: { tp: 0, fp: 0, fn: 0, precision: 0, recall: 0, f1: 0 }, total_rows: 0 },
            soft: { fields: {}, macro_field_f1: 0, instance: { tp: 0, fp: 0, fn: 0, precision: 0, recall: 0, f1: 0 }, total_rows: 0 },
            levenshtein: { fields: {}, macro_field_f1: 0, instance: { tp: 0, fp: 0, fn: 0, precision: 0, recall: 0, f1: 0 }, total_rows: 0 },
            ratcliff_obershelp: { fields: {}, macro_field_f1: 0, instance: { tp: 0, fp: 0, fn: 0, precision: 0, recall: 0, f1: 0 }, total_rows: 0 },
          },
          topline: {
            normalized_citation_exact_match_rate: 0,
            normalized_citation_exact_match_compared: 0,
            required_field_completeness: 0,
            false_fill_rate: 0,
            accepted_without_edit_rate: 0,
            mean_normalized_edit_distance: 0,
            mean_normalized_edit_distance_compared: 0,
            unsupported_false_commit_rate: 0,
            unsupported_false_commit_compared: 0,
            abstain_precision: 1,
            abstain_precision_compared: 0,
            abstain_coverage: 1,
            abstain_coverage_required: 0,
          },
          citation_field_exactness: [],
          field_contract: [],
          cell_soft_instance_f1: [],
          by_input_profile: [],
          by_style: [],
          by_type: [],
          by_noise_type: [],
          move_level_repairs: [],
          type_accuracy: { correct: 0, compared: 0, accuracy: 0 },
          style_accuracy: { correct: 0, compared: 0, accuracy: 0 },
          style_family_accuracy: { correct: 0, compared: 0, accuracy: 0 },
          adversarial_pair_accuracy: [],
          type_confusions: [],
          style_confusions: [],
          throughput_refs_per_sec: 0,
          missing_prediction_count: 0,
          missing_expected_field_count: 0,
          unsupported_predicted_field_count: 0,
        },
        {
          partition: "combined",
          by_tier: {
            strict: { fields: {}, macro_field_f1: 0, instance: { tp: 0, fp: 1, fn: 1, precision: 0, recall: 0, f1: 0 }, total_rows: 1 },
            soft: {
              fields: {
                title: { tp: 0, fp: 1, fn: 0, precision: 0, recall: 0, f1: 0 },
              },
              macro_field_f1: 0,
              instance: { tp: 0, fp: 1, fn: 1, precision: 0, recall: 0, f1: 0 },
              total_rows: 1,
            },
            levenshtein: { fields: {}, macro_field_f1: 0, instance: { tp: 0, fp: 1, fn: 1, precision: 0, recall: 0, f1: 0 }, total_rows: 1 },
            ratcliff_obershelp: { fields: {}, macro_field_f1: 0, instance: { tp: 0, fp: 1, fn: 1, precision: 0, recall: 0, f1: 0 }, total_rows: 1 },
          },
          topline: {
            normalized_citation_exact_match_rate: 0,
            normalized_citation_exact_match_compared: 0,
            required_field_completeness: 0.4,
            false_fill_rate: 0.2,
            accepted_without_edit_rate: 0,
            mean_normalized_edit_distance: 0,
            mean_normalized_edit_distance_compared: 0,
            unsupported_false_commit_rate: 0,
            unsupported_false_commit_compared: 0,
            abstain_precision: 1,
            abstain_precision_compared: 1,
            abstain_coverage: 1,
            abstain_coverage_required: 1,
          },
          citation_field_exactness: [],
          field_contract: [],
          cell_soft_instance_f1: [
            {
              citation_style: "apa7",
              reference_type: "article-journal",
              compared: 1,
              f1: 0,
              below_threshold: true,
            },
          ],
          by_input_profile: [
            {
              input_profile: "structured_clean",
              compared: 1,
              soft_instance_f1: 0,
              high_confidence_parse_rate: 0,
              partial_parse_with_abstentions_rate: 1,
              needs_action_rate: 0,
              abstain_rate: 1,
              required_field_completeness: 0.4,
              false_fill_rate: 0.2,
              accepted_without_edit_rate: 0,
              normalized_citation_exact_match_rate: 0,
            },
          ],
          by_style: [{ citation_style: "apa7", compared: 1, soft_instance_f1: 0 }],
          by_type: [{ reference_type: "article-journal", compared: 1, soft_instance_f1: 0 }],
          by_noise_type: [],
          move_level_repairs: [],
          type_accuracy: { correct: 0, compared: 1, accuracy: 0 },
          style_accuracy: { correct: 0, compared: 1, accuracy: 0 },
          style_family_accuracy: { correct: 0, compared: 1, accuracy: 0 },
          adversarial_pair_accuracy: [
            {
              pair_name: "apa7_vs_harvard-ctr",
              styles: ["apa7", "harvard-ctr"],
              correct: 0,
              compared: 1,
              accuracy: 0,
            },
          ],
          type_confusions: [{ expected_type: "article-journal", detected_type: "book", count: 1 }],
          style_confusions: [{ expected_style: "apa7", detected_style: "ieee", count: 1 }],
          throughput_refs_per_sec: 50,
          missing_prediction_count: 0,
          missing_expected_field_count: 3,
          unsupported_predicted_field_count: 1,
        },
      ],
      target_status: "below_target",
    };

    const debug = buildBenchmarkDebugSummary(manifest, predictions, result);
    expect(debug.profile).toBe("heuristic-only");
    expect(debug.parse_profile).toBe("core_parse_fast");
    expect(debug.hardware_profile).toBe("benchmark_5600h");
    expect(debug.benchmark_variant).toBe("parallel");
    expect(debug.slice_preset).toBe("pathological_3001_3400");
    expect(debug.semantic_output_hash).toBe("sha256:test");
    expect(debug.slice_start).toBe(3001);
    expect(debug.slice_end).toBe(3400);
    expect(debug.clean_debug.adapter_coverage[0]?.field).toBe("authors");
    expect(debug.clean_debug.contract_samples[0]?.variant_id).toBe("r1:apa7:clean");
    expect(debug.clean_debug.priority_fields.map((entry) => entry.field)).toEqual(
      expect.arrayContaining(["authors", "journal/venue", "doi", "siteName"]),
    );
    expect(debug.clean_debug.type_accuracy.accuracy).toBe(0);
    expect(debug.clean_debug.style_accuracy.accuracy).toBe(0);
    expect(debug.clean_debug.style_family_accuracy.accuracy).toBe(0);
    expect(debug.clean_debug.adversarial_pair_accuracy[0]).toEqual({
      pair_name: "apa7_vs_harvard-ctr",
      styles: ["apa7", "harvard-ctr"],
      correct: 0,
      compared: 1,
      accuracy: 0,
    });
    expect(debug.clean_debug.style_mismatches[0]).toEqual({
      expected_style: "apa7",
      detected_style: "ieee",
      count: 1,
    });
    expect(debug.clean_debug.type_mismatches[0]).toEqual({
      expected_type: "article-journal",
      detected_type: "book",
      count: 1,
    });
    expect(debug.clean_debug.sample_failures[0]?.failed_required_fields).toEqual(
      expect.arrayContaining(["authors", "title", "journal/venue", "doi"]),
    );
    expect(debug.clean_debug.field_failure_examples.find((entry) => entry.field === "title")?.examples[0]?.reason_bucket).toBe("catastrophic_wrong_content");
    expect(debug.clean_debug.stripped_fields_by_type[0]).toEqual({
      detected_type: "book",
      field: "siteName",
      count: 1,
    });
  });
});
