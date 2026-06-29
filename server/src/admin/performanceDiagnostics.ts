import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import type { ConvertRequest, ConvertResponse } from '../engine/types/api.js';
import type { CitationStyle } from '../engine/types/citation.js';
import type { ParseProfile } from '../engine/types/parseProfile.js';
import type {
  PipelineRuntimeProfile,
  ProcessingPath,
  ProviderUsage,
  StageRunRecord,
} from '../engine/types/pipeline.js';
import { phase1Ingest } from '../engine/phases/phase1Ingest.js';
import { phase2Split } from '../engine/phases/phase2Split.js';
import { createPipelineDependencies } from '../pipeline/dependencies.js';
import { createPipelineContext, runConvertPipeline } from '../pipeline/orchestrator.js';
import { resolvePipelineRuntimeProfile } from '../pipeline/runtimeProfiles.js';
import { listApprovedTruth } from '../runtime/persistence.js';
import type { StoredApprovedTruth, TruthScope, TruthTask } from '../runtime/store.js';
import { effectiveRowStatus, isTaskCertified, withLegacyCertification } from '../training/truthCertification.js';

type QualityPayload = Pick<ConvertResponse, 'references' | 'summary'> & Partial<Pick<ConvertResponse, 'providerUsage'>>;

export type AdminPerformanceDiagnosticFixture = 'numbered_mixed_style_smoke';

export interface AdminPerformanceDiagnosticInput {
  content?: string | undefined;
  fixture?: AdminPerformanceDiagnosticFixture | undefined;
  sourceType: ConvertRequest['sourceType'];
  outputStyle: CitationStyle;
  parseProfile: ParseProfile;
  runtimeProfile: PipelineRuntimeProfile;
}

export interface AdminPerformanceDiagnosticReport {
  id: string;
  generatedAt: string;
  input: InputSummary;
  config: {
    sourceType: ConvertRequest['sourceType'];
    outputStyle: CitationStyle;
    parseProfile: ParseProfile;
    runtimeProfile: PipelineRuntimeProfile;
  };
  baselineRun: DirectRunSummary;
  measuredRun: DirectRunSummary;
  approvedTruth: ApprovedTruthDiagnosticSummary;
  qualityComparison: QualityComparison;
  performanceValid: boolean;
  conclusions: string[];
}

interface InputSummary {
  label: string;
  sha256: string;
  rawInputBytes: number;
  rawInputChars: number;
  lineCount: number;
  nonEmptyLineCount: number;
  numberedLineCount: number;
  inspectedReferenceCount: number;
  inspectedDetectedFormat: string;
  inspectedStructure: string;
  inspectedSplitQualityFlag: string;
}

interface DirectRunSummary {
  layer: 'direct_engine';
  label: string;
  repeatIndex: number;
  parseProfile: ParseProfile;
  runtimeProfile: PipelineRuntimeProfile;
  runtimeTuning: {
    batchSize: number;
    maxConcurrency: number;
    fastLaneMulticoreMinRefs: number | null;
  };
  wallClockMs: number;
  refsPerSecond: number;
  responseStringifyMs: number;
  responseBytes: number;
  responseSha256: string;
  renderedTextSha256: string;
  quality: QualitySummary;
  executionProfile: ParseProfile;
  coreParseLatencyMs: number;
  referenceCount: number;
  countAudit: ConvertResponse['countAudit'];
  summary: ConvertResponse['summary'];
  providerUsage: ProviderUsage;
  stageTotalsMs: Record<string, number>;
  stageTimings: ProcessingPath['stageTimings'];
  diagnosticRecordCount: number;
  diagnosticDetails: DiagnosticDetail[];
  slowestReferences: Array<{
    index: number;
    outputLatencyMs: number;
    publicStatus: string;
    referenceType: string;
    rawPreview: string;
  }>;
}

interface DiagnosticDetail {
  phaseId: string;
  stageId: string;
  status: string;
  durationMs: number;
  message: string | null;
  details: Record<string, unknown> | null;
}

interface QualitySummary {
  version: 1;
  referenceCount: number;
  splitHash: string;
  fieldHash: string;
  renderedHash: string;
  semanticHash: string;
  contractHash: string;
  failedCount: number;
  emptyRenderedCount: number;
  needsReviewCount: number;
  needsActionCount: number;
  criticalFieldPresence: Record<string, number>;
  providerUsage: ProviderUsage | null;
  referenceFingerprints: QualityReferenceFingerprint[];
}

interface QualityReferenceFingerprint {
  index: number;
  rawPreview: string;
  splitHash: string;
  fieldHash: string;
  renderedHash: string;
  semanticHash: string;
  contractHash: string;
  publicStatus: string;
  referenceType: string;
  criticalFields: Record<string, boolean>;
}

interface QualityComparison {
  key: string;
  layer: DirectRunSummary['layer'];
  status: 'pass' | 'fail';
  hardFailures: string[];
  warnings: string[];
  diffs: string[];
}

interface ApprovedTruthDiagnosticSummary {
  totalRowsScanned: number;
  loadedRows: number;
  reviewedRows: number;
  draftRows: number;
  quarantinedRows: number;
  certifiedCoreRows: number;
  certifiedOverlayRows: number;
  usableCoreRows: number;
  usableOverlayRows: number;
}

const ROUND_PLACES = 2;
const MAX_REPORTS = 20;
const DEFAULT_FIXTURE = [
  '1. SHOJI, Mamoru, & Group, LHD Experiment (2020). Radiation Resistant Camera System for Monitoring Deuterium Plasma Discharges in the Large Helical Device. Plasma and Fusion Research, 15(0), 2402039.',
  '2. Mamoru SHOJI and LHD Experiment Group, "Radiation Resistant Camera System for Monitoring Deuterium Plasma Discharges in the Large Helical Device," Plasma and Fusion Research, vol. 15, no. 0, pp. 2402039, 2020.',
  '3. SHOJI M, Group LHDE. Radiation Resistant Camera System for Monitoring Deuterium Plasma Discharges in the Large Helical Device. Plasma and Fusion Research. 2020;15(0):2402039.',
  '4. Lowry OH, Rosebrough NJ, Farr AL, Randall RJ. PROTEIN MEASUREMENT WITH THE FOLIN PHENOL REAGENT. Journal of Biological Chemistry. 1951;193(1):265-275.',
  '5. LAEMMLI UK. Cleavage of Structural Proteins during the Assembly of the Head of Bacteriophage T4. Nature. 1970;227(5259):680-685.',
  '6. Bradford M. A Rapid and Sensitive Method for the Quantitation of Microgram Quantities of Protein Utilizing the Principle of Protein-Dye Binding. Analytical Biochemistry. 1976;72(1-2):248-254.',
  '7. Perdew JP, Burke K, Ernzerhof M. Generalized Gradient Approximation Made Simple. Physical Review Letters. 1996;77(18):3865-3868.',
  '8. Livak KJ, Schmittgen TD. Analysis of Relative Gene Expression Data Using Real-Time Quantitative PCR and the 2-DDCT Method. Methods. 2001;25(4):402-408.',
  '9. Braun V, Clarke V. Using thematic analysis in psychology. Qualitative Research in Psychology. 2006;3(2):77-101.',
  '10. Breiman L. Random Forests. Machine Learning. 2001;45(1):5-32.',
  '11. Kresse G, Furthmuller J. Efficient iterative schemes for ab initio total-energy calculations using a plane-wave basis set. Physical review. B, Condensed matter. 1996;54(16):11169-11186.',
  '12. Sung H, Ferlay J, Siegel RL, Laversanne M, Soerjomataram I, Jemal A, Bray F. Global Cancer Statistics 2020: GLOBOCAN Estimates of Incidence and Mortality Worldwide for 36 Cancers in 185 Countries. CA A Cancer Journal for Clinicians. 2021;71(3):209-249.',
].join('\n');

const reports: AdminPerformanceDiagnosticReport[] = [];

export function getLatestAdminPerformanceDiagnostic(): AdminPerformanceDiagnosticReport | null {
  return reports[0] ?? null;
}

export function listAdminPerformanceDiagnostics(): AdminPerformanceDiagnosticReport[] {
  return reports;
}

export async function runAdminPerformanceDiagnostic(
  input: AdminPerformanceDiagnosticInput,
): Promise<AdminPerformanceDiagnosticReport> {
  const resolvedInput = resolveInput(input);
  const inputSummary = await summarizeInput(resolvedInput.content, resolvedInput.label, input);
  await runDirectEngine({
    input: resolvedInput.content,
    inputLabel: resolvedInput.label,
    sourceType: input.sourceType,
    outputStyle: input.outputStyle,
    parseProfile: input.parseProfile,
    runtimeProfile: input.runtimeProfile,
    repeatIndex: -1,
  });
  const baselineRun = await runDirectEngine({
    input: resolvedInput.content,
    inputLabel: resolvedInput.label,
    sourceType: input.sourceType,
    outputStyle: input.outputStyle,
    parseProfile: input.parseProfile,
    runtimeProfile: input.runtimeProfile,
    repeatIndex: 0,
  });
  const measuredRun = await runDirectEngine({
    input: resolvedInput.content,
    inputLabel: resolvedInput.label,
    sourceType: input.sourceType,
    outputStyle: input.outputStyle,
    parseProfile: input.parseProfile,
    runtimeProfile: input.runtimeProfile,
    repeatIndex: 1,
  });
  const approvedTruth = await summarizeApprovedTruthForDiagnostics();
  const qualityComparison = compareQualitySummary(
    `direct:${input.parseProfile}:${input.runtimeProfile}`,
    'direct_engine',
    baselineRun.quality,
    measuredRun.quality,
  );
  const performanceValid = qualityComparison.status === 'pass' && qualityComparison.hardFailures.length === 0;
  const report: AdminPerformanceDiagnosticReport = {
    id: randomUUID(),
    generatedAt: new Date().toISOString(),
    input: inputSummary,
    config: {
      sourceType: input.sourceType,
      outputStyle: input.outputStyle,
      parseProfile: input.parseProfile,
      runtimeProfile: input.runtimeProfile,
    },
    baselineRun,
    measuredRun,
    approvedTruth,
    qualityComparison,
    performanceValid,
    conclusions: buildConclusions(measuredRun, qualityComparison, performanceValid, approvedTruth),
  };

  reports.unshift(report);
  reports.splice(MAX_REPORTS);
  return report;
}

function resolveInput(input: AdminPerformanceDiagnosticInput): { content: string; label: string } {
  const content = input.content?.trim();
  if (content) {
    return {
      content,
      label: 'pasted_input',
    };
  }

  return {
    content: DEFAULT_FIXTURE,
    label: `fixture:${input.fixture ?? 'numbered_mixed_style_smoke'}`,
  };
}

async function summarizeInput(
  content: string,
  label: string,
  input: AdminPerformanceDiagnosticInput,
): Promise<InputSummary> {
  const ctx = createPipelineContext({
    outputStyle: input.outputStyle,
    options: { parseProfile: 'core_parse_fast' },
    tenantContext: { tier: 'pro', isAdmin: true },
  });
  const envelope = await withConsoleInfoMuted(() => phase1Ingest.run({
    sourceType: input.sourceType,
    content,
  }, ctx));
  const split = await withConsoleInfoMuted(() => phase2Split.run(envelope, ctx));
  const lines = content.split(/\r?\n/u);

  return {
    label,
    sha256: sha256(content),
    rawInputBytes: Buffer.byteLength(content, 'utf8'),
    rawInputChars: content.length,
    lineCount: lines.length,
    nonEmptyLineCount: lines.filter((line) => line.trim()).length,
    numberedLineCount: lines.filter((line) => /^\s*\d+[.)]\s+/u.test(line)).length,
    inspectedReferenceCount: split.blocks.length,
    inspectedDetectedFormat: envelope.detectedFormat,
    inspectedStructure: envelope.structure,
    inspectedSplitQualityFlag: split.splitQualityFlag,
  };
}

async function runDirectEngine(input: {
  input: string;
  inputLabel: string;
  sourceType: ConvertRequest['sourceType'];
  outputStyle: CitationStyle;
  parseProfile: ParseProfile;
  runtimeProfile: PipelineRuntimeProfile;
  repeatIndex: number;
}): Promise<DirectRunSummary> {
  const runtimeResolution = resolvePipelineRuntimeProfile(
    input.runtimeProfile,
    input.runtimeProfile === 'benchmark_5600h' ? 'parallel' : 'direct',
  );
  const ctx = createPipelineContext({
    outputStyle: input.outputStyle,
    options: {
      parseProfile: input.parseProfile,
      debug: false,
      enrich: false,
      groupDuplicates: true,
      dedup: true,
    },
    runtimeTuning: runtimeResolution.runtimeTuning,
    tenantContext: {
      tier: 'pro',
      isAdmin: true,
    },
  });
  const started = performance.now();
  const artifacts = await withConsoleInfoMuted(() => runConvertPipeline({
    sourceType: input.sourceType,
    content: input.input,
    outputStyle: input.outputStyle,
    options: {
      parseProfile: input.parseProfile,
      debug: false,
      enrich: false,
      groupDuplicates: true,
      dedup: true,
    },
  }, ctx, createPipelineDependencies()));
  const wallClockMs = performance.now() - started;
  const stringifyStarted = performance.now();
  const responseJson = JSON.stringify(artifacts.response);
  const responseStringifyMs = performance.now() - stringifyStarted;
  const referenceCount = artifacts.response.references.length;
  const quality = computeQualitySummary(artifacts.response);

  return {
    layer: 'direct_engine',
    label: input.inputLabel,
    repeatIndex: input.repeatIndex,
    parseProfile: input.parseProfile,
    runtimeProfile: input.runtimeProfile,
    runtimeTuning: {
      batchSize: ctx.runtimeTuning.batchSize,
      maxConcurrency: ctx.runtimeTuning.maxConcurrency,
      fastLaneMulticoreMinRefs: ctx.runtimeTuning.fastLaneMulticoreMinRefs ?? null,
    },
    wallClockMs: round(wallClockMs),
    refsPerSecond: throughput(referenceCount, wallClockMs),
    responseStringifyMs: round(responseStringifyMs),
    responseBytes: Buffer.byteLength(responseJson, 'utf8'),
    responseSha256: sha256(responseJson),
    renderedTextSha256: sha256(artifacts.response.references.map((reference) => reference.renderedText).join('\n')),
    quality,
    executionProfile: artifacts.response.executionProfile,
    coreParseLatencyMs: artifacts.response.coreParseLatencyMs,
    referenceCount,
    countAudit: artifacts.response.countAudit,
    summary: artifacts.response.summary,
    providerUsage: artifacts.response.providerUsage,
    stageTotalsMs: stageTotals(artifacts.response.processingPath.stageTimings),
    stageTimings: artifacts.response.processingPath.stageTimings,
    diagnosticRecordCount: artifacts.response.diagnostics?.length ?? 0,
    diagnosticDetails: summarizeDiagnostics(artifacts.response.diagnostics ?? []),
    slowestReferences: artifacts.response.references
      .map((reference) => ({
        index: reference.index,
        outputLatencyMs: reference.outputLatencyMs,
        publicStatus: reference.publicStatus,
        referenceType: reference.referenceType,
        rawPreview: preview(reference.raw),
      }))
      .sort((left, right) => right.outputLatencyMs - left.outputLatencyMs)
      .slice(0, 20),
  };
}

function computeQualitySummary(response: QualityPayload): QualitySummary {
  const references = response.references;
  const indexById = new Map(references.map((reference) => [reference.id, reference.index]));
  const splitRows = references.map((reference) => ({
    index: reference.index,
    raw: normalizeQualityText(reference.raw),
  }));
  const fieldRows = references.map((reference) => ({
    index: reference.index,
    fields: fieldValuesOnly(reference.fields),
  }));
  const renderedRows = references.map((reference) => ({
    index: reference.index,
    renderedText: normalizeQualityText(reference.renderedText),
  }));
  const semanticRows = references.map((reference) => ({
    index: reference.index,
    raw: normalizeQualityText(reference.raw),
    referenceType: reference.referenceType,
    detectedStyle: reference.detectedStyle,
    effectiveStyle: reference.effectiveStyle,
    fields: fieldValuesOnly(reference.fields),
    renderedText: normalizeQualityText(reference.renderedText),
    publicStatus: reference.publicStatus,
    parseOutcome: reference.parseOutcome,
    status: reference.status,
    error: reference.error ?? null,
  }));
  const contractRows = references.map((reference) => ({
    index: reference.index,
    referenceType: reference.referenceType,
    detectedStyleFamily: reference.detectedStyleFamily,
    detectedStyle: reference.detectedStyle,
    effectiveStyle: reference.effectiveStyle,
    publicStatus: reference.publicStatus,
    parseOutcome: reference.parseOutcome,
    status: reference.status,
    fields: fieldValuesOnly(reference.fields),
    healthReasons: sortPrimitiveValues(reference.healthReasons),
    healthBreakdown: sortHealthBreakdown(reference.healthBreakdown),
    healthWarnings: sortHealthWarnings(reference.healthWarnings),
    renderedWarnings: sortPrimitiveValues(reference.renderedWarnings),
    error: reference.error ?? null,
    duplicateOfIndex: reference.duplicateOf ? indexById.get(reference.duplicateOf) ?? null : null,
  }));

  return {
    version: 1,
    referenceCount: references.length,
    splitHash: hashCanonicalJson(splitRows),
    fieldHash: hashCanonicalJson(fieldRows),
    renderedHash: hashCanonicalJson(renderedRows),
    semanticHash: hashCanonicalJson(semanticRows),
    contractHash: hashCanonicalJson(contractRows),
    failedCount: response.summary.failed,
    emptyRenderedCount: references.filter((reference) => !reference.renderedText.trim()).length,
    needsReviewCount: response.summary.needsReview,
    needsActionCount: response.summary.needsAction,
    criticalFieldPresence: criticalFieldPresence(references),
    providerUsage: response.providerUsage ?? null,
    referenceFingerprints: references.map((reference, index) => ({
      index: reference.index,
      rawPreview: preview(reference.raw),
      splitHash: hashCanonicalJson(splitRows[index]),
      fieldHash: hashCanonicalJson(fieldRows[index]),
      renderedHash: hashCanonicalJson(renderedRows[index]),
      semanticHash: hashCanonicalJson(semanticRows[index]),
      contractHash: hashCanonicalJson(contractRows[index]),
      publicStatus: reference.publicStatus,
      referenceType: reference.referenceType,
      criticalFields: criticalFieldFlags(reference),
    })),
  };
}

function compareQualitySummary(
  key: string,
  layer: DirectRunSummary['layer'],
  baseline: QualitySummary,
  current: QualitySummary,
): QualityComparison {
  const hardChecks: Array<[string, unknown, unknown]> = [
    ['referenceCount', baseline.referenceCount, current.referenceCount],
    ['splitHash', baseline.splitHash, current.splitHash],
    ['fieldHash', baseline.fieldHash, current.fieldHash],
    ['renderedHash', baseline.renderedHash, current.renderedHash],
    ['semanticHash', baseline.semanticHash, current.semanticHash],
    ['contractHash', baseline.contractHash, current.contractHash],
    ['failedCount', baseline.failedCount, current.failedCount],
    ['emptyRenderedCount', baseline.emptyRenderedCount, current.emptyRenderedCount],
  ];
  const hardFailures = hardChecks
    .filter(([, left, right]) => left !== right)
    .map(([label, left, right]) => `${label} changed: baseline ${String(left)}, current ${String(right)}`);
  const warnings: string[] = [];
  if (baseline.needsReviewCount !== current.needsReviewCount) {
    warnings.push(`needsReviewCount changed: baseline ${baseline.needsReviewCount}, current ${current.needsReviewCount}`);
  }
  if (baseline.needsActionCount !== current.needsActionCount) {
    warnings.push(`needsActionCount changed: baseline ${baseline.needsActionCount}, current ${current.needsActionCount}`);
  }
  if (JSON.stringify(baseline.criticalFieldPresence) !== JSON.stringify(current.criticalFieldPresence)) {
    hardFailures.push('criticalFieldPresence changed');
  }
  if (JSON.stringify(baseline.providerUsage) !== JSON.stringify(current.providerUsage)) {
    warnings.push('providerUsage changed');
  }

  return {
    key,
    layer,
    status: hardFailures.length > 0 ? 'fail' : 'pass',
    hardFailures,
    warnings,
    diffs: hardFailures.length > 0
      ? summarizeReferenceFingerprintDiffs(baseline.referenceFingerprints, current.referenceFingerprints)
      : [],
  };
}

function summarizeReferenceFingerprintDiffs(
  baseline: QualityReferenceFingerprint[],
  current: QualityReferenceFingerprint[],
): string[] {
  const currentByIndex = new Map(current.map((fingerprint) => [fingerprint.index, fingerprint]));
  const baselineByIndex = new Map(baseline.map((fingerprint) => [fingerprint.index, fingerprint]));
  const diffs: string[] = [];
  for (const fingerprint of baseline) {
    const next = currentByIndex.get(fingerprint.index);
    if (!next) {
      diffs.push(`missing current ref ${fingerprint.index}: ${fingerprint.rawPreview}`);
      continue;
    }
    const changed: string[] = [];
    if (fingerprint.splitHash !== next.splitHash) changed.push('split');
    if (fingerprint.fieldHash !== next.fieldHash) changed.push('fields');
    if (fingerprint.renderedHash !== next.renderedHash) changed.push('rendered');
    if (fingerprint.semanticHash !== next.semanticHash) changed.push('semantic');
    if (fingerprint.contractHash !== next.contractHash) changed.push('contract');
    if (JSON.stringify(fingerprint.criticalFields) !== JSON.stringify(next.criticalFields)) changed.push('critical-fields');
    if (changed.length > 0) {
      diffs.push(`changed ref ${fingerprint.index} (${changed.join(', ')}): ${fingerprint.rawPreview}`);
    }
    if (diffs.length >= 20) {
      diffs.push('diff preview truncated after 20 entries');
      return diffs;
    }
  }
  for (const fingerprint of current) {
    if (!baselineByIndex.has(fingerprint.index)) {
      diffs.push(`new current ref ${fingerprint.index}: ${fingerprint.rawPreview}`);
    }
    if (diffs.length >= 20) {
      diffs.push('diff preview truncated after 20 entries');
      return diffs;
    }
  }
  return diffs;
}

function buildConclusions(
  run: DirectRunSummary,
  comparison: QualityComparison,
  performanceValid: boolean,
  approvedTruth: ApprovedTruthDiagnosticSummary,
): string[] {
  const conclusions = [
    `${run.parseProfile} / ${run.runtimeProfile}: ${run.refsPerSecond} refs/sec (${run.wallClockMs}ms, ${run.referenceCount} refs).`,
    performanceValid
      ? 'Quality parity passed; throughput is valid for this diagnostic input.'
      : 'Quality parity failed; throughput is visible but not valid for comparison.',
      `Approved truth loaded for primary use: ${approvedTruth.loadedRows} reviewed row(s), ${approvedTruth.usableCoreRows} certified core row(s), ${approvedTruth.usableOverlayRows} certified overlay row(s). ${approvedTruth.quarantinedRows} quarantined row(s) were scanned but not loaded into primary overlays/caches.`,
  ];
  if (comparison.warnings.length > 0) {
    conclusions.push(`Quality warnings: ${comparison.warnings.join('; ')}`);
  }
  if (run.providerUsage.crossrefCalls > 0 || run.providerUsage.openalexCalls > 0 || run.providerUsage.semanticScholarCalls > 0) {
    conclusions.push('Provider usage was non-zero during a provider-free diagnostic lane.');
  }
  return conclusions;
}

async function summarizeApprovedTruthForDiagnostics(): Promise<ApprovedTruthDiagnosticSummary> {
  const rows = await listApprovedTruth({ limit: 50_000 });
  const summary: ApprovedTruthDiagnosticSummary = {
    totalRowsScanned: rows.length,
    loadedRows: 0,
    reviewedRows: 0,
    draftRows: 0,
    quarantinedRows: 0,
    certifiedCoreRows: 0,
    certifiedOverlayRows: 0,
    usableCoreRows: 0,
    usableOverlayRows: 0,
  };

  for (const rawRow of rows) {
    const row = withLegacyCertification(rawRow);
    const status = effectiveRowStatus(row);
    if (status === 'reviewed') {
      summary.reviewedRows += 1;
      summary.loadedRows += 1;
    }
    if (status === 'draft') summary.draftRows += 1;
    if (status === 'quarantined') {
      summary.quarantinedRows += 1;
      continue;
    }
    if (status === 'draft') {
      continue;
    }

    const coreCertified = isCertifiedForScope(row, 'core');
    const overlayCertified = isCertifiedForScope(row, 'overlay');
    if (coreCertified) summary.certifiedCoreRows += 1;
    if (overlayCertified) summary.certifiedOverlayRows += 1;
    if (status === 'reviewed' && coreCertified) summary.usableCoreRows += 1;
    if (status === 'reviewed' && overlayCertified) summary.usableOverlayRows += 1;
  }

  return summary;
}

function isCertifiedForScope(row: StoredApprovedTruth, scope: TruthScope): boolean {
  const tasks: TruthTask[] = ['field', 'style', 'authority_pack', 'overlay_learning'];
  return tasks.some((task) => isTaskCertified(row, task, scope));
}

function fieldValuesOnly(fields: ConvertResponse['references'][number]['fields']): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, field]) => [key, canonicalizeJsonValue(field.value)]),
  );
}

function criticalFieldPresence(references: ConvertResponse['references']): Record<string, number> {
  const counts = {
    title: 0,
    year: 0,
    authors: 0,
    container: 0,
    doi: 0,
    url: 0,
    pages: 0,
    volume: 0,
    issue: 0,
    knownReferenceType: 0,
  };
  for (const reference of references) {
    const fields = reference.fields;
    if (hasQualityValue(fields.title.value)) counts.title += 1;
    if (hasQualityValue(fields.year.value)) counts.year += 1;
    if (Array.isArray(fields.authors.value) && fields.authors.value.length > 0) counts.authors += 1;
    if (
      hasQualityValue(fields.journal.value)
      || hasQualityValue(fields.bookTitle.value)
      || hasQualityValue(fields.conferenceTitle.value)
      || hasQualityValue(fields.publisher.value)
      || hasQualityValue(fields.siteName.value)
    ) {
      counts.container += 1;
    }
    if (hasQualityValue(fields.doi.value)) counts.doi += 1;
    if (hasQualityValue(fields.url.value)) counts.url += 1;
    if (hasQualityValue(fields.pages.value) || hasQualityValue(fields.articleNumber.value)) counts.pages += 1;
    if (hasQualityValue(fields.volume.value)) counts.volume += 1;
    if (hasQualityValue(fields.issue.value)) counts.issue += 1;
    if (reference.referenceType !== 'unknown') counts.knownReferenceType += 1;
  }
  return counts;
}

function criticalFieldFlags(reference: ConvertResponse['references'][number]): Record<string, boolean> {
  const fields = reference.fields;
  return {
    title: hasQualityValue(fields.title.value),
    year: hasQualityValue(fields.year.value),
    authors: Array.isArray(fields.authors.value) && fields.authors.value.length > 0,
    container: hasQualityValue(fields.journal.value)
      || hasQualityValue(fields.bookTitle.value)
      || hasQualityValue(fields.conferenceTitle.value)
      || hasQualityValue(fields.publisher.value)
      || hasQualityValue(fields.siteName.value),
    doi: hasQualityValue(fields.doi.value),
    url: hasQualityValue(fields.url.value),
    pages: hasQualityValue(fields.pages.value) || hasQualityValue(fields.articleNumber.value),
    volume: hasQualityValue(fields.volume.value),
    issue: hasQualityValue(fields.issue.value),
    knownReferenceType: reference.referenceType !== 'unknown',
  };
}

function sortPrimitiveValues(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sortHealthWarnings(
  warnings: ConvertResponse['references'][number]['healthWarnings'],
): ConvertResponse['references'][number]['healthWarnings'] {
  return [...warnings].sort((left, right) =>
    `${left.severity}:${left.code}:${left.message ?? ''}`.localeCompare(
      `${right.severity}:${right.code}:${right.message ?? ''}`,
    ),
  );
}

function sortHealthBreakdown(
  breakdown: ConvertResponse['references'][number]['healthBreakdown'],
): ConvertResponse['references'][number]['healthBreakdown'] {
  return {
    missingMandatory: sortPrimitiveValues(breakdown.missingMandatory),
    invalidMandatory: sortPrimitiveValues(breakdown.invalidMandatory),
    lowConfidenceMandatory: sortPrimitiveValues(breakdown.lowConfidenceMandatory),
    presentMandatory: sortPrimitiveValues(breakdown.presentMandatory),
  };
}

function hasQualityValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function normalizeQualityText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function hashCanonicalJson(value: unknown): string {
  return `sha256:${sha256(JSON.stringify(canonicalizeJsonValue(value)))}`;
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJsonValue(entry));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeJsonValue(entry)]),
    );
  }

  return value;
}

function stageTotals(stageTimings: ProcessingPath['stageTimings']): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const timing of stageTimings) {
    totals[timing.phaseId] = round((totals[timing.phaseId] ?? 0) + timing.durationMs);
  }
  return totals;
}

function summarizeDiagnostics(records: StageRunRecord[]): DiagnosticDetail[] {
  return records
    .filter((record) => record.details || record.phaseId === 'author_disambiguation')
    .map((record) => ({
      phaseId: record.phaseId,
      stageId: record.stageId,
      status: record.status,
      durationMs: record.durationMs,
      message: record.message ?? null,
      details: record.details ?? null,
    }));
}

function throughput(count: number, durationMs: number): number {
  return durationMs > 0 ? round(count / (durationMs / 1000)) : 0;
}

function round(value: number, places = ROUND_PLACES): number {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function preview(value: string): string {
  const compact = value.replace(/\s+/gu, ' ').trim();
  return compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function withConsoleInfoMuted<T>(run: () => Promise<T>): Promise<T> {
  const originalInfo = console.info;
  console.info = () => {};
  try {
    return await run();
  } finally {
    console.info = originalInfo;
  }
}
