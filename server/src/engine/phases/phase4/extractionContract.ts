/**
 * Phase 4 extraction contract — TARGET CONTRACT, parity-locked.
 *
 * This file is the **typed seam** for the Phase 4 refactor described in
 * `docs/engine/phase4-refactor-seam.md`. It encodes the Field-Ownership Map
 * (`docs/engine/field-ownership-map.md`) as types so that:
 *
 *   - the deterministic resolvers, the BIO span provider, and enrichment each
 *     implement a stable interface instead of being interleaved inside the
 *     ~25k-line `phase4Extract.ts`;
 *   - the BIO track (separate workstream) has a concrete interface to build
 *     against — `BioSpanProvider` — without touching live extraction;
 *   - the tiered/residual execution model has a single decision point
 *     (`ResidualPolicy`) instead of scattered ML-routing branches.
 *
 * NOTHING HERE IS WIRED YET. It is types-only (no runtime export) and changes
 * no behavior. The refactor migrates `phase4Extract.ts` onto these interfaces
 * move-only, with output parity locked by the benchmark field/contract hashes,
 * and BIO does not become a primary producer until the real-data evidence gate
 * passes (per `docs/ml-system/ml-bio-engine-priority-plan-2026-04-30.md`).
 */

import type { CitationFeatures } from '../../types/extractionFeatures.js';
import type { ReferenceCarrier } from '../../types/carrier.js';
import type { StyleFamily } from '../../types/citation.js';

/** The three subsystems that can produce a field value. */
export type FieldOwner = 'deterministic' | 'bio' | 'enrichment';

/**
 * Producer precedence, aligned with the engine correction hierarchy
 * (admin_confirmed > provider_enriched > model_extracted > regex_fallback).
 * A higher number wins when two producers disagree, subject to the per-owner
 * confidence gates in {@link OwnerConfidencePolicy}.
 */
export const OWNER_PRECEDENCE: Record<FieldOwner, number> = {
  enrichment: 3, // provider_enriched (only when >= 0.85 and > existing)
  bio: 2, // model_extracted
  deterministic: 1, // regex_fallback (authoritative for identifiers via checksum)
};

/** Every field Phase 4 can populate, grouped by its authoritative owner. */
export type ExtractableField =
  | 'authors'
  | 'title'
  | 'journal'
  | 'doi'
  | 'url'
  | 'isbn'
  | 'issn'
  | 'pmid'
  | 'arxiv'
  | 'handle'
  | 'patentNumber'
  | 'year'
  | 'volume'
  | 'issue'
  | 'pages'
  | 'publisher'
  | 'bookTitle'
  | 'conferenceTitle'
  | 'edition'
  | 'placeOfPublication'
  | 'thesisType'
  | 'institution'
  | 'repository'
  | 'siteName';

/**
 * The Field-Ownership Map as code. This is the single source of truth the
 * refactor and the gold-dataset effort both key off. See the doc for rationale.
 */
export const FIELD_OWNERSHIP: Record<ExtractableField, FieldOwner> = {
  // Tier 1 — deterministic owns all identifiers + structured locators.
  doi: 'deterministic',
  url: 'deterministic',
  isbn: 'deterministic',
  issn: 'deterministic',
  pmid: 'deterministic',
  arxiv: 'deterministic',
  handle: 'deterministic',
  patentNumber: 'deterministic',
  year: 'deterministic',
  volume: 'deterministic',
  issue: 'deterministic',
  pages: 'deterministic',
  thesisType: 'deterministic',
  institution: 'deterministic',
  repository: 'deterministic',
  siteName: 'deterministic',
  // Tier 2 — BIO owns free-text span segmentation (data-gated; see plan).
  authors: 'bio',
  title: 'bio',
  journal: 'bio',
  // Tier 3 — enrichment owns canonical metadata, keyed on a Tier-1 identifier.
  publisher: 'enrichment',
  bookTitle: 'enrichment',
  conferenceTitle: 'enrichment',
  edition: 'enrichment',
  placeOfPublication: 'enrichment',
};

/** A single produced field value with provenance for the precedence merge. */
export interface ProducedField<T = string> {
  field: ExtractableField;
  value: T | null;
  owner: FieldOwner;
  confidence: number;
  /** Source span in the raw text, when the owner can attribute one. */
  span?: { start: number; end: number; text: string };
  /** Set when the owner declined to emit (e.g. checksum failed) — drives health. */
  abstained?: boolean;
}

// ---------------------------------------------------------------------------
// Tier 1 — Deterministic resolvers (already largely live as extractCitationFeatures)
// ---------------------------------------------------------------------------

/**
 * Deterministic resolution over the shared one-pass features. Identifiers are
 * checksum/format-validated here; a value that fails validation is emitted as
 * `abstained` rather than as a wrong value (see ISBN checksum gate, Step 2).
 */
export interface DeterministicResolver {
  resolve(features: CitationFeatures): ProducedField[];
}

/**
 * Resolved DOI field as Phase 4 consumes it: the value, its confidence, and the
 * span text. Returns `null` when no DOI was extracted (caller leaves the field
 * unset), mirroring the prior inline `if (relaxedDoi)` guard exactly.
 */
export interface ResolvedDoi {
  value: string;
  confidence: number;
  spanText: string;
}

/**
 * DOI-first slice of the deterministic resolver. Replicates byte-for-byte the
 * inline logic previously in `phase4Extract.ts`:
 *   - value  = features.identifiers.doi.normalized (the "relaxed" DOI)
 *   - confidence = recovered ? 0.72 : 0.98 (OCR-recovered DOIs stay below the
 *     0.85 enrichment-overwrite floor and remain provider-correctable)
 *   - spanText = features.identifiers.doi.raw (the "strict" match) ?? value
 * Returns null when there is no normalized DOI, so the caller leaves the field
 * unset (identical to the prior `if (relaxedDoi)` skip).
 */
export function resolveDoi(features: CitationFeatures): ResolvedDoi | null {
  const relaxedDoi = features.identifiers.doi.normalized;
  if (!relaxedDoi) return null;
  const strictDoiMatch = features.identifiers.doi.raw;
  return {
    value: relaxedDoi,
    confidence: features.identifiers.doi.recovered ? 0.72 : 0.98,
    spanText: strictDoiMatch ?? relaxedDoi,
  };
}

// ---------------------------------------------------------------------------
// Tier 2 — BIO span provider (the seam the BIO workstream implements)
// ---------------------------------------------------------------------------

export interface BioSpanRequest {
  raw: string;
  family: StyleFamily;
  /** Fields Tier 1 already resolved with high confidence — BIO may skip these. */
  resolved: ReadonlySet<ExtractableField>;
}

export interface BioSpanResult {
  spans: ProducedField[];
  /** Sequence-level diagnostics so Phase 10 can score real BIO errors. */
  diagnostics?: {
    overlappingSpans: number;
    unclosedSequences: number;
    missingRequiredSpans: ExtractableField[];
  };
}

/**
 * The single place BIO plugs in. Today this maps to the inline ML routing in
 * `phase4Extract.ts`; after the refactor it is one injected dependency, mode-gated
 * (`heuristic` | `shadow` | `primary`) exactly as the current routing config is.
 */
export interface BioSpanProvider {
  tagSpans(request: BioSpanRequest): Promise<BioSpanResult>;
}

// ---------------------------------------------------------------------------
// Tiered / residual execution policy
// ---------------------------------------------------------------------------

/**
 * Decides whether a carrier needs Tier-2 BIO after Tier-1. This is the lever
 * that keeps throughput up: clean refs with confident spans skip BIO entirely
 * and stay on the deterministic fast path. Concrete thresholds are an open
 * decision pending the Step 0 baseline + real BIO data.
 */
export interface ResidualPolicy {
  needsBioResidual(carrier: ReferenceCarrier, features: CitationFeatures): boolean;
}

/** Per-owner confidence gating used by the precedence merge. */
export interface OwnerConfidencePolicy {
  /** Enrichment only overwrites when >= this and strictly greater than existing. */
  readonly enrichmentOverwriteFloor: number; // 0.85, never overwrites admin_confirmed
  /** Below this per-field floor, BIO abstains (emits needs_action, no value). */
  bioAbstainFloor(field: ExtractableField): number;
}

/**
 * Merge produced fields by {@link OWNER_PRECEDENCE}, applying the confidence
 * gates. This replaces the current opaque "selective patching" block in
 * `phase4Extract.ts` with one auditable function.
 */
export interface FieldMerger {
  merge(produced: ProducedField[], policy: OwnerConfidencePolicy): ProducedField[];
}
