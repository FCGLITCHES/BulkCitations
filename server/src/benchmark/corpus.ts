import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  normalizeArxiv,
  normalizeDoi,
  normalizeHandle,
  normalizeIsbn,
  normalizeIssn,
  normalizePatent,
  normalizePmid,
} from "../engine/identifierUtils.js";
import {
  normalizeExpectedTruthFields,
  type TruthFieldValue,
} from "../training/truthFields.js";
import { renderBenchmarkCslItem } from "./csl.js";
import {
  applyNumberedMultiline,
  applyOcrArtifacts,
  applyPdfCopyArtifacts,
  REAL_INPUT_SOURCE_KIND,
  type RealInputMode,
} from "./realInputModes.js";
import {
  assertManifestFormattedAlignment,
  hashBenchmarkFormattedString,
} from "./integrity.js";
import { resolveBenchmarkPaths } from "./paths.js";
import { fieldLooksPresentInFormatted, inferRequiredFields } from "./normalization.js";
import {
  BENCHMARK_NOISE_TYPES,
  BENCHMARK_REFERENCE_TYPES,
  BENCHMARK_STYLES,
  type BenchmarkBaseRecord,
  type BenchmarkManifestRow,
  type BenchmarkMode,
  type BenchmarkNoiseType,
  type BenchmarkReferenceType,
} from "./types.js";

const MODE_TARGETS: Record<BenchmarkMode, number> = {
  pilot: 200,
  full: 1000,
};

const MODE_MINIMUMS: Record<BenchmarkMode, number> = {
  pilot: 16,
  full: 90,
};

const HARVEST_SOURCES: Array<{
  key: string;
  format: "json" | "text";
  buildUrl: (rows: number) => string;
}> = [
  {
    key: "crossref.article-journal",
    format: "json",
    buildUrl: (rows) => `https://api.crossref.org/works?filter=type:journal-article&rows=${rows}`,
  },
  {
    key: "crossref.conference-paper",
    format: "json",
    buildUrl: (rows) => `https://api.crossref.org/works?filter=type:proceedings-article&rows=${rows}`,
  },
  {
    key: "crossref.book",
    format: "json",
    buildUrl: (rows) => `https://api.crossref.org/works?filter=type:book&rows=${rows}`,
  },
  {
    key: "crossref.book-chapter",
    format: "json",
    buildUrl: (rows) => `https://api.crossref.org/works?filter=type:book-chapter&rows=${rows}`,
  },
  {
    key: "crossref.thesis",
    format: "json",
    buildUrl: (rows) => `https://api.crossref.org/works?filter=type:dissertation&rows=${rows}`,
  },
  {
    key: "crossref.report",
    format: "json",
    buildUrl: (rows) => `https://api.crossref.org/works?filter=type:report&rows=${rows}`,
  },
  {
    key: "crossref.standard",
    format: "json",
    buildUrl: (rows) => `https://api.crossref.org/works?filter=type:standard&rows=${rows}`,
  },
  {
    key: "crossref.preprint",
    format: "json",
    buildUrl: (rows) => `https://api.crossref.org/works?filter=type:posted-content&rows=${rows}`,
  },
  {
    key: "openlibrary.book",
    format: "json",
    buildUrl: (rows) => `https://openlibrary.org/search.json?q=algorithms&limit=${rows}`,
  },
  {
    key: "arxiv.preprint",
    format: "text",
    buildUrl: (rows) => `http://export.arxiv.org/api/query?search_query=cat:cs.LG&start=0&max_results=${rows}`,
  },
];

export async function harvestBenchmarkSources(mode: BenchmarkMode): Promise<void> {
  const paths = resolveBenchmarkPaths(mode);
  await mkdir(paths.rawSourcesDir, { recursive: true });
  const rows = mode === "pilot" ? 80 : 220;

  for (const source of HARVEST_SOURCES) {
    const response = await fetch(source.buildUrl(rows), {
      headers: {
        Accept: source.format === "json" ? "application/json" : "application/atom+xml",
        "User-Agent": "BulkReferences Benchmark Harvester/1.0",
      },
    });
    if (!response.ok) {
      throw new Error(`Failed to harvest ${source.key}: ${response.status} ${response.statusText}`);
    }
    const outputPath = path.join(paths.rawSourcesDir, `${source.key}.${source.format === "json" ? "json" : "xml"}`);
    await writeFile(outputPath, await response.text(), "utf8");
  }
}

export async function buildBenchmarkCorpus(
  mode: BenchmarkMode,
  options: { realInputModes?: boolean } = {},
): Promise<{
  manifest: BenchmarkManifestRow[];
  formattedStrings: string[];
  noiseLog: Array<{ variant_id: string; noise_applied: BenchmarkNoiseType[] }>;
  warnings: string[];
}> {
  const paths = resolveBenchmarkPaths(mode);
  await mkdir(paths.corpusDir, { recursive: true });

  const harvested = await loadHarvestedBaseRecords(mode);
  const selected = selectBalancedRecords(harvested.records, MODE_TARGETS[mode]);
  const balance = validateBalancedSelection(selected.records, mode);
  const warnings = [...harvested.warnings, ...selected.warnings, ...balance.warnings];
  if (balance.failures.length > 0) {
    throw new Error(balance.failures.join(" "));
  }

  const cleanRows: BenchmarkManifestRow[] = [];
  const noisyRows: BenchmarkManifestRow[] = [];
  // Real-input-mode variants are kept separate: interleaveRows pairs clean<->noisy by
  // stem, which would drop the :pdf_copy/:ocr_like/:numbered_block suffixes.
  const realInputRows: BenchmarkManifestRow[] = [];
  const noiseLog: Array<{ variant_id: string; noise_applied: BenchmarkNoiseType[] }> = [];

  for (const record of selected.records) {
    for (const style of BENCHMARK_STYLES) {
      const rendered = renderBenchmarkCslItem(
        {
          ...(record.cslItem as Record<string, unknown>),
          id: String(record.cslItem.id ?? record.recordId),
        },
        style,
        mode,
      );
      const cleanBase = {
        record_id: record.recordId,
        reference_type: record.referenceType,
        citation_style: style,
        formatted_string: rendered,
        formatted_hash: hashBenchmarkFormattedString(rendered),
        noise_applied: [],
        source: record.source,
        source_url: record.sourceUrl,
        source_hash: record.sourceHash,
        language: record.language,
        input_structure: record.inputStructure,
        input_source_kind: record.inputSourceKind,
        expected_fields: record.expectedFields,
      } satisfies Omit<BenchmarkManifestRow, "variant_id" | "variant_kind" | "required_fields">;

      const cleanRow: BenchmarkManifestRow = {
        ...cleanBase,
        variant_id: `${record.recordId}:${style}:clean`,
        variant_kind: "clean",
        required_fields: inferRequiredFields(cleanBase),
      };
      cleanRows.push(cleanRow);

      if (shouldCreateNoisyVariant(record.recordId)) {
        const noise = selectNoiseType(record.recordId, style);
        const noisyString = applyNoise(cleanRow.formatted_string, noise, cleanRow.expected_fields);
        const noisyBase = {
          ...cleanBase,
          formatted_string: noisyString,
          formatted_hash: hashBenchmarkFormattedString(noisyString),
          noise_applied: [noise],
        } satisfies Omit<BenchmarkManifestRow, "variant_id" | "variant_kind" | "required_fields">;
        const noisyRow: BenchmarkManifestRow = {
          ...noisyBase,
          variant_id: `${record.recordId}:${style}:noisy`,
          variant_kind: "noisy",
          required_fields: inferRequiredFields(noisyBase),
        };
        noisyRows.push(noisyRow);
        noiseLog.push({ variant_id: noisyRow.variant_id, noise_applied: noisyRow.noise_applied });
      }

      // Opt-in real-input-mode variant: exercises the paste-degradation profiles
      // (pasted_pdf_copy / ocr_like / multiline_numbered) the csl_rendered corpus never
      // covers. Input is degraded; expected_fields are unchanged, so it measures recall
      // under real-world paste. Gated so the default corpus + its hashes stay stable.
      if (options.realInputModes) {
        const realMode = selectRealInputMode(record.recordId, style);
        const key = `${record.recordId}:${style}`;
        const transformed =
          realMode === "pdf_copy"
            ? applyPdfCopyArtifacts(cleanRow.formatted_string, key)
            : realMode === "ocr_like"
              ? applyOcrArtifacts(cleanRow.formatted_string, key)
              : applyNumberedMultiline(cleanRow.formatted_string, key, cleanRows.length);
        const realBase = {
          ...cleanBase,
          formatted_string: transformed,
          formatted_hash: hashBenchmarkFormattedString(transformed),
          input_source_kind: REAL_INPUT_SOURCE_KIND[realMode] as typeof cleanBase.input_source_kind,
          noise_applied: [],
        } satisfies Omit<BenchmarkManifestRow, "variant_id" | "variant_kind" | "required_fields">;
        const realRow: BenchmarkManifestRow = {
          ...realBase,
          variant_id: `${record.recordId}:${style}:${realMode}`,
          variant_kind: "noisy",
          required_fields: inferRequiredFields(realBase),
        };
        realInputRows.push(realRow);
      }
    }
  }

  const manifest = [...interleaveRows(cleanRows, noisyRows), ...realInputRows];
  const formattedStrings = manifest.map((row) => row.formatted_string);
  assertManifestFormattedAlignment(manifest, formattedStrings);
  await writeFile(paths.manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  await writeFile(paths.formattedStringsPath, `${formattedStrings.join("\n")}\n`, "utf8");
  await writeFile(paths.noiseLogPath, JSON.stringify(noiseLog, null, 2), "utf8");

  return { manifest, formattedStrings, noiseLog, warnings };
}

async function loadHarvestedBaseRecords(mode: BenchmarkMode): Promise<{
  records: BenchmarkBaseRecord[];
  warnings: string[];
}> {
  const paths = resolveBenchmarkPaths(mode);
  const warnings: string[] = [];
  const records: BenchmarkBaseRecord[] = [];

  const loaders = [
    loadCrossrefRecords,
    loadOpenLibraryRecords,
    loadArxivRecords,
    loadManualSeedRecords,
  ] as const;

  for (const loader of loaders) {
    const result = await loader(paths.rawSourcesDir);
    records.push(...result.records);
    warnings.push(...result.warnings);
  }

  const deduped = dedupeRecords(records);
  return {
    records: deduped.records.filter((record) => basicQualityGate(record)),
    warnings: [...warnings, ...deduped.warnings],
  };
}

async function loadCrossrefRecords(rawSourcesDir: string): Promise<{
  records: BenchmarkBaseRecord[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const files: Array<{ name: string; referenceType: BenchmarkReferenceType }> = [
    { name: "crossref.article-journal.json", referenceType: "article-journal" },
    { name: "crossref.conference-paper.json", referenceType: "conference-paper" },
    { name: "crossref.book.json", referenceType: "book" },
    { name: "crossref.book-chapter.json", referenceType: "book-chapter" },
    { name: "crossref.thesis.json", referenceType: "thesis" },
    { name: "crossref.report.json", referenceType: "report" },
    { name: "crossref.standard.json", referenceType: "report" },
    { name: "crossref.preprint.json", referenceType: "preprint" },
  ];

  const records: BenchmarkBaseRecord[] = [];
  for (const file of files) {
    const fullPath = path.join(rawSourcesDir, file.name);
    try {
      const payload = JSON.parse(await readFile(fullPath, "utf8")) as {
        message?: { items?: Array<Record<string, unknown>> };
      };
      for (const work of payload.message?.items ?? []) {
        const result = crossrefWorkToBaseRecord(work, file.referenceType);
        if (result.warning) warnings.push(result.warning);
        if (result.record) records.push(result.record);
      }
    } catch (error) {
      warnings.push(`Skipped ${file.name}: ${(error as Error).message}`);
    }
  }
  return { records, warnings };
}

async function loadOpenLibraryRecords(rawSourcesDir: string): Promise<{
  records: BenchmarkBaseRecord[];
  warnings: string[];
}> {
  const filePath = path.join(rawSourcesDir, "openlibrary.book.json");
  try {
    const payload = JSON.parse(await readFile(filePath, "utf8")) as {
      docs?: Array<Record<string, unknown>>;
    };
    const records = (payload.docs ?? [])
      .map((doc) => openLibraryDocToBaseRecord(doc))
      .filter((record): record is BenchmarkBaseRecord => record != null);
    return { records, warnings: [] };
  } catch (error) {
    return { records: [], warnings: [`Skipped openlibrary.book.json: ${(error as Error).message}`] };
  }
}

async function loadArxivRecords(rawSourcesDir: string): Promise<{
  records: BenchmarkBaseRecord[];
  warnings: string[];
}> {
  const filePath = path.join(rawSourcesDir, "arxiv.preprint.xml");
  try {
    const xml = await readFile(filePath, "utf8");
    return { records: parseArxivFeed(xml), warnings: [] };
  } catch (error) {
    return { records: [], warnings: [`Skipped arxiv.preprint.xml: ${(error as Error).message}`] };
  }
}

async function loadManualSeedRecords(rawSourcesDir: string): Promise<{
  records: BenchmarkBaseRecord[];
  warnings: string[];
}> {
  try {
    const fileNames = (await readdir(rawSourcesDir))
      .filter((fileName) => fileName.endsWith(".seed.json"))
      .sort((left, right) => left.localeCompare(right));
    const records: BenchmarkBaseRecord[] = [];

    for (const fileName of fileNames) {
      const filePath = path.join(rawSourcesDir, fileName);
      const payload = JSON.parse(await readFile(filePath, "utf8")) as ManualSeedRecordInput[];
      records.push(...payload.map((entry) => manualSeedToBaseRecord(entry)));
    }

    return { records, warnings: [] };
  } catch {
    return { records: [], warnings: [] };
  }
}

interface ManualSeedRecordInput {
  recordId?: string;
  referenceType: BenchmarkReferenceType;
  source?: string;
  sourceUrl: string;
  language?: string;
  expectedFields: Record<string, TruthFieldValue>;
  cslItem?: Record<string, unknown>;
}

function manualSeedToBaseRecord(entry: ManualSeedRecordInput): BenchmarkBaseRecord {
  const expectedFields = normalizeExpectedTruthFields(entry.expectedFields);
  const title = typeof expectedFields.title === "string" ? expectedFields.title : "Untitled";
  const year = Number.parseInt(String(expectedFields.year ?? 0), 10) || 1900;
  const recordId = entry.recordId
    ?? stableRecordId(entry.referenceType, entry.sourceUrl, title, year);

  return {
    recordId,
    referenceType: entry.referenceType,
    source: entry.source ?? "manual-seed",
    sourceUrl: entry.sourceUrl,
    sourceHash: sha256(JSON.stringify(entry)),
    language: entry.language ?? "en",
    inputStructure: "structured",
    inputSourceKind: "csl_rendered",
    expectedFields,
    cslItem: entry.cslItem
      ? stripNullish({
          id: recordId,
          ...entry.cslItem,
        })
      : buildSeedCslItem(entry.referenceType, recordId, expectedFields, entry.sourceUrl),
  };
}

function crossrefWorkToBaseRecord(
  work: Record<string, unknown>,
  referenceType: BenchmarkReferenceType,
): {
  record: BenchmarkBaseRecord | null;
  warning?: string;
} {
  const actualType = stringOrNull(work.type);
  if (actualType === "dataset" || actualType === "software") {
    return {
      record: null,
      warning: `Excluded Crossref ${actualType} work ${stringOrNull(work.URL) ?? stringOrNull(work.DOI) ?? "unknown"} from the benchmark allowlist.`,
    };
  }
  if (actualType === "posted-content" && referenceType === "preprint" && !looksLikePreprint(work)) {
    return {
      record: null,
      warning: `Excluded Crossref posted-content ${stringOrNull(work.URL) ?? stringOrNull(work.DOI) ?? "unknown"} because it did not clearly identify a preprint repository.`,
    };
  }

  const title = firstString(work.title);
  const year = extractCrossrefYear(work);
  const authors = normalizeAuthors(work.author);
  const doi = normalizeDoi(work.DOI);
  const publisher = stringOrNull(work.publisher);
  const url = doi ? `https://doi.org/${doi}` : stringOrNull(work.URL);

  if (!title || !year) return { record: null };
  const expectedFields = normalizeExpectedTruthFields(
    stripNullish(buildCrossrefExpectedFields(referenceType, {
      authors,
      title,
      year,
      containerTitle: firstString(work["container-title"]),
      volume: stringOrNull(work.volume),
      issue: stringOrNull(work.issue),
      pages: stringOrNull(work.page),
      doi,
      publisher,
      url,
      reportNumber: stringOrNull(work["report-number"]),
      isbn: firstString(work.ISBN),
      issn: firstString(work.ISSN),
      handle: referenceType === "thesis" ? normalizeHandle(url) : null,
      thesisType: referenceType === "thesis" ? "Dissertation" : null,
    })),
  );
  const sourceUrl = typeof work.URL === "string" ? work.URL : doi ? `https://doi.org/${doi}` : "https://api.crossref.org/works";
  const recordId = stableRecordId(referenceType, sourceUrl, title, year);
  return {
    record: {
      recordId,
      referenceType,
      source: "crossref",
      sourceUrl,
      sourceHash: sha256(JSON.stringify(work)),
      language: firstString(work.language) ?? "en",
      inputStructure: "structured",
      inputSourceKind: "csl_rendered",
      expectedFields,
      cslItem: buildSeedCslItem(referenceType, recordId, expectedFields, sourceUrl),
    },
  };
}

function openLibraryDocToBaseRecord(doc: Record<string, unknown>): BenchmarkBaseRecord | null {
  const title = stringOrNull(doc.title);
  const publishYear = Array.isArray(doc.publish_year) ? Number(doc.publish_year[0]) : null;
  if (!title || !publishYear) return null;
  const isbn = Array.isArray(doc.isbn) ? normalizeIsbn(String(doc.isbn[0])) : null;
  const authors = Array.isArray(doc.author_name) ? doc.author_name.map((name) => String(name)) : [];
  const publisher = Array.isArray(doc.publisher) ? String(doc.publisher[0]) : null;
  const key = stringOrNull(doc.key);
  const sourceUrl = key ? `https://openlibrary.org${key}` : "https://openlibrary.org";
  const recordId = stableRecordId("book", sourceUrl, title, publishYear);
  return {
    recordId,
    referenceType: "book",
    source: "openlibrary",
    sourceUrl,
    sourceHash: sha256(JSON.stringify(doc)),
    language: "en",
    inputStructure: "structured",
    inputSourceKind: "csl_rendered",
    expectedFields: normalizeExpectedTruthFields(
      stripNullish({
        authors,
        title,
        year: publishYear,
        publisher,
        isbn,
        url: sourceUrl,
      }),
    ),
    cslItem: stripNullish({
      id: recordId,
      type: "book",
      title,
      author: authors.map((author) => ({ literal: author })),
      issued: { "date-parts": [[publishYear]] },
      publisher,
      ISBN: isbn,
      URL: sourceUrl,
    }),
  };
}

function parseArxivFeed(xml: string): BenchmarkBaseRecord[] {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => match[1] ?? "");
  const records: BenchmarkBaseRecord[] = [];
  for (const entry of entries) {
      const id = entry.match(/<id>(.*?)<\/id>/)?.[1]?.trim();
      const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, " ").trim();
      const published = entry.match(/<published>(\d{4})-\d{2}-\d{2}<\/published>/)?.[1];
      const doi = entry.match(/<arxiv:doi[^>]*>(.*?)<\/arxiv:doi>/)?.[1]?.trim();
      const authors = [...entry.matchAll(/<name>(.*?)<\/name>/g)]
        .map((match) => match[1]?.trim() ?? "")
        .filter(Boolean);
      if (!id || !title || !published) continue;
      const arxiv = normalizeArxiv(id);
      const url = id;
      const recordId = stableRecordId("preprint", url, title, Number(published));
      records.push({
        recordId,
        referenceType: "preprint" as const,
        source: "arxiv",
        sourceUrl: url,
        sourceHash: sha256(entry),
        language: "en",
        inputStructure: "structured",
        inputSourceKind: "csl_rendered",
        expectedFields: normalizeExpectedTruthFields(
          stripNullish({
            authors,
            title,
            year: Number(published),
            repository: "arXiv",
            arxiv,
            doi: normalizeDoi(doi ?? null),
            url,
          }),
        ),
        cslItem: stripNullish({
          id: recordId,
          type: "article",
          title,
          author: authors.map((author) => ({ literal: author })),
          issued: { "date-parts": [[Number(published)]] },
          DOI: normalizeDoi(doi ?? null),
          URL: url,
          publisher: "arXiv",
        }),
      });
  }
  return records;
}

function basicQualityGate(record: BenchmarkBaseRecord): boolean {
  const fields = record.expectedFields;
  if (typeof fields.title !== "string" || !fields.title.trim()) return false;
  if (typeof fields.year !== "number" && typeof fields.year !== "string") return false;
  if (
    !Array.isArray(fields.authors)
    && typeof fields.institution !== "string"
    && record.referenceType !== "webpage"
    && record.referenceType !== "patent"
  ) {
    return false;
  }

  if (typeof fields.doi === "string" && !normalizeDoi(fields.doi)) return false;
  if (typeof fields.pmid === "string" && !normalizePmid(fields.pmid)) return false;
  if (typeof fields.arxiv === "string" && !normalizeArxiv(fields.arxiv)) return false;
  if (typeof fields.isbn === "string" && !normalizeIsbn(fields.isbn)) return false;
  if (typeof fields.handle === "string" && !normalizeHandle(fields.handle)) return false;
  if (typeof fields.patent === "string" && !normalizePatent(fields.patent)) return false;

  return true;
}

function qualityGate(record: BenchmarkBaseRecord): boolean {
  if (!basicQualityGate(record)) return false;
  return BENCHMARK_STYLES.every((style) => {
    try {
      const rendered = renderBenchmarkCslItem(
        {
          ...(record.cslItem as Record<string, unknown>),
          id: String(record.cslItem.id ?? record.recordId),
        },
        style,
      );
      return rendered.trim().length > 0;
    } catch {
      return false;
    }
  });
}

function dedupeRecords(records: BenchmarkBaseRecord[]): {
  records: BenchmarkBaseRecord[];
  warnings: string[];
} {
  const seen = new Map<string, BenchmarkBaseRecord>();
  const warnings: string[] = [];
  for (const record of records) {
    const key = dedupeKey(record);
    if (seen.has(key)) {
      warnings.push(`Dropped duplicate record ${record.recordId} for key ${key}.`);
      continue;
    }
    seen.set(key, record);
  }
  return { records: [...seen.values()], warnings };
}

function dedupeKey(record: BenchmarkBaseRecord): string {
  const doi = typeof record.expectedFields.doi === "string" ? normalizeDoi(record.expectedFields.doi) : null;
  if (doi) return `doi:${doi}`;
  const title = typeof record.expectedFields.title === "string" ? record.expectedFields.title.toLowerCase() : "";
  const year = String(record.expectedFields.year ?? "");
  const firstAuthor = Array.isArray(record.expectedFields.authors) ? String(record.expectedFields.authors[0] ?? "").toLowerCase() : "";
  return `fallback:${title}::${firstAuthor}::${year}`;
}

function selectBalancedRecords(
  records: BenchmarkBaseRecord[],
  targetCount: number,
): {
  records: BenchmarkBaseRecord[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const byType = new Map<BenchmarkReferenceType, BenchmarkBaseRecord[]>();
  for (const type of BENCHMARK_REFERENCE_TYPES) {
    byType.set(
      type,
      records
        .filter((record) => record.referenceType === type)
        .sort((left, right) => left.recordId.localeCompare(right.recordId)),
    );
  }

  const perTypeTarget = Math.floor(targetCount / BENCHMARK_REFERENCE_TYPES.length);
  let remainder = targetCount % BENCHMARK_REFERENCE_TYPES.length;
  const selected: BenchmarkBaseRecord[] = [];
  const overflow: BenchmarkBaseRecord[] = [];

  for (const type of BENCHMARK_REFERENCE_TYPES) {
    const available = byType.get(type) ?? [];
    const desired = perTypeTarget + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
    const accepted: BenchmarkBaseRecord[] = [];
    const rejected: BenchmarkBaseRecord[] = [];
    for (const candidate of available) {
      if (accepted.length >= desired) {
        rejected.push(candidate);
        continue;
      }
      if (qualityGate(candidate)) {
        accepted.push(candidate);
      }
    }
    if (accepted.length < desired) {
      warnings.push(`Underfilled benchmark type ${type}: expected ${desired}, found ${accepted.length}.`);
    }
    selected.push(...accepted);
    overflow.push(...rejected);
  }

  if (selected.length < targetCount) {
    for (const candidate of overflow) {
      if (selected.length >= targetCount) break;
      if (qualityGate(candidate)) {
        selected.push(candidate);
      }
    }
  }

  return {
    records: selected.slice(0, targetCount),
    warnings,
  };
}

function interleaveRows(
  cleanRows: BenchmarkManifestRow[],
  noisyRows: BenchmarkManifestRow[],
): BenchmarkManifestRow[] {
  const noisyByStem = new Map(
    noisyRows.map((row) => [row.variant_id.replace(/:noisy$/, ""), row] as const),
  );
  const manifest: BenchmarkManifestRow[] = [];

  for (const cleanRow of cleanRows) {
    manifest.push(cleanRow);
    const pairedNoisy = noisyByStem.get(cleanRow.variant_id.replace(/:clean$/, ""));
    if (pairedNoisy) {
      manifest.push(pairedNoisy);
    }
  }

  return manifest;
}

function validateBalancedSelection(
  records: BenchmarkBaseRecord[],
  mode: BenchmarkMode,
): {
  failures: string[];
  warnings: string[];
} {
  const failures: string[] = [];
  const warnings: string[] = [];
  const minimum = MODE_MINIMUMS[mode];
  const counts = new Map<BenchmarkReferenceType, number>();

  for (const record of records) {
    counts.set(record.referenceType, (counts.get(record.referenceType) ?? 0) + 1);
  }

  for (const referenceType of BENCHMARK_REFERENCE_TYPES) {
    const count = counts.get(referenceType) ?? 0;
    if (count < minimum) {
      failures.push(`Benchmark type ${referenceType} is underfilled for ${mode}: minimum ${minimum} base records required, found ${count}.`);
      continue;
    }
    if (count < Math.floor(MODE_TARGETS[mode] / BENCHMARK_REFERENCE_TYPES.length)) {
      warnings.push(`Benchmark type ${referenceType} is below the balanced target for ${mode}: found ${count} base records.`);
    }
  }

  return { failures, warnings };
}

function shouldCreateNoisyVariant(recordId: string): boolean {
  const bucket = Number.parseInt(sha256(recordId).slice(0, 8), 16) / 0xffffffff;
  return bucket <= 0.15;
}

/** Deterministically rotate each record/style across the three real-input modes for balanced coverage. */
function selectRealInputMode(recordId: string, style: string): RealInputMode {
  const bucket = Number.parseInt(sha256(`real:${recordId}:${style}`).slice(0, 8), 16) % 3;
  return (["pdf_copy", "ocr_like", "numbered_block"] as const)[bucket]!;
}

function selectNoiseType(recordId: string, style: string): BenchmarkNoiseType {
  const digest = sha256(`${recordId}:${style}`);
  const bucket = Number.parseInt(digest.slice(0, 8), 16) / 0xffffffff;
  if (bucket < 0.3) return "bare_identifier";
  if (bucket < 0.5) return "alternate_identifier_format";
  if (bucket < 0.7) return "odd_punctuation";
  if (bucket < 0.85) return "non_ascii";
  if (bucket < 0.95) return "style_specific_quirk";
  return "fake_plausible_id";
}

function applyNoise(
  formatted: string,
  noise: BenchmarkNoiseType,
  expectedFields: Record<string, unknown>,
): string {
  switch (noise) {
    case "bare_identifier":
      // Data-preserving: the DOI is KEPT - only its "https://doi.org/" wrapper is stripped,
      // leaving the bare "10.xxxx/..." form many exports use. No scored field is deleted: a
      // benchmark must not penalize the engine for data absent from the input, and the DOI is
      // an anchor that makes the whole reference MORE recoverable. (Formerly deleted DOI+year.)
      return formatted.replace(/https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/\s{2,}/g, " ").trim();
    case "alternate_identifier_format":
      if (typeof expectedFields.doi === "string") {
        return formatted.replace(
          /https?:\/\/doi\.org\//i,
          "doi:",
        );
      }
      if (typeof expectedFields.arxiv === "string") {
        return `${formatted} arXiv:${expectedFields.arxiv}`;
      }
      return formatted;
    case "odd_punctuation":
      // Realistic copy-paste spacing irregularity (uneven/double spaces after punctuation).
      // (Previously replaced EVERY comma with ";", which no real reference does and which made
      // author lists and field boundaries ambiguous — "Smith, J." vs "Smith; J.".)
      return formatted.replace(/([.,;:])\s/g, "$1  ").trim();
    case "non_ascii":
      return formatted.replace(/e/g, "é").replace(/a/g, "à");
    case "style_specific_quirk":
      // A real style variation: page numbers without the "pp."/"p." prefix. (Previously this
      // also replaced every comma with a space, which no citation style does and which erased
      // the field-delimiter structure the parser depends on.)
      return formatted.replace(/\bpp?\.\s*/i, "");
    case "fake_plausible_id":
      if (typeof expectedFields.arxiv === "string") {
        return formatted.replace(expectedFields.arxiv, "9999.99999");
      }
      if (typeof expectedFields.doi === "string") {
        return `${formatted} doi:10.9999/fake-doi`;
      }
      return `${formatted} PMID:99999999`;
  }
}

function mapReferenceTypeToCslType(referenceType: BenchmarkReferenceType): string {
  switch (referenceType) {
    case "article-journal":
      return "article-journal";
    case "conference-paper":
      return "paper-conference";
    case "book":
      return "book";
    case "book-chapter":
      return "chapter";
    case "preprint":
      return "article";
    case "thesis":
      return "thesis";
    case "report":
      return "report";
    case "patent":
      return "patent";
    case "webpage":
      return "webpage";
  }
}

function buildCrossrefExpectedFields(
  referenceType: BenchmarkReferenceType,
  input: {
    authors: string[];
    title: string;
    year: number;
    containerTitle: string | null;
    volume: string | null;
    issue: string | null;
    pages: string | null;
    doi: string | null;
    publisher: string | null;
    url: string | null;
    reportNumber: string | null;
    isbn: string | null;
    issn: string | null;
    handle: string | null;
    thesisType: string | null;
  },
): Record<string, TruthFieldValue> {
  const common = stripNullish({
    ...(input.authors.length > 0 ? { authors: input.authors } : {}),
    title: input.title,
    year: input.year,
    ...(input.doi ? { doi: input.doi } : {}),
    ...(input.url ? { url: input.url } : {}),
  });

  switch (referenceType) {
    case "article-journal":
      return {
        ...common,
        ...stripNullish({
          journal: input.containerTitle,
          volume: input.volume,
          issue: input.issue,
          pages: input.pages,
          issn: input.issn,
        }),
      };
    case "conference-paper":
      return {
        ...common,
        ...stripNullish({
          conferenceTitle: input.containerTitle,
          pages: input.pages,
          isbn: input.isbn,
          publisher: input.publisher,
        }),
      };
    case "book":
      return {
        ...common,
        ...stripNullish({
          publisher: input.publisher,
          isbn: input.isbn,
        }),
      };
    case "book-chapter":
      return {
        ...common,
        ...stripNullish({
          bookTitle: input.containerTitle,
          pages: input.pages,
          isbn: input.isbn,
          publisher: input.publisher,
        }),
      };
    case "preprint":
      return {
        ...common,
        ...stripNullish({
          repository: input.publisher,
          arxiv: input.url ? normalizeArxiv(input.url) : null,
        }),
      };
    case "thesis":
      return {
        ...common,
        ...stripNullish({
          institution: input.publisher,
          thesisType: input.thesisType,
          handle: input.handle,
        }),
      };
    case "report":
      return {
        ...common,
        ...stripNullish({
          institution: input.publisher,
          reportNumber: input.reportNumber,
          issn: input.issn,
          isbn: input.isbn,
        }),
      };
    case "patent":
      return {
        ...common,
        ...stripNullish({
          patent: input.reportNumber,
        }),
      };
    case "webpage":
      return {
        ...common,
        ...stripNullish({
          siteName: input.containerTitle ?? input.publisher,
          accessedDate: input.year ? `${input.year}` : null,
        }),
      };
  }
}

function looksLikePreprint(work: Record<string, unknown>): boolean {
  const haystack = [
    stringOrNull(work.publisher),
    firstString(work.title),
    stringOrNull(work.URL),
    firstString(work.subtype),
  ]
    .filter(Boolean)
    .join(" ");
  return /(arxiv|biorxiv|medrxiv|ssrn|preprint)/i.test(haystack);
}

function buildSeedCslItem(
  referenceType: BenchmarkReferenceType,
  recordId: string,
  expectedFields: Record<string, TruthFieldValue>,
  sourceUrl: string,
): Record<string, unknown> {
  const authors = Array.isArray(expectedFields.authors)
    ? expectedFields.authors.map((author) => authorToCslName(String(author)))
    : [];
  const institutionAuthor = typeof expectedFields.institution === "string"
    ? [{ literal: expectedFields.institution }]
    : [];
  const issuedYear = Number.parseInt(String(expectedFields.year ?? 0), 10) || undefined;

  return stripNullish({
    id: recordId,
    type: mapReferenceTypeToCslType(referenceType),
    title: typeof expectedFields.title === "string" ? expectedFields.title : undefined,
    author: authors.length > 0 ? authors : institutionAuthor,
    issued: issuedYear ? { "date-parts": [[issuedYear]] } : undefined,
    "container-title":
      (referenceType === "article-journal" && typeof expectedFields.journal === "string" && expectedFields.journal)
      || (referenceType === "book-chapter" && typeof expectedFields.bookTitle === "string" && expectedFields.bookTitle)
      || (referenceType === "webpage" && typeof expectedFields.siteName === "string" && expectedFields.siteName)
      || undefined,
    "event-title":
      referenceType === "conference-paper" && typeof expectedFields.conferenceTitle === "string"
        ? expectedFields.conferenceTitle
        : undefined,
    publisher:
      (typeof expectedFields.publisher === "string" && expectedFields.publisher)
      || (typeof expectedFields.institution === "string" && expectedFields.institution)
      || (typeof expectedFields.repository === "string" && expectedFields.repository)
      || undefined,
    volume: typeof expectedFields.volume === "string" ? expectedFields.volume : undefined,
    issue: typeof expectedFields.issue === "string" ? expectedFields.issue : undefined,
    page: typeof expectedFields.pages === "string" ? expectedFields.pages : undefined,
    DOI: typeof expectedFields.doi === "string" ? expectedFields.doi : undefined,
    URL:
      (typeof expectedFields.url === "string" && expectedFields.url)
      || sourceUrl,
    ISBN: typeof expectedFields.isbn === "string" ? expectedFields.isbn : undefined,
    ISSN: typeof expectedFields.issn === "string" ? expectedFields.issn : undefined,
    number:
      (typeof expectedFields.reportNumber === "string" && expectedFields.reportNumber)
      || (typeof expectedFields.patent === "string" && expectedFields.patent)
      || undefined,
    genre: typeof expectedFields.thesisType === "string" ? expectedFields.thesisType : undefined,
  });
}

function authorToCslName(author: string): { family?: string; given?: string; literal?: string } {
  const trimmed = author.trim();
  if (!trimmed) return { literal: "" };
  if (!trimmed.includes(",")) return { literal: trimmed };
  const [family, ...rest] = trimmed.split(",");
  const normalizedFamily = family?.trim();
  const normalizedGiven = rest.join(",").trim();
  const normalized: { family?: string; given?: string; literal?: string } = {};
  if (normalizedFamily) normalized.family = normalizedFamily;
  if (normalizedGiven) normalized.given = normalizedGiven;
  return normalized;
}

function normalizeAuthors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry) => {
      if (typeof entry !== "object" || entry == null) return [];
      const family = typeof (entry as { family?: unknown }).family === "string"
        ? (entry as { family: string }).family.trim()
        : "";
      const given = typeof (entry as { given?: unknown }).given === "string"
        ? (entry as { given: string }).given.trim()
        : "";
      if (family && given) return [`${family}, ${given}`];
      if (family) return [family];
      return [];
    });
}

function extractCrossrefYear(work: Record<string, unknown>): number | null {
  for (const key of ["published-print", "published-online", "created", "issued"]) {
    const dateParts = (work[key] as { "date-parts"?: number[][] } | undefined)?.["date-parts"]?.[0]?.[0];
    if (typeof dateParts === "number") return dateParts;
  }
  return null;
}

function firstString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stripNullish<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry == null) return false;
      if (Array.isArray(entry)) return entry.length > 0;
      if (typeof entry === "string") return entry.trim().length > 0;
      return true;
    }),
  ) as T;
}

function stableRecordId(
  referenceType: BenchmarkReferenceType,
  sourceUrl: string,
  title: string,
  year: number,
): string {
  return `${referenceType}-${sha256(`${sourceUrl}::${title}::${year}`).slice(0, 16)}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
