import { describe, expect, it } from "vitest";

import { evaluateBenchmarkGate } from "../../../src/benchmark/gating.js";
import type { BenchmarkEvaluationResult } from "../../../src/benchmark/types.js";

function makeResult(overrides: {
  cleanMacroSoftF1?: number;
  cleanInstanceSoftF1?: number;
  cleanCellSoftF1?: number;
  cleanRequiredCompleteness?: number;
  cleanFalseFillRate?: number;
} = {}): BenchmarkEvaluationResult {
  const cleanMacroSoftF1 = overrides.cleanMacroSoftF1 ?? 0.9;
  const cleanInstanceSoftF1 = overrides.cleanInstanceSoftF1 ?? 0.6;
  const cleanCellSoftF1 = overrides.cleanCellSoftF1 ?? 0.8;
  const cleanRequiredCompleteness = overrides.cleanRequiredCompleteness ?? 0.95;
  const cleanFalseFillRate = overrides.cleanFalseFillRate ?? 0.05;

  return {
    generated_at: "2026-04-05T00:00:00.000Z",
    mode: "pilot",
    profile: "heuristic-only",
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
      field_coverage: [],
      samples: [],
    },
    partitions: [
      {
        partition: "clean",
        by_tier: {
          strict: {
            fields: {},
            macro_field_f1: cleanMacroSoftF1,
            instance: { tp: 1, fp: 0, fn: 0, precision: 1, recall: 1, f1: cleanInstanceSoftF1 },
            total_rows: 1,
          },
          soft: {
            fields: {},
            macro_field_f1: cleanMacroSoftF1,
            instance: { tp: 1, fp: 0, fn: 0, precision: 1, recall: 1, f1: cleanInstanceSoftF1 },
            total_rows: 1,
          },
          levenshtein: {
            fields: {},
            macro_field_f1: cleanMacroSoftF1,
            instance: { tp: 1, fp: 0, fn: 0, precision: 1, recall: 1, f1: cleanInstanceSoftF1 },
            total_rows: 1,
          },
          ratcliff_obershelp: {
            fields: {},
            macro_field_f1: cleanMacroSoftF1,
            instance: { tp: 1, fp: 0, fn: 0, precision: 1, recall: 1, f1: cleanInstanceSoftF1 },
            total_rows: 1,
          },
        },
        topline: {
          normalized_citation_exact_match_rate: 0.8,
          normalized_citation_exact_match_compared: 1,
          required_field_completeness: cleanRequiredCompleteness,
          false_fill_rate: cleanFalseFillRate,
          accepted_without_edit_rate: 0.8,
          mean_normalized_edit_distance: 0.2,
          mean_normalized_edit_distance_compared: 1,
          unsupported_false_commit_rate: 0,
          unsupported_false_commit_compared: 0,
          abstain_precision: 1,
          abstain_precision_compared: 0,
          abstain_coverage: 1,
          abstain_coverage_required: 0,
        },
        citation_field_exactness: [
          { group: "author", exact_match_rate: 0.9, compared: 60, correct: 54, raw_false_positive_repair_rate: 1, raw_false_positive_compared: 10, raw_false_positive_repaired: 10 },
          { group: "title", exact_match_rate: 0.9, compared: 60, correct: 54, raw_false_positive_repair_rate: 1, raw_false_positive_compared: 10, raw_false_positive_repaired: 10 },
          { group: "year", exact_match_rate: 0.9, compared: 60, correct: 54, raw_false_positive_repair_rate: 1, raw_false_positive_compared: 10, raw_false_positive_repaired: 10 },
          { group: "source", exact_match_rate: 0.9, compared: 60, correct: 54, raw_false_positive_repair_rate: 1, raw_false_positive_compared: 10, raw_false_positive_repaired: 10 },
          { group: "link", exact_match_rate: 0.9, compared: 60, correct: 54, raw_false_positive_repair_rate: 1, raw_false_positive_compared: 10, raw_false_positive_repaired: 10 },
        ],
        field_contract: [],
        cell_soft_instance_f1: [
          {
            citation_style: "apa7",
            reference_type: "article-journal",
            compared: 1,
            f1: cleanCellSoftF1,
            below_threshold: cleanCellSoftF1 < 0.75,
          },
        ],
        by_input_profile: [
          {
            input_profile: "structured_clean",
            compared: 1,
            soft_instance_f1: cleanInstanceSoftF1,
            high_confidence_parse_rate: 1,
            partial_parse_with_abstentions_rate: 0,
            needs_action_rate: 0,
            abstain_rate: 0,
            required_field_completeness: cleanRequiredCompleteness,
            false_fill_rate: cleanFalseFillRate,
            accepted_without_edit_rate: 0.8,
            normalized_citation_exact_match_rate: 0.8,
          },
        ],
        by_style: [{ citation_style: "apa7", compared: 1, soft_instance_f1: cleanInstanceSoftF1 }],
        by_type: [{ reference_type: "article-journal", compared: 1, soft_instance_f1: cleanInstanceSoftF1 }],
        by_noise_type: [],
        move_level_repairs: [],
        throughput_refs_per_sec: 100,
        missing_prediction_count: 0,
        type_accuracy: { correct: 0, compared: 0, accuracy: 0 },
        style_accuracy: { correct: 0, compared: 0, accuracy: 0 },
        style_family_accuracy: { correct: 0, compared: 0, accuracy: 0 },
        adversarial_pair_accuracy: [],
        type_confusions: [],
        style_confusions: [],
        missing_expected_field_count: 0,
        unsupported_predicted_field_count: 0,
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
        throughput_refs_per_sec: 0,
        missing_prediction_count: 0,
        type_accuracy: { correct: 0, compared: 0, accuracy: 0 },
        style_accuracy: { correct: 0, compared: 0, accuracy: 0 },
        style_family_accuracy: { correct: 0, compared: 0, accuracy: 0 },
        adversarial_pair_accuracy: [],
        type_confusions: [],
        style_confusions: [],
        missing_expected_field_count: 0,
        unsupported_predicted_field_count: 0,
      },
      {
        partition: "combined",
        by_tier: {
          strict: { fields: {}, macro_field_f1: cleanMacroSoftF1, instance: { tp: 1, fp: 0, fn: 0, precision: 1, recall: 1, f1: cleanInstanceSoftF1 }, total_rows: 1 },
          soft: { fields: {}, macro_field_f1: cleanMacroSoftF1, instance: { tp: 1, fp: 0, fn: 0, precision: 1, recall: 1, f1: cleanInstanceSoftF1 }, total_rows: 1 },
          levenshtein: { fields: {}, macro_field_f1: cleanMacroSoftF1, instance: { tp: 1, fp: 0, fn: 0, precision: 1, recall: 1, f1: cleanInstanceSoftF1 }, total_rows: 1 },
          ratcliff_obershelp: { fields: {}, macro_field_f1: cleanMacroSoftF1, instance: { tp: 1, fp: 0, fn: 0, precision: 1, recall: 1, f1: cleanInstanceSoftF1 }, total_rows: 1 },
        },
        topline: {
          normalized_citation_exact_match_rate: 0.8,
          normalized_citation_exact_match_compared: 1,
          required_field_completeness: cleanRequiredCompleteness,
          false_fill_rate: cleanFalseFillRate,
          accepted_without_edit_rate: 0.8,
          mean_normalized_edit_distance: 0.2,
          mean_normalized_edit_distance_compared: 1,
          unsupported_false_commit_rate: 0,
          unsupported_false_commit_compared: 0,
          abstain_precision: 1,
          abstain_precision_compared: 0,
          abstain_coverage: 1,
          abstain_coverage_required: 0,
        },
        citation_field_exactness: [
          { group: "author", exact_match_rate: 0.9, compared: 60, correct: 54, raw_false_positive_repair_rate: 1, raw_false_positive_compared: 10, raw_false_positive_repaired: 10 },
          { group: "title", exact_match_rate: 0.9, compared: 60, correct: 54, raw_false_positive_repair_rate: 1, raw_false_positive_compared: 10, raw_false_positive_repaired: 10 },
          { group: "year", exact_match_rate: 0.9, compared: 60, correct: 54, raw_false_positive_repair_rate: 1, raw_false_positive_compared: 10, raw_false_positive_repaired: 10 },
          { group: "source", exact_match_rate: 0.9, compared: 60, correct: 54, raw_false_positive_repair_rate: 1, raw_false_positive_compared: 10, raw_false_positive_repaired: 10 },
          { group: "link", exact_match_rate: 0.9, compared: 60, correct: 54, raw_false_positive_repair_rate: 1, raw_false_positive_compared: 10, raw_false_positive_repaired: 10 },
        ],
        field_contract: [],
        cell_soft_instance_f1: [
          {
            citation_style: "apa7",
            reference_type: "article-journal",
            compared: 1,
            f1: cleanCellSoftF1,
            below_threshold: cleanCellSoftF1 < 0.75,
          },
        ],
        by_input_profile: [
          {
            input_profile: "structured_clean",
            compared: 1,
            soft_instance_f1: cleanInstanceSoftF1,
            high_confidence_parse_rate: 1,
            partial_parse_with_abstentions_rate: 0,
            needs_action_rate: 0,
            abstain_rate: 0,
            required_field_completeness: cleanRequiredCompleteness,
            false_fill_rate: cleanFalseFillRate,
            accepted_without_edit_rate: 0.8,
            normalized_citation_exact_match_rate: 0.8,
          },
        ],
        by_style: [{ citation_style: "apa7", compared: 1, soft_instance_f1: cleanInstanceSoftF1 }],
        by_type: [{ reference_type: "article-journal", compared: 1, soft_instance_f1: cleanInstanceSoftF1 }],
        by_noise_type: [],
        move_level_repairs: [],
        throughput_refs_per_sec: 100,
        missing_prediction_count: 0,
        type_accuracy: { correct: 0, compared: 0, accuracy: 0 },
        style_accuracy: { correct: 0, compared: 0, accuracy: 0 },
        style_family_accuracy: { correct: 0, compared: 0, accuracy: 0 },
        adversarial_pair_accuracy: [],
        type_confusions: [],
        style_confusions: [],
        missing_expected_field_count: 0,
        unsupported_predicted_field_count: 0,
      },
    ],
    target_status: cleanMacroSoftF1 >= 0.9 ? "pass" : "below_target",
  };
}

describe("benchmark gating", () => {
  it("passes when thresholds are met", () => {
    const outcome = evaluateBenchmarkGate(makeResult());
    expect(outcome.failures).toEqual([]);
  });

  it("fails when the clean lane falls below a required floor", () => {
    const outcome = evaluateBenchmarkGate(makeResult({ cleanCellSoftF1: 0.7 }));
    expect(outcome.failures[0]).toMatch(/below floor/i);
  });

  it("fails when contract sanity already found a hard coverage bug", () => {
    const result = makeResult();
    result.contract_sanity.failures.push("Core field title prediction coverage 0.4 is below the hard floor 0.6.");
    const outcome = evaluateBenchmarkGate(result);
    expect(outcome.failures).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/coverage/i),
      ]),
    );
  });

  it("warns (not fails) when normalized citation exact-match is below floor", () => {
    const result = makeResult();
    const clean = result.partitions.find((partition) => partition.partition === "clean");
    if (!clean) {
      throw new Error("Expected clean partition in benchmark fixture.");
    }
    clean.topline.normalized_citation_exact_match_rate = 0;
    clean.topline.normalized_citation_exact_match_compared = 1;

    const outcome = evaluateBenchmarkGate(result);

    expect(outcome.failures).toEqual([]);
    expect(outcome.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/normalized citation exact-match rate/i),
      ]),
    );
  });

  it("does not warn when normalized citation exact-match stays above the calibrated clean floor", () => {
    const result = makeResult();
    const clean = result.partitions.find((partition) => partition.partition === "clean");
    if (!clean) {
      throw new Error("Expected clean partition in benchmark fixture.");
    }
    clean.topline.normalized_citation_exact_match_rate = 0.0267;
    clean.topline.normalized_citation_exact_match_compared = 1200;

    const outcome = evaluateBenchmarkGate(result);

    expect(outcome.warnings).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/normalized citation exact-match rate/i),
      ]),
    );
  });

  it("fails when runtime guardrails exceed hard ceilings", () => {
    const result = makeResult();
    result.runtime_metrics = {
      measurement_basis: "wall_clock",
      wall_clock_ms: 1000,
      prediction_count: 100,
      throughput_refs_per_sec: 100,
      cpu_user_ms: 400,
      cpu_system_ms: 50,
      provider_call_count: 0,
      stage_totals_ms: {},
      worker_stats: [],
      slow_chunks: [],
      slow_rows: [],
      gc_stats: {
        total_collections: 0,
        total_duration_ms: 0,
        max_pause_ms: 300,
      },
      memory_stats: {
        rss_start_bytes: 1024,
        rss_end_bytes: 2048,
        rss_peak_bytes: 4 * 1024 * 1024 * 1024,
        heap_used_start_bytes: 512,
        heap_used_end_bytes: 768,
        heap_used_peak_bytes: 1024,
      },
      throughput_decay: {
        sample_count: 4,
        initial_refs_per_sec: 100,
        final_refs_per_sec: 70,
        decline_ratio: 0.3,
      },
      worker_imbalance: {
        worker_count: 2,
        prediction_count_ratio: 1.1,
        wall_clock_ratio: 2.4,
        throughput_ratio: 1.2,
      },
    };

    const outcome = evaluateBenchmarkGate(result);

    expect(outcome.failures).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/RSS peak/i),
        expect.stringMatching(/GC max pause/i),
        expect.stringMatching(/throughput decay/i),
        expect.stringMatching(/wall-clock imbalance/i),
      ]),
    );
    expect(outcome.runtimeGuardrails.failures).toHaveLength(4);
  });

  it("fails when performance regresses beyond the baseline tolerance", () => {
    const baseline = makeResult({ cleanMacroSoftF1: 0.9, cleanInstanceSoftF1: 0.6 });
    const outcome = evaluateBenchmarkGate(
      makeResult({ cleanMacroSoftF1: 0.89, cleanInstanceSoftF1: 0.58 }),
      baseline,
    );

    expect(outcome.failures).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/regressed/i),
      ]),
    );
    expect(outcome.baseline?.macroSoftF1Delta).toBe(-0.01);
  });

  it("fails when clean required-field completeness regresses against baseline", () => {
    const baseline = makeResult({ cleanRequiredCompleteness: 0.95 });
    const outcome = evaluateBenchmarkGate(
      makeResult({ cleanRequiredCompleteness: 0.9 }),
      baseline,
    );

    expect(outcome.failures).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/required-field completeness/i),
      ]),
    );
    expect(outcome.baseline?.topline.requiredFieldCompletenessDelta).toBe(-0.05);
  });
});
