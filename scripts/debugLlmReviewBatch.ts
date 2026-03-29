import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { processV2Conversion } from "../server/engine/v2/pipeline.js";

type StressCitation = {
  raw: string;
  bucket?: string;
  quality?: { bucket?: string };
};

type BatchSummaryEntry = {
  index: number;
  sourceBucket: string;
  finalBucket: string | null;
  raw: string;
  extractorPath: string | null;
  llmFallbackAttempted: boolean;
  llmFallbackAccepted: boolean;
  llmFallbackReason: string | null;
  llmFallbackSkippedByBudget: boolean;
  llmFallbackFieldsImproved: string[];
  parsed: {
    authors?: unknown;
    title?: unknown;
    year?: unknown;
    journal?: unknown;
    volume?: unknown;
    issue?: unknown;
    pages?: unknown;
    doi?: unknown;
    url?: unknown;
  };
  llmDebug: {
    trigger?: unknown;
    rawExtraction?: unknown;
    beforeParsed?: unknown;
    candidateAfterMerge?: unknown;
    failureMessage?: unknown;
    extractStageDebug?: unknown;
  };
};

function readArg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function resolveBucket(citation: StressCitation): string {
  return citation.bucket ?? citation.quality?.bucket ?? "unknown";
}

function sampleCitations(citations: StressCitation[], sampleSize: number) {
  const review = citations.filter((citation) => resolveBucket(citation) === "worth_reviewing");
  const actionNeeded = citations.filter((citation) => resolveBucket(citation) === "action_needed");
  const half = Math.floor(sampleSize / 2);
  const selected = [
    ...actionNeeded.slice(0, half),
    ...review.slice(0, sampleSize - half),
  ];

  if (selected.length >= sampleSize) {
    return selected.slice(0, sampleSize);
  }

  const fallbackPool = citations.filter((citation) => !selected.includes(citation));
  return [...selected, ...fallbackPool.slice(0, sampleSize - selected.length)];
}

async function main() {
  const sampleSize = Number.parseInt(readArg("--sample-size", "20") ?? "20", 10);
  const sourcePath = readArg("--source", "output/stress/20260321-130912Z-stress-batch-20260321.json")!;
  const absoluteSourcePath = path.resolve(process.cwd(), sourcePath);

  if (!fs.existsSync(absoluteSourcePath)) {
    throw new Error(`Source file not found: ${absoluteSourcePath}`);
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  process.env.ENABLE_LLM_EXTRACTOR = "true";
  process.env.V2_LLM_MAX_CALLS_SYNC = process.env.V2_LLM_MAX_CALLS_SYNC ?? String(sampleSize);
  process.env.V2_EXTRACT_FALLBACK_RATE_PER_BATCH = process.env.V2_EXTRACT_FALLBACK_RATE_PER_BATCH ?? "1";
  process.env.V2_EXTRACT_FALLBACK_MAX_CALLS_PER_BATCH = process.env.V2_EXTRACT_FALLBACK_MAX_CALLS_PER_BATCH ?? String(sampleSize);

  const sourcePayload = JSON.parse(fs.readFileSync(absoluteSourcePath, "utf8")) as { citations?: StressCitation[] };
  const sourceCitations = sourcePayload.citations ?? [];
  const selected = sampleCitations(sourceCitations, sampleSize);

  if (selected.length === 0) {
    throw new Error("No citations were selected for the batch.");
  }

  const { response } = await processV2Conversion({
    sourceType: "text",
    content: selected.map((citation) => citation.raw).join("\n\n"),
    inputStyle: "auto",
    outputStyle: "apa",
    enrich: false,
    dedup: false,
    group: false,
    debug: true,
  }, {
    executionMode: "sync",
  });

  const debugCitationById = new Map(
    (response.debug?.citations ?? []).map((citation) => [
      citation.citationId,
      citation.stages ?? {},
    ]),
  );

  const entries: BatchSummaryEntry[] = response.citations.map((citation, index) => {
    const citationDebug = debugCitationById.get(citation.id) as Record<string, unknown> | undefined;
    const extractDebug = (citationDebug?.extract ?? {}) as Record<string, unknown>;

    return {
      index,
      sourceBucket: resolveBucket(selected[index] ?? {}),
      finalBucket: citation.quality?.bucket ?? null,
      raw: citation.raw,
      extractorPath: citation.extraction?.extractorPath ?? null,
      llmFallbackAttempted: Boolean(citation.extraction?.llmFallbackAttempted),
      llmFallbackAccepted: Boolean(citation.extraction?.llmFallbackAccepted),
      llmFallbackReason: citation.extraction?.llmFallbackReason ?? null,
      llmFallbackSkippedByBudget: Boolean(citation.extraction?.llmFallbackSkippedByBudget),
      llmFallbackFieldsImproved: citation.extraction?.llmFallbackFieldsImproved ?? [],
      parsed: {
        authors: citation.authors.value,
        title: citation.title.value,
        year: citation.year.value,
        journal: citation.journal.value,
        volume: citation.volume.value,
        issue: citation.issue.value,
        pages: citation.pages.value,
        doi: citation.doi.value,
        url: citation.url.value,
      },
      llmDebug: {
        trigger: extractDebug.llm_trigger,
        rawExtraction: extractDebug.llm_raw_extraction,
        beforeParsed: extractDebug.llm_before_parsed,
        candidateAfterMerge: extractDebug.llm_candidate_after_merge,
        failureMessage: extractDebug.llm_failure_message,
        extractStageDebug: extractDebug,
      },
    };
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    sourcePath: absoluteSourcePath,
    sampleSize: selected.length,
    llmEnv: {
      enabled: process.env.ENABLE_LLM_EXTRACTOR,
      model: process.env.OPENAI_EXTRACT_MODEL ?? "gpt-5.4-nano",
      maxCallsSync: process.env.V2_LLM_MAX_CALLS_SYNC,
      fallbackRatePerBatch: process.env.V2_EXTRACT_FALLBACK_RATE_PER_BATCH,
      fallbackMaxCallsPerBatch: process.env.V2_EXTRACT_FALLBACK_MAX_CALLS_PER_BATCH,
    },
    jobDebug: response.debug?.jobStages ?? null,
    counts: {
      attempted: entries.filter((entry) => entry.llmFallbackAttempted).length,
      accepted: entries.filter((entry) => entry.llmFallbackAccepted).length,
      skippedByBudget: entries.filter((entry) => entry.llmFallbackSkippedByBudget).length,
    },
    entries,
  };

  const outPath = path.resolve(process.cwd(), `output/llm-review-batch-${selected.length}.json`);
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), "utf8");

  console.log(`Wrote LLM review batch debug report to ${outPath}`);
  console.log(JSON.stringify(summary.counts, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
