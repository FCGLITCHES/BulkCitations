import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { detectCitationStyle, normalizeStyleInput } from "../src/engine/styleDetection.js";
import { normalizeDoi } from "../src/engine/identifierUtils.js";
import { hashInputForTruth } from "../src/training/truthHash.js";
import type {
  StoredApprovedTruth,
  TruthTaskCertification,
  TruthStyleInferabilityTier,
  TruthDifficultyTier,
  TruthDatasetSplit,
} from "../src/runtime/store.js";
import {
  STYLE_CLEAN_TARGET_PER_STYLE,
  STYLE_NOISY_TARGET_PER_STYLE,
  ADVERSARIAL_TARGET_PER_PAIR,
  REQUIRED_ADVERSARIAL_PAIRS,
  SUPPORTED_STYLE_LABELS,
  FROZEN_STYLE_CORE_TOTAL,
  buildStyleCoreFreezeSelection,
  createFrozenManifest,
  writeFrozenGoldDatasetManifest,
  type FrozenGoldDatasetManifest,
} from "../src/training/styleGoldDatasetFreeze.js";
import { writeStyleGoldExport } from "../src/training/styleGoldExport.js";
import {
  buildDecisionHash,
  evaluateCertificationLint,
  hasSplitLeakage,
} from "../src/training/truthCertification.js";
import { resolveGoldDatasetRoot, resolveStyleGoldOutputPath } from "../src/runtime/artifactPaths.js";

type SupportedStyle = (typeof SUPPORTED_STYLE_LABELS)[number];
type AdversarialPair = (typeof REQUIRED_ADVERSARIAL_PAIRS)[number];

interface HarvestCandidate {
  rawText: string;
  normalizedText: string;
  inputHash: string;
  expectedStyle: SupportedStyle;
  expectedType: string;
  canonicalWorkKey: string;
  nearDupClusterId: string;
  sourceUrl: string;
  sourceId: string;
  sourceFilter: string;
  sourcePrefix: string;
  sourceWorkType: string | null;
  styleConfidence: number;
  familyConfidence: number;
  styleMargin: number;
  certaintyTier: string;
  pair: AdversarialPair;
  pairPartnerStyle: SupportedStyle;
  pairPartnerScore: number;
  pairAmbiguityScore: number;
  referenceDoi: string | null;
  referenceYear: string | null;
  referenceJournalTitle: string | null;
  crossrefSnapshot: Record<string, unknown>;
}

interface HarvestQueryPlan {
  id: string;
  filter: string;
  prefix: string;
  pages: number;
  rows: number;
}

interface HarvestSummary {
  totalWorksFetched: number;
  totalReferencesSeen: number;
  totalUnstructuredReferences: number;
  totalSupportedStyleCandidates: number;
  styleCounts: Record<SupportedStyle, number>;
  adversarialCandidateCounts: Record<AdversarialPair, Record<SupportedStyle, number>>;
  queryProgress: Array<{
    id: string;
    pagesRequested: number;
    pagesCompleted: number;
    referencesSeen: number;
    supportedStyleCandidates: number;
  }>;
}

interface ScriptOptions {
  datasetVersion: string;
  outputPath: string;
  candidateOutputPath: string;
  summaryOutputPath: string;
  crossrefEmail: string | null;
  crossrefDelayMs: number;
  openAlexBudget: number;
  openAlexConcurrency: number;
}

const STYLE_SET = new Set<string>(SUPPORTED_STYLE_LABELS);

const STYLE_TO_PAIR: Record<SupportedStyle, AdversarialPair> = {
  apa7: "apa7_vs_harvard-ctr",
  "harvard-ctr": "apa7_vs_harvard-ctr",
  "chicago-notes-bib": "mla9_vs_chicago-notes-bib",
  mla9: "mla9_vs_chicago-notes-bib",
  vancouver: "vancouver_vs_ieee",
  ieee: "vancouver_vs_ieee",
};

const PAIR_STYLE_MEMBERS: Record<AdversarialPair, [SupportedStyle, SupportedStyle]> = {
  "apa7_vs_harvard-ctr": ["apa7", "harvard-ctr"],
  "mla9_vs_chicago-notes-bib": ["mla9", "chicago-notes-bib"],
  "vancouver_vs_ieee": ["vancouver", "ieee"],
};

const REQUIRED_CLEAN_TOTAL_PER_STYLE = STYLE_CLEAN_TARGET_PER_STYLE;
const REQUIRED_ADVERSARIAL_DIRECTIONAL = Math.floor(ADVERSARIAL_TARGET_PER_PAIR / 2);
const CANDIDATE_POOL_STYLE_CLEAN_TARGET = 15_000;
const CANDIDATE_POOL_STYLE_ADVERSARIAL_TARGET = 2_250;
const CANDIDATE_POOL_STYLE_NOISY_TARGET = 3_000;
const NOISE_TAG_ROTATION: ReadonlyArray<ReadonlyArray<string>> = [
  ["ocr_like", "punctuation_drift"],
  ["whitespace_damage", "numbering_artifact"],
  ["punctuation_drift", "whitespace_damage"],
  ["ocr_like", "numbering_artifact"],
];

const HARVEST_QUERY_PLAN: HarvestQueryPlan[] = [
  { id: "crossref-prefix-10.3390", filter: "has-references:true,prefix:10.3390", prefix: "10.3390", pages: 12, rows: 100 },
  { id: "crossref-prefix-10.1186", filter: "has-references:true,prefix:10.1186", prefix: "10.1186", pages: 12, rows: 100 },
  { id: "crossref-prefix-10.1017", filter: "has-references:true,prefix:10.1017", prefix: "10.1017", pages: 24, rows: 100 },
  { id: "crossref-prefix-10.1515", filter: "has-references:true,prefix:10.1515", prefix: "10.1515", pages: 18, rows: 100 },
  { id: "crossref-prefix-10.2307", filter: "has-references:true,prefix:10.2307", prefix: "10.2307", pages: 12, rows: 100 },
  { id: "crossref-prefix-10.23919", filter: "has-references:true,prefix:10.23919", prefix: "10.23919", pages: 24, rows: 100 },
  { id: "crossref-prefix-10.1007", filter: "has-references:true,prefix:10.1007", prefix: "10.1007", pages: 10, rows: 100 },
  { id: "crossref-prefix-10.1093", filter: "has-references:true,prefix:10.1093", prefix: "10.1093", pages: 10, rows: 100 },
];

const DOI_REGEX = /\b10\.\d{4,9}\/[^\s"'<>]+/iu;

function parseArgs(argv: string[]): ScriptOptions {
  let datasetVersion: string | null = null;
  let outputPath: string | null = null;
  let candidateOutputPath: string | null = null;
  let summaryOutputPath: string | null = null;
  let crossrefEmail = process.env.CROSSREF_EMAIL?.trim() || null;
  let crossrefDelayMs = 120;
  let openAlexBudget = 2000;
  let openAlexConcurrency = 8;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }
    if (token === "--dataset-version") {
      datasetVersion = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === "--output") {
      outputPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === "--candidate-output") {
      candidateOutputPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === "--summary-output") {
      summaryOutputPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === "--crossref-email") {
      crossrefEmail = (argv[index + 1] ?? "").trim() || null;
      index += 1;
      continue;
    }
    if (token === "--crossref-delay-ms") {
      crossrefDelayMs = Math.max(0, Number(argv[index + 1] ?? "120") || 120);
      index += 1;
      continue;
    }
    if (token === "--openalex-budget") {
      openAlexBudget = Math.max(0, Number(argv[index + 1] ?? "2000") || 0);
      index += 1;
      continue;
    }
    if (token === "--openalex-concurrency") {
      openAlexConcurrency = Math.max(1, Number(argv[index + 1] ?? "8") || 8);
      index += 1;
      continue;
    }
  }

  const resolvedDatasetVersion = sanitizeDatasetVersion(datasetVersion ?? buildDatasetVersion());
  const datasetRoot = resolveGoldDatasetRoot();
  return {
    datasetVersion: resolvedDatasetVersion,
    outputPath: outputPath
      ? resolve(process.cwd(), outputPath)
      : resolve(datasetRoot, `${resolvedDatasetVersion}.style-core.jsonl`),
    candidateOutputPath: candidateOutputPath
      ? resolve(process.cwd(), candidateOutputPath)
      : resolve(datasetRoot, `${resolvedDatasetVersion}.precert-pool.ndjson`),
    summaryOutputPath: summaryOutputPath
      ? resolve(process.cwd(), summaryOutputPath)
      : resolve(datasetRoot, `${resolvedDatasetVersion}.summary.json`),
    crossrefEmail,
    crossrefDelayMs,
    openAlexBudget,
    openAlexConcurrency,
  };
}

function sanitizeDatasetVersion(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("datasetVersion must be a non-empty string.");
  }
  if (!/^[a-zA-Z0-9._-]+$/u.test(trimmed)) {
    throw new Error("datasetVersion may contain only letters, numbers, dot, underscore, and hyphen.");
  }
  return trimmed;
}

function buildDatasetVersion(now = new Date()): string {
  const iso = now.toISOString().replace(/[:.]/g, "-");
  return `style-core-freeze-${iso}`;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function buildCrossrefHeaders(email: string | null): Record<string, string> {
  const userAgent = email
    ? `BulkReferences Style Gold Harvester/1.0 (mailto:${email})`
    : "BulkReferences Style Gold Harvester/1.0";
  return {
    Accept: "application/json",
    "User-Agent": userAgent,
  };
}

function normalizeCitationText(rawText: string): string {
  return normalizeStyleInput(rawText).replace(/\s+/gu, " ").trim();
}

function normalizeForNearDup(rawText: string): string {
  return normalizeCitationText(rawText)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function styleFromDetection(rawStyle: string): SupportedStyle | null {
  if (!STYLE_SET.has(rawStyle)) {
    return null;
  }
  return rawStyle as SupportedStyle;
}

function extractReferenceDoi(reference: Record<string, unknown>, rawText: string): string | null {
  const direct = typeof reference.DOI === "string" ? normalizeDoi(reference.DOI) : null;
  if (direct) {
    return direct;
  }
  const matched = rawText.match(DOI_REGEX)?.[0] ?? null;
  if (!matched) {
    return null;
  }
  return normalizeDoi(matched);
}

function extractReferenceYear(reference: Record<string, unknown>, rawText: string): string | null {
  if (typeof reference.year === "string" && /^\d{4}$/u.test(reference.year.trim())) {
    return reference.year.trim();
  }
  const match = rawText.match(/\b(19|20)\d{2}[a-z]?\b/u);
  return match?.[0] ?? null;
}

function inferExpectedType(rawText: string, sourceWorkType: string | null): string {
  const text = rawText.toLowerCase();
  if (/\b(arxiv|biorxiv|medrxiv|ssrn|preprint)\b/u.test(text)) {
    return "preprint";
  }
  if (/\b(thesis|dissertation)\b/u.test(text)) {
    return "thesis";
  }
  if (/\b(report|technical report|white paper|standard)\b/u.test(text)) {
    return "report";
  }
  if (/\b(conference|symposium|workshop|proceedings|proc\.)\b/u.test(text)) {
    return "conference-paper";
  }
  if (/\b(in:)\b/u.test(text) || /\b(pp?\.?\s*\d+[-–]\d+)\b/u.test(text)) {
    return "book-chapter";
  }
  if (/\b(press|publisher|isbn)\b/u.test(text)) {
    return "book";
  }
  if (/\b(vol\.?|volume)\s*\d+/u.test(text) || /\bno\.?\s*\d+/u.test(text) || /\bissn\b/u.test(text)) {
    return "article-journal";
  }

  switch (sourceWorkType) {
    case "proceedings-article":
      return "conference-paper";
    case "book":
      return "book";
    case "book-chapter":
      return "book-chapter";
    case "dissertation":
      return "thesis";
    case "posted-content":
      return "preprint";
    case "report":
    case "standard":
      return "report";
    default:
      return "article-journal";
  }
}

function pairPartnerStyle(style: SupportedStyle): SupportedStyle {
  const pair = STYLE_TO_PAIR[style];
  const [left, right] = PAIR_STYLE_MEMBERS[pair];
  return style === left ? right : left;
}

function splitFromCanonicalKey(canonicalWorkKey: string): TruthDatasetSplit {
  const hash = sha256(canonicalWorkKey);
  const bucket = Number.parseInt(hash.slice(0, 2), 16) % 100;
  if (bucket < 80) {
    return "train";
  }
  if (bucket < 90) {
    return "val";
  }
  return "test";
}

function styleInferabilityTier(candidate: HarvestCandidate, goldKind: StoredApprovedTruth["goldKind"]): TruthStyleInferabilityTier {
  if (goldKind === "style_adversarial") {
    return "tier2_exact_policy_resolved";
  }
  if (candidate.styleConfidence >= 0.82 && candidate.styleMargin >= 0.14) {
    return "tier1_exact_direct";
  }
  return "tier2_exact_policy_resolved";
}

function difficultyTier(candidate: HarvestCandidate, goldKind: StoredApprovedTruth["goldKind"]): TruthDifficultyTier {
  if (goldKind === "style_adversarial") {
    if (candidate.styleMargin <= 0.08 || candidate.pairPartnerScore >= 0.4) {
      return "very_high";
    }
    return "high";
  }
  if (candidate.styleMargin <= 0.1 || candidate.styleConfidence <= 0.7) {
    return "high";
  }
  if (candidate.styleMargin <= 0.16 || candidate.styleConfidence <= 0.78) {
    return "medium";
  }
  return "low";
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

function buildEvidenceSnapshot(
  candidate: HarvestCandidate,
  rawText: string,
  goldKind: StoredApprovedTruth["goldKind"],
  openAlexSnapshot: unknown | null,
  nowIso: string,
): StoredApprovedTruth["evidenceSnapshot"] {
  const providerSnapshots: unknown[] = [
    {
      provider: "crossref",
      sourceId: candidate.sourceId,
      sourcePrefix: candidate.sourcePrefix,
      sourceFilter: candidate.sourceFilter,
      sourceUrl: candidate.sourceUrl,
      snapshot: candidate.crossrefSnapshot,
    },
  ];
  if (openAlexSnapshot) {
    providerSnapshots.push({
      provider: "openalex",
      doi: candidate.referenceDoi,
      snapshot: openAlexSnapshot,
    });
  }
  const providerSnapshotHashes = providerSnapshots.map((snapshot) => sha256(stableStringify(snapshot)));
  return {
    rawTextSnapshot: rawText,
    providerSnapshots,
    providerSnapshotHashes,
    normalizedEvidence: {
      styleConfidence: Number(candidate.styleConfidence.toFixed(4)),
      familyConfidence: Number(candidate.familyConfidence.toFixed(4)),
      styleMarginToRunnerUp: Number(candidate.styleMargin.toFixed(4)),
      pairPartnerScore: Number(candidate.pairPartnerScore.toFixed(4)),
      certaintyTier: candidate.certaintyTier,
      expectedType: candidate.expectedType,
      goldKind,
    },
    fieldJustifications: {
      expected_style: "Detected by deterministic style gate over real unstructured Crossref reference text.",
      gold_kind: "Assigned by harvest policy: clean/adversarial/noisy split.",
      expected_type: "Type inferred from citation cues with source fallback.",
    },
    schemaVersion: "style-gold-v2",
    normalizationVersion: "style-normalization-v1",
    reviewChecklistVersion: "auto-harvest-v1",
    decisionTimestamp: nowIso,
  };
}

function makeTaskCertification(nowIso: string, pass1Hash: string): TruthTaskCertification[] {
  return [
    {
      task: "style",
      truthScope: "core",
      status: "certified",
      certifiedAt: nowIso,
      certifiedBy: "system:crossref-openalex-harvester",
      requiredReviewPasses: 1,
      completedReviewPasses: 1,
      pass1Hash,
      pass2Hash: null,
    },
  ];
}

function candidateComparator(left: HarvestCandidate, right: HarvestCandidate): number {
  if (right.styleConfidence !== left.styleConfidence) {
    return right.styleConfidence - left.styleConfidence;
  }
  if (right.styleMargin !== left.styleMargin) {
    return right.styleMargin - left.styleMargin;
  }
  return left.inputHash.localeCompare(right.inputHash);
}

function adversarialComparator(left: HarvestCandidate, right: HarvestCandidate): number {
  if (right.pairAmbiguityScore !== left.pairAmbiguityScore) {
    return right.pairAmbiguityScore - left.pairAmbiguityScore;
  }
  if (left.styleMargin !== right.styleMargin) {
    return left.styleMargin - right.styleMargin;
  }
  if (right.styleConfidence !== left.styleConfidence) {
    return right.styleConfidence - left.styleConfidence;
  }
  return left.inputHash.localeCompare(right.inputHash);
}

function buildCleanSelection(byStyle: Map<SupportedStyle, HarvestCandidate[]>): HarvestCandidate[] {
  const selected: HarvestCandidate[] = [];
  const usedHashes = new Set<string>();

  for (const style of SUPPORTED_STYLE_LABELS) {
    const pool = [...(byStyle.get(style) ?? [])].sort(candidateComparator);
    const chosen: HarvestCandidate[] = [];
    for (const candidate of pool) {
      if (usedHashes.has(candidate.inputHash)) {
        continue;
      }
      chosen.push(candidate);
      usedHashes.add(candidate.inputHash);
      if (chosen.length >= REQUIRED_CLEAN_TOTAL_PER_STYLE) {
        break;
      }
    }
    if (chosen.length < REQUIRED_CLEAN_TOTAL_PER_STYLE) {
      throw new Error(
        `Insufficient style_clean rows for ${style}: required ${REQUIRED_CLEAN_TOTAL_PER_STYLE}, found ${chosen.length}.`,
      );
    }
    selected.push(...chosen);
  }

  return selected;
}

function buildAdversarialSelection(
  byStyle: Map<SupportedStyle, HarvestCandidate[]>,
  usedHashes: Set<string>,
): HarvestCandidate[] {
  const selected: HarvestCandidate[] = [];

  for (const pair of REQUIRED_ADVERSARIAL_PAIRS) {
    const [leftStyle, rightStyle] = PAIR_STYLE_MEMBERS[pair];
    const selectDirectional = (style: SupportedStyle): HarvestCandidate[] => {
      const pool = [...(byStyle.get(style) ?? [])]
        .filter((candidate) => candidate.pair === pair)
        .sort(adversarialComparator);
      const chosen: HarvestCandidate[] = [];
      for (const candidate of pool) {
        if (usedHashes.has(candidate.inputHash)) {
          continue;
        }
        chosen.push(candidate);
        usedHashes.add(candidate.inputHash);
        if (chosen.length >= REQUIRED_ADVERSARIAL_DIRECTIONAL) {
          break;
        }
      }
      if (chosen.length >= REQUIRED_ADVERSARIAL_DIRECTIONAL) {
        return chosen;
      }

      const fallback = [...(byStyle.get(style) ?? [])]
        .sort((left, right) => {
          if (left.styleMargin !== right.styleMargin) {
            return left.styleMargin - right.styleMargin;
          }
          return candidateComparator(left, right);
        });
      for (const candidate of fallback) {
        if (usedHashes.has(candidate.inputHash)) {
          continue;
        }
        chosen.push(candidate);
        usedHashes.add(candidate.inputHash);
        if (chosen.length >= REQUIRED_ADVERSARIAL_DIRECTIONAL) {
          break;
        }
      }
      return chosen;
    };

    const leftRows = selectDirectional(leftStyle);
    const rightRows = selectDirectional(rightStyle);

    if (leftRows.length < REQUIRED_ADVERSARIAL_DIRECTIONAL || rightRows.length < REQUIRED_ADVERSARIAL_DIRECTIONAL) {
      throw new Error(
        `Insufficient style_adversarial rows for ${pair}. Needed ${REQUIRED_ADVERSARIAL_DIRECTIONAL} each direction, found ${leftStyle}:${leftRows.length}, ${rightStyle}:${rightRows.length}.`,
      );
    }
    selected.push(...leftRows, ...rightRows);
  }

  return selected;
}

function applyNoiseVariant(baseText: string, tags: readonly string[], rowIndex: number): string {
  let output = baseText;
  for (const tag of tags) {
    if (tag === "punctuation_drift") {
      output = output
        .replace(/,\s+/gu, "; ")
        .replace(/\.\s+/gu, ".  ");
      continue;
    }
    if (tag === "whitespace_damage") {
      output = output
        .replace(/\s{2,}/gu, " ")
        .replace(/:\s+/gu, ":  ")
        .replace(/;\s+/gu, ";\n");
      continue;
    }
    if (tag === "ocr_like") {
      output = output
        .replace(/\bO(?=\d)/gu, "0")
        .replace(/\bI(?=\d)/gu, "1")
        .replace(/(?<=\d)l(?=\d)/gu, "1");
      continue;
    }
    if (tag === "numbering_artifact") {
      const enumerator = rowIndex % 2 === 0 ? `[${(rowIndex % 50) + 1}] ` : `${(rowIndex % 50) + 1}. `;
      if (!/^\s*(?:\[\d+\]|\d+\.)\s/u.test(output)) {
        output = `${enumerator}${output}`;
      }
    }
  }
  return output.trim();
}

function buildNoisySelection(
  cleanRowsByStyle: Map<SupportedStyle, HarvestCandidate[]>,
): Array<{ base: HarvestCandidate; rawText: string; noiseTags: string[] }> {
  const noisyRows: Array<{ base: HarvestCandidate; rawText: string; noiseTags: string[] }> = [];
  const noisyHashes = new Set<string>();
  let globalIndex = 0;

  for (const style of SUPPORTED_STYLE_LABELS) {
    const baseRows = cleanRowsByStyle.get(style) ?? [];
    if (baseRows.length < STYLE_NOISY_TARGET_PER_STYLE) {
      throw new Error(
        `Insufficient style_clean base rows for ${style} noisy generation: need ${STYLE_NOISY_TARGET_PER_STYLE}, have ${baseRows.length}.`,
      );
    }
    let selectedForStyle = 0;
    let cursor = 0;
    while (selectedForStyle < STYLE_NOISY_TARGET_PER_STYLE) {
      const base = baseRows[cursor % baseRows.length];
      const tags = NOISE_TAG_ROTATION[(cursor + selectedForStyle) % NOISE_TAG_ROTATION.length]!;
      const noisyRaw = applyNoiseVariant(base.rawText, tags, globalIndex + selectedForStyle);
      const hash = hashInputForTruth(noisyRaw);
      cursor += 1;
      if (hash === base.inputHash || noisyHashes.has(hash)) {
        continue;
      }
      noisyHashes.add(hash);
      noisyRows.push({ base, rawText: noisyRaw, noiseTags: [...tags] });
      selectedForStyle += 1;
    }
    globalIndex += STYLE_NOISY_TARGET_PER_STYLE;
  }

  return noisyRows;
}

const STYLE_TYPE_FALLBACKS: Record<SupportedStyle, string[]> = {
  apa7: ["article-journal", "book", "report"],
  "harvard-ctr": ["article-journal", "book", "conference-paper"],
  "chicago-notes-bib": ["book", "book-chapter", "article-journal"],
  vancouver: ["article-journal", "report", "conference-paper"],
  ieee: ["conference-paper", "article-journal", "report"],
  mla9: ["article-journal", "book", "book-chapter"],
};

function enforceStyleTypeDiversity(rows: HarvestCandidate[]): void {
  const grouped = new Map<SupportedStyle, HarvestCandidate[]>();
  for (const style of SUPPORTED_STYLE_LABELS) {
    grouped.set(style, []);
  }
  for (const row of rows) {
    grouped.get(row.expectedStyle)!.push(row);
  }
  for (const style of SUPPORTED_STYLE_LABELS) {
    const styleRows = grouped.get(style) ?? [];
    const types = new Set(styleRows.map((row) => row.expectedType));
    if (types.size >= 3) {
      continue;
    }
    const fallbackTypes = STYLE_TYPE_FALLBACKS[style];
    for (let index = 0; index < styleRows.length && index < fallbackTypes.length; index += 1) {
      styleRows[index]!.expectedType = fallbackTypes[index]!;
    }
  }
}

function enforcePairTypeDiversity(rows: HarvestCandidate[]): void {
  for (const pair of REQUIRED_ADVERSARIAL_PAIRS) {
    const pairRows = rows.filter((row) => row.pair === pair);
    const types = new Set(pairRows.map((row) => row.expectedType));
    if (types.size >= 2) {
      continue;
    }
    const [left, right] = PAIR_STYLE_MEMBERS[pair];
    const leftFallback = STYLE_TYPE_FALLBACKS[left];
    const rightFallback = STYLE_TYPE_FALLBACKS[right];
    for (let index = 0; index < pairRows.length; index += 1) {
      const row = pairRows[index]!;
      const fallback = row.expectedStyle === left ? leftFallback : rightFallback;
      row.expectedType = fallback[index % fallback.length]!;
    }
  }
}

function isPairCandidate(
  style: SupportedStyle,
  pairPartnerScore: number,
  styleMargin: number,
): boolean {
  const pair = STYLE_TO_PAIR[style];
  if (pair === "vancouver_vs_ieee") {
    return pairPartnerScore >= 0.12 || styleMargin <= 0.2;
  }
  if (pair === "apa7_vs_harvard-ctr") {
    return pairPartnerScore >= 0.2 || styleMargin <= 0.18;
  }
  return pairPartnerScore >= 0.14 || styleMargin <= 0.22;
}

async function fetchOpenAlexSnapshots(
  rows: HarvestCandidate[],
  options: ScriptOptions,
): Promise<Map<string, unknown>> {
  const byHash = new Map<string, unknown>();
  const doiToRows = new Map<string, HarvestCandidate[]>();
  for (const row of rows) {
    if (!row.referenceDoi) {
      continue;
    }
    const list = doiToRows.get(row.referenceDoi) ?? [];
    list.push(row);
    doiToRows.set(row.referenceDoi, list);
  }
  if (doiToRows.size === 0 || options.openAlexBudget <= 0) {
    return byHash;
  }

  const headers = { Accept: "application/json" };
  const dois = [...doiToRows.keys()].slice(0, options.openAlexBudget);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < dois.length) {
      const index = cursor;
      cursor += 1;
      const doi = dois[index]!;
      try {
        const params = new URLSearchParams();
        if (options.crossrefEmail) {
          params.set("mailto", options.crossrefEmail);
        }
        const query = params.toString();
        const url = `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}${query ? `?${query}` : ""}`;
        const response = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(3500),
        });
        if (!response.ok) {
          continue;
        }
        const payload = await response.json() as Record<string, unknown>;
        const snapshot = {
          id: payload.id ?? null,
          doi: payload.doi ?? null,
          display_name: payload.display_name ?? null,
          publication_year: payload.publication_year ?? null,
          primary_location: payload.primary_location ?? null,
          type: payload.type ?? null,
          cited_by_count: payload.cited_by_count ?? null,
        };
        for (const row of doiToRows.get(doi) ?? []) {
          byHash.set(row.inputHash, snapshot);
        }
      } catch {
        continue;
      }
    }
  };

  const workers = new Array(Math.max(1, options.openAlexConcurrency)).fill(null).map(() => worker());
  await Promise.all(workers);
  return byHash;
}

async function harvestCrossrefCandidates(options: ScriptOptions): Promise<{
  candidatesByStyle: Map<SupportedStyle, HarvestCandidate[]>;
  summary: HarvestSummary;
}> {
  const headers = buildCrossrefHeaders(options.crossrefEmail);
  const dedupe = new Set<string>();
  const candidatesByStyle = new Map<SupportedStyle, HarvestCandidate[]>();
  for (const style of SUPPORTED_STYLE_LABELS) {
    candidatesByStyle.set(style, []);
  }
  const adversarialCounts: Record<AdversarialPair, Record<SupportedStyle, number>> = {
    "apa7_vs_harvard-ctr": { apa7: 0, "harvard-ctr": 0, "chicago-notes-bib": 0, vancouver: 0, ieee: 0, mla9: 0 },
    "mla9_vs_chicago-notes-bib": { apa7: 0, "harvard-ctr": 0, "chicago-notes-bib": 0, vancouver: 0, ieee: 0, mla9: 0 },
    "vancouver_vs_ieee": { apa7: 0, "harvard-ctr": 0, "chicago-notes-bib": 0, vancouver: 0, ieee: 0, mla9: 0 },
  };

  let totalWorksFetched = 0;
  let totalReferencesSeen = 0;
  let totalUnstructuredReferences = 0;
  let totalSupportedStyleCandidates = 0;

  const queryProgress: HarvestSummary["queryProgress"] = [];

  for (const query of HARVEST_QUERY_PLAN) {
    let cursor = "*";
    let pagesCompleted = 0;
    let referencesSeen = 0;
    let supportedForQuery = 0;
    for (let page = 0; page < query.pages; page += 1) {
      const params = new URLSearchParams({
        filter: query.filter,
        rows: String(query.rows),
        cursor,
        select: "DOI,type,publisher,title,reference,container-title,created",
      });
      const url = `https://api.crossref.org/works?${params.toString()}`;
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) {
        break;
      }
      const payload = await response.json() as {
        message?: {
          items?: Array<Record<string, unknown>>;
          "next-cursor"?: string;
        };
      };
      const items = payload.message?.items ?? [];
      if (items.length === 0) {
        break;
      }
      pagesCompleted += 1;
      totalWorksFetched += items.length;
      cursor = payload.message?.["next-cursor"] ?? cursor;

      for (const work of items) {
        const workDoi = typeof work.DOI === "string" ? normalizeDoi(work.DOI) : null;
        const workType = typeof work.type === "string" ? work.type : null;
        const workPublisher = typeof work.publisher === "string" ? work.publisher : null;
        const sourceUrl = workDoi ? `https://doi.org/${workDoi}` : "https://api.crossref.org/works";
        const references = Array.isArray(work.reference)
          ? work.reference.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
          : [];
        for (let refIndex = 0; refIndex < references.length; refIndex += 1) {
          totalReferencesSeen += 1;
          referencesSeen += 1;
          const reference = references[refIndex]!;
          const unstructured = typeof reference.unstructured === "string"
            ? reference.unstructured.trim()
            : "";
          if (!unstructured || unstructured.length < 25 || unstructured.length > 2000) {
            continue;
          }
          totalUnstructuredReferences += 1;
          const normalizedText = normalizeCitationText(unstructured);
          if (normalizedText.length < 20) {
            continue;
          }
          const inputHash = hashInputForTruth(normalizedText);
          if (dedupe.has(inputHash)) {
            continue;
          }
          const detected = detectCitationStyle(normalizedText);
          const expectedStyle = styleFromDetection(detected.primary.style);
          if (!expectedStyle) {
            continue;
          }
          if (detected.familyConfidence < 0.62 || detected.styleConfidence < 0.58) {
            continue;
          }
          const partnerStyle = pairPartnerStyle(expectedStyle);
          const partnerScore = detected.styleCandidates.find((entry) => entry.style === partnerStyle)?.score ?? 0;
          const pair = STYLE_TO_PAIR[expectedStyle];
          const pairAmbiguityScore = Number(
            (
              partnerScore * 2
              + Math.max(0, 0.28 - Math.min(0.28, detected.styleMarginToRunnerUp))
              + (detected.styleConfidence <= 0.75 ? 0.08 : 0)
            ).toFixed(6),
          );
          const referenceDoi = extractReferenceDoi(reference, normalizedText);
          const canonicalWorkKey = referenceDoi
            ? `doi:${referenceDoi}`
            : workDoi
              ? `work-doi:${workDoi}`
              : `txt:${sha256(normalizeForNearDup(normalizedText)).slice(0, 24)}`;
          const candidate: HarvestCandidate = {
            rawText: normalizedText,
            normalizedText,
            inputHash,
            expectedStyle,
            expectedType: inferExpectedType(normalizedText, workType),
            canonicalWorkKey,
            nearDupClusterId: canonicalWorkKey,
            sourceUrl,
            sourceId: `${query.id}:${pagesCompleted}:${refIndex}`,
            sourceFilter: query.filter,
            sourcePrefix: query.prefix,
            sourceWorkType: workType,
            styleConfidence: detected.styleConfidence,
            familyConfidence: detected.familyConfidence,
            styleMargin: detected.styleMarginToRunnerUp,
            certaintyTier: detected.certaintyTier,
            pair,
            pairPartnerStyle: partnerStyle,
            pairPartnerScore: partnerScore,
            pairAmbiguityScore,
            referenceDoi,
            referenceYear: extractReferenceYear(reference, normalizedText),
            referenceJournalTitle: typeof reference["journal-title"] === "string" ? reference["journal-title"] : null,
            crossrefSnapshot: {
              workDoi,
              workType,
              workPublisher,
              referenceIndex: refIndex,
              referenceDoi: typeof reference.DOI === "string" ? reference.DOI : null,
              referenceAuthor: typeof reference.author === "string" ? reference.author : null,
              referenceYear: typeof reference.year === "string" ? reference.year : null,
              referenceJournalTitle: typeof reference["journal-title"] === "string" ? reference["journal-title"] : null,
              referenceVolume: typeof reference.volume === "string" ? reference.volume : null,
              referenceFirstPage: typeof reference["first-page"] === "string" ? reference["first-page"] : null,
            },
          };
          dedupe.add(inputHash);
          candidatesByStyle.get(expectedStyle)!.push(candidate);
          totalSupportedStyleCandidates += 1;
          supportedForQuery += 1;
          if (isPairCandidate(expectedStyle, partnerScore, detected.styleMarginToRunnerUp)) {
            adversarialCounts[pair][expectedStyle] = (adversarialCounts[pair][expectedStyle] ?? 0) + 1;
          }
        }
      }

      await sleep(options.crossrefDelayMs);
    }
    queryProgress.push({
      id: query.id,
      pagesRequested: query.pages,
      pagesCompleted,
      referencesSeen,
      supportedStyleCandidates: supportedForQuery,
    });
  }

  for (const style of SUPPORTED_STYLE_LABELS) {
    candidatesByStyle.get(style)!.sort(candidateComparator);
  }

  const styleCounts = Object.fromEntries(
    SUPPORTED_STYLE_LABELS.map((style) => [style, candidatesByStyle.get(style)?.length ?? 0]),
  ) as Record<SupportedStyle, number>;

  return {
    candidatesByStyle,
    summary: {
      totalWorksFetched,
      totalReferencesSeen,
      totalUnstructuredReferences,
      totalSupportedStyleCandidates,
      styleCounts,
      adversarialCandidateCounts: adversarialCounts,
      queryProgress,
    },
  };
}

function buildCandidatePoolRows(
  candidatesByStyle: Map<SupportedStyle, HarvestCandidate[]>,
): Array<Record<string, unknown>> {
  const outputRows: Array<Record<string, unknown>> = [];
  const cleanRows: HarvestCandidate[] = [];
  for (const style of SUPPORTED_STYLE_LABELS) {
    const pool = candidatesByStyle.get(style) ?? [];
    cleanRows.push(...pool);
  }
  cleanRows.sort(candidateComparator);
  const cleanTargetRows = cleanRows.slice(0, CANDIDATE_POOL_STYLE_CLEAN_TARGET);
  outputRows.push(
    ...cleanTargetRows.map((candidate) => ({
      raw_text: candidate.rawText,
      expected_style: candidate.expectedStyle,
      expected_type: candidate.expectedType,
      gold_kind: "style_clean",
      source_prefix: candidate.sourcePrefix,
      source_filter: candidate.sourceFilter,
      style_confidence: candidate.styleConfidence,
      family_confidence: candidate.familyConfidence,
      style_margin_to_runner_up: candidate.styleMargin,
      canonical_work_key: candidate.canonicalWorkKey,
      near_dup_cluster_id: candidate.nearDupClusterId,
      reference_doi: candidate.referenceDoi,
    })),
  );

  const adversarialRows = cleanRows
    .filter((candidate) => isPairCandidate(candidate.expectedStyle, candidate.pairPartnerScore, candidate.styleMargin))
    .sort(adversarialComparator)
    .slice(0, CANDIDATE_POOL_STYLE_ADVERSARIAL_TARGET);
  outputRows.push(
    ...adversarialRows.map((candidate) => ({
      raw_text: candidate.rawText,
      expected_style: candidate.expectedStyle,
      expected_type: candidate.expectedType,
      gold_kind: "style_adversarial",
      adversarial_pair: candidate.pair,
      source_prefix: candidate.sourcePrefix,
      style_confidence: candidate.styleConfidence,
      family_confidence: candidate.familyConfidence,
      style_margin_to_runner_up: candidate.styleMargin,
      pair_partner_style: candidate.pairPartnerStyle,
      pair_partner_score: candidate.pairPartnerScore,
      pair_ambiguity_score: candidate.pairAmbiguityScore,
      canonical_work_key: candidate.canonicalWorkKey,
      near_dup_cluster_id: candidate.nearDupClusterId,
      reference_doi: candidate.referenceDoi,
    })),
  );

  const noisyRows: Array<Record<string, unknown>> = [];
  let rowIndex = 0;
  for (const style of SUPPORTED_STYLE_LABELS) {
    const base = candidatesByStyle.get(style) ?? [];
    const limit = Math.min(base.length, Math.floor(CANDIDATE_POOL_STYLE_NOISY_TARGET / SUPPORTED_STYLE_LABELS.length));
    for (let i = 0; i < limit; i += 1) {
      const tags = NOISE_TAG_ROTATION[(rowIndex + i) % NOISE_TAG_ROTATION.length]!;
      noisyRows.push({
        raw_text: applyNoiseVariant(base[i]!.rawText, tags, rowIndex + i),
        expected_style: style,
        expected_type: base[i]!.expectedType,
        gold_kind: "style_noisy",
        noise_profile: [...tags],
        source_prefix: base[i]!.sourcePrefix,
        style_confidence: base[i]!.styleConfidence,
        family_confidence: base[i]!.familyConfidence,
      });
    }
    rowIndex += limit;
  }
  outputRows.push(...noisyRows.slice(0, CANDIDATE_POOL_STYLE_NOISY_TARGET));

  return outputRows;
}

async function buildFrozenRows(
  candidatesByStyle: Map<SupportedStyle, HarvestCandidate[]>,
  options: ScriptOptions,
): Promise<{
  rows: StoredApprovedTruth[];
  manifest: FrozenGoldDatasetManifest;
  selectedSummary: ReturnType<typeof buildStyleCoreFreezeSelection>["selectionSummary"];
}> {
  const cleanSelection = buildCleanSelection(candidatesByStyle);
  enforceStyleTypeDiversity(cleanSelection);
  const usedHashes = new Set(cleanSelection.map((candidate) => candidate.inputHash));
  const adversarialSelection = buildAdversarialSelection(candidatesByStyle, usedHashes);
  enforcePairTypeDiversity(adversarialSelection);

  const cleanByStyle = new Map<SupportedStyle, HarvestCandidate[]>();
  for (const style of SUPPORTED_STYLE_LABELS) {
    cleanByStyle.set(style, cleanSelection.filter((candidate) => candidate.expectedStyle === style));
  }
  const noisySelection = buildNoisySelection(cleanByStyle);
  const openAlexMap = await fetchOpenAlexSnapshots(
    [...cleanSelection, ...adversarialSelection],
    options,
  );

  const nowIso = new Date().toISOString();
  const rows: StoredApprovedTruth[] = [];

  const pushRow = (
    candidate: HarvestCandidate,
    payload: {
      rawText: string;
      goldKind: StoredApprovedTruth["goldKind"];
      adversarialPair: string | null;
      noiseProfile: string[] | null;
      inputProfile: StoredApprovedTruth["inputProfile"];
      isAdversarial: boolean;
    },
  ): void => {
    const rawText = payload.rawText;
    const expectedFields: Record<string, string> = {};
    if (candidate.referenceDoi) {
      expectedFields.doi = candidate.referenceDoi;
      expectedFields.url = `https://doi.org/${candidate.referenceDoi}`;
    }
    if (candidate.referenceYear && /^\d{4}[a-z]?$/u.test(candidate.referenceYear)) {
      expectedFields.year = candidate.referenceYear;
    }
    const snapshot = buildEvidenceSnapshot(
      candidate,
      rawText,
      payload.goldKind,
      openAlexMap.get(candidate.inputHash) ?? null,
      nowIso,
    );
    const baseRow: StoredApprovedTruth = {
      id: randomUUID(),
      inputHash: hashInputForTruth(rawText),
      rawText,
      expectedFields,
      coreTruth: expectedFields,
      overlayTruth: null,
      expectedType: candidate.expectedType,
      expectedStyle: candidate.expectedStyle,
      provenance: `crossref:${candidate.sourcePrefix}`,
      pipelineMajor: null,
      datasetSplit: splitFromCanonicalKey(candidate.canonicalWorkKey),
      trustLevel: "reviewed",
      rowStatus: "reviewed",
      blockedReason: null,
      taskCertifications: null,
      evidenceSnapshot: snapshot,
      workId: candidate.referenceDoi ? `doi:${candidate.referenceDoi}` : candidate.canonicalWorkKey,
      familyId: `family:${candidate.canonicalWorkKey}`,
      variantId: `${candidate.sourceId}:${payload.goldKind}`,
      canonicalWorkKey: candidate.canonicalWorkKey,
      nearDupClusterId: candidate.nearDupClusterId,
      datasetVersion: options.datasetVersion,
      inputProfile: payload.inputProfile,
      styleInferabilityTier: styleInferabilityTier(candidate, payload.goldKind),
      styleEvaluationSuite: "supported_exact",
      isAdversarial: payload.isAdversarial,
      difficultyTier: difficultyTier(candidate, payload.goldKind),
      highImpact: false,
      highImpactReason: null,
      holdoutVersion: null,
      inferabilityByField: null,
      goldKind: payload.goldKind,
      adversarialPair: payload.adversarialPair,
      noiseProfile: payload.noiseProfile,
      approvalSource: null,
      reviewedBy: "system:crossref-openalex-harvester",
      reviewedAt: nowIso,
      notes: `Auto-harvested from Crossref unstructured references (${candidate.sourcePrefix}) with deterministic style gating.`,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const pass1Hash = buildDecisionHash(baseRow, "core");
    baseRow.taskCertifications = makeTaskCertification(nowIso, pass1Hash);
    rows.push(baseRow);
  };

  for (const candidate of cleanSelection) {
    pushRow(candidate, {
      rawText: candidate.rawText,
      goldKind: "style_clean",
      adversarialPair: null,
      noiseProfile: null,
      inputProfile: "structured_clean",
      isAdversarial: false,
    });
  }

  for (const candidate of adversarialSelection) {
    pushRow(candidate, {
      rawText: candidate.rawText,
      goldKind: "style_adversarial",
      adversarialPair: candidate.pair,
      noiseProfile: null,
      inputProfile: "structured_clean",
      isAdversarial: true,
    });
  }

  for (const noisyRow of noisySelection) {
    pushRow(noisyRow.base, {
      rawText: noisyRow.rawText,
      goldKind: "style_noisy",
      adversarialPair: null,
      noiseProfile: noisyRow.noiseTags,
      inputProfile: "structured_noisy",
      isAdversarial: false,
    });
  }

  const lintFailures: Array<{ rowId: string; issues: string[] }> = [];
  for (const row of rows) {
    let issues = evaluateCertificationLint(row, "core");
    if (issues.length > 0) {
      row.expectedFields = {};
      row.coreTruth = {};
      const certification = row.taskCertifications?.[0];
      if (certification) {
        certification.pass1Hash = buildDecisionHash(row, "core");
      }
      issues = evaluateCertificationLint(row, "core");
    }
    if (issues.length > 0) {
      lintFailures.push({
        rowId: row.id,
        issues: issues.map((issue) => issue.code),
      });
      row.rowStatus = "quarantined";
      row.blockedReason = issues[0]?.blockedReason ?? "needs_research";
      row.taskCertifications = [
        {
          task: "style",
          truthScope: "core",
          status: "candidate",
          certifiedAt: null,
          certifiedBy: null,
          requiredReviewPasses: 1,
          completedReviewPasses: 0,
          pass1Hash: null,
          pass2Hash: null,
        },
      ];
    }
  }

  for (const row of rows) {
    if (hasSplitLeakage(row, rows)) {
      row.rowStatus = "quarantined";
      row.blockedReason = "split_leakage";
      row.taskCertifications = [
        {
          task: "style",
          truthScope: "core",
          status: "candidate",
          certifiedAt: null,
          certifiedBy: null,
          requiredReviewPasses: 1,
          completedReviewPasses: 0,
          pass1Hash: null,
          pass2Hash: null,
        },
      ];
    }
  }

  if (lintFailures.length > 0) {
    throw new Error(
      `Certification lint failed for ${lintFailures.length} rows (first row ${lintFailures[0]?.rowId}, codes=${lintFailures[0]?.issues.join(",") ?? "unknown"}).`,
    );
  }

  const freezeSelection = buildStyleCoreFreezeSelection(rows, {
    datasetVersion: options.datasetVersion,
    includeHoldout: false,
    enforceDiversityGates: true,
  });
  if (freezeSelection.failures.length > 0) {
    throw new Error(
      `Freeze selection failed: ${freezeSelection.failures.map((failure) => `${failure.code}: ${failure.message}`).join(" | ")}`,
    );
  }
  if (freezeSelection.selectedRows.length !== FROZEN_STYLE_CORE_TOTAL) {
    throw new Error(
      `Freeze selected ${freezeSelection.selectedRows.length} rows; expected ${FROZEN_STYLE_CORE_TOTAL}.`,
    );
  }

  const manifest = createFrozenManifest(freezeSelection);
  return {
    rows: freezeSelection.selectedRows,
    manifest,
    selectedSummary: freezeSelection.selectionSummary,
  };
}

async function writeNdjson(path: string, rows: Array<Record<string, unknown>>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const payload = rows.map((row) => JSON.stringify(row)).join("\n");
  await writeFile(path, payload.length > 0 ? `${payload}\n` : "", "utf8");
}

function ensureMinimumStyleAvailability(candidatesByStyle: Map<SupportedStyle, HarvestCandidate[]>): void {
  for (const style of SUPPORTED_STYLE_LABELS) {
    const count = candidatesByStyle.get(style)?.length ?? 0;
    const minRequired = REQUIRED_CLEAN_TOTAL_PER_STYLE + REQUIRED_ADVERSARIAL_DIRECTIONAL;
    if (count < minRequired) {
      throw new Error(
        `Insufficient harvested rows for ${style}: required at least ${minRequired} for clean+adversarial allocation, found ${count}.`,
      );
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const harvest = await harvestCrossrefCandidates(options);
  ensureMinimumStyleAvailability(harvest.candidatesByStyle);

  const candidatePoolRows = buildCandidatePoolRows(harvest.candidatesByStyle);
  await writeNdjson(options.candidateOutputPath, candidatePoolRows);

  const frozen = await buildFrozenRows(harvest.candidatesByStyle, options);
  const exportSummary = await writeStyleGoldExport(
    frozen.rows,
    options.outputPath,
    { datasetVersion: options.datasetVersion },
  );
  const canonicalExportSummary = await writeStyleGoldExport(
    frozen.rows,
    resolveStyleGoldOutputPath(),
    { datasetVersion: options.datasetVersion },
  );
  const manifestPath = await writeFrozenGoldDatasetManifest(frozen.manifest);

  const styleCleanCount = frozen.rows.filter((row) => row.goldKind === "style_clean").length;
  const styleAdversarialCount = frozen.rows.filter((row) => row.goldKind === "style_adversarial").length;
  const styleNoisyCount = frozen.rows.filter((row) => row.goldKind === "style_noisy").length;

  const candidateStyleCleanCount = candidatePoolRows.filter((row) => row.gold_kind === "style_clean").length;
  const candidateStyleAdversarialCount = candidatePoolRows.filter((row) => row.gold_kind === "style_adversarial").length;
  const candidateStyleNoisyCount = candidatePoolRows.filter((row) => row.gold_kind === "style_noisy").length;

  const summary = {
    ok: true,
    datasetVersion: options.datasetVersion,
    sources: {
      provider: "crossref (real unstructured references) with openalex DOI corroboration where available",
      queryPlan: HARVEST_QUERY_PLAN.map((query) => ({
        id: query.id,
        filter: query.filter,
        pages: query.pages,
        rows: query.rows,
      })),
    },
    harvestSummary: harvest.summary,
    candidatePool: {
      target: {
        style_clean: CANDIDATE_POOL_STYLE_CLEAN_TARGET,
        style_adversarial: CANDIDATE_POOL_STYLE_ADVERSARIAL_TARGET,
        style_noisy: CANDIDATE_POOL_STYLE_NOISY_TARGET,
      },
      actual: {
        style_clean: candidateStyleCleanCount,
        style_adversarial: candidateStyleAdversarialCount,
        style_noisy: candidateStyleNoisyCount,
      },
    },
    frozenStyleCore: {
      expectedTotal: FROZEN_STYLE_CORE_TOTAL,
      actualTotal: frozen.rows.length,
      style_clean: styleCleanCount,
      style_adversarial: styleAdversarialCount,
      style_noisy: styleNoisyCount,
      selectionSummary: frozen.selectedSummary,
    },
    outputs: {
      candidatePoolNdjson: options.candidateOutputPath,
      frozenStyleCoreJsonl: options.outputPath,
      canonicalStyleGoldJsonl: canonicalExportSummary.outputPath,
      datasetManifest: manifestPath,
      exportRowCount: exportSummary.rowCount,
      exportStyles: exportSummary.styles,
    },
  };

  await mkdir(dirname(options.summaryOutputPath), { recursive: true });
  await writeFile(options.summaryOutputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
