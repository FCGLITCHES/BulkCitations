import 'dotenv/config';
import { stdin as input } from 'node:process';
import { processV2Conversion } from '../server/engine/v2/pipeline.js';

function parseArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

function splitCitations(raw: string): string[] {
  return raw
    .split(/\r?\n\s*\r?\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  const rawInput = parseArg('--input') ?? await readStdin();
  if (!rawInput) {
    throw new Error('Pass --input \"<citations>\" or pipe blank-line separated citations into stdin.');
  }

  const citations = splitCitations(rawInput);
  if (citations.length === 0) {
    throw new Error('No citations found in the provided input.');
  }

  const inputStyle = parseArg('--style') ?? 'auto';
  const outputStyle = parseArg('--output-style') ?? 'apa';

  process.env.ENABLE_LLM_EXTRACTOR = 'true';

  const { response } = await processV2Conversion({
    sourceType: 'text',
    content: citations.join('\n\n'),
    inputStyle,
    outputStyle,
    enrich: false,
    dedup: false,
    group: false,
    debug: true,
  }, {
    executionMode: 'sync',
  });

  const debugCitationById = new Map(
    (response.debug?.citations ?? []).map((citation) => [citation.citationId, citation.stages ?? {}]),
  );

  const entries = response.citations.map((citation, index) => {
    const citationDebug = debugCitationById.get(citation.id) as Record<string, unknown> | undefined;
    const extractDebug = (citationDebug?.extract ?? {}) as Record<string, unknown>;

    return {
      index: index + 1,
      raw: citation.raw,
      bucket: citation.quality?.bucket ?? null,
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
        bookTitle: citation.bookTitle.value,
        conferenceTitle: citation.conferenceTitle.value,
        publisher: citation.publisher.value,
        institution: citation.institution.value,
        volume: citation.volume.value,
        issue: citation.issue.value,
        pages: citation.pages.value,
        doi: citation.doi.value,
        url: citation.url.value,
      },
      failureMessage: extractDebug.llm_failure_message ?? null,
      trigger: extractDebug.llm_trigger ?? null,
    };
  });

  const summary = {
    mode: 'pipeline',
    count: citations.length,
    llmAttempted: entries.filter((entry) => entry.llmFallbackAttempted).length,
    llmAccepted: entries.filter((entry) => entry.llmFallbackAccepted).length,
    llmSkippedByBudget: entries.filter((entry) => entry.llmFallbackSkippedByBudget).length,
    extractorPaths: Object.fromEntries(
      Object.entries(entries.reduce<Record<string, number>>((acc, entry) => {
        const key = entry.extractorPath ?? 'unknown';
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {})).sort(([left], [right]) => left.localeCompare(right)),
    ),
    entries,
  };

  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
