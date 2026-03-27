/**
 * Finale stress test: 2500 real-life citations.
 * - 1500 from manual-1500-batch.txt (curated real citations)
 * - 1000 from OpenAlex (journal articles)
 * - Batches of 500 to avoid overload
 * - Tests conversion to APA, IEEE, Vancouver (round-robin)
 * Run with: npx tsx scripts/stressFinale2500.ts
 * Server must be running: npm run dev
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const TARGET_TOTAL = 2500;
const MANUAL_COUNT = 1500;
const OPENALEX_COUNT = 1000;
const BATCH_SIZE = 500;
export const API_BASE = "http://127.0.0.1:5000";

const OUTPUT_STYLES = ["apa", "ieee", "vancouver"] as const;

export type FinaleCase = {
  id: string;
  raw: string;
  source: "manual" | "openalex";
  outputStyle: (typeof OUTPUT_STYLES)[number];
  expected?: { year?: string; titleToken?: string; firstAuthorFamily?: string; venueToken?: string };
};

type ApiReference = {
  id: string;
  originalText: string;
  convertedText: string;
  referenceType: string;
  parsedData: Record<string, any>;
  inputStyle: string;
  outputStyle: string;
  styleDetectionFailed?: boolean;
};

function loadManualBatch(): string[] {
  const manualPath = path.resolve(process.cwd(), "manual-1500-batch.txt");
  if (!fs.existsSync(manualPath)) {
    console.warn("manual-1500-batch.txt not found, using empty");
    return [];
  }
  const content = fs.readFileSync(manualPath, "utf8");
  return content
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MANUAL_COUNT);
}

async function fetchOpenAlexWorks(count: number): Promise<Array<{ raw: string }>> {
  const OPENALEX_PER_PAGE = 200;
  const results: Array<{ raw: string }> = [];
  let page = 1;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    while (results.length < count) {
      const url = `https://api.openalex.org/works?filter=type:journal-article,from_publication_date:2015-01-01&per_page=${OPENALEX_PER_PAGE}&page=${page}`;
      const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`OpenAlex failed: ${res.status}`);
    const data = (await res.json()) as { results?: any[] };
    const list = data.results || [];

    for (let i = 0; i < list.length && results.length < count; i++) {
      const w = list[i];
      const title = (w.title || "").trim();
      const year = w.publication_year != null ? String(w.publication_year) : "";
      const authors = (w.authorships || [])
        .map((a: any) => a.raw_author_name || a.author?.display_name || "")
        .filter(Boolean)
        .slice(0, 4);
      const src = w.primary_location?.source;
      const journal = (src?.display_name || "").trim();
      const b = w.biblio || {};
      const vol = b.volume || "";
      const issue = b.issue || "";
      const firstPage = b.first_page || "";
      const lastPage = b.last_page || "";
      const pages = firstPage && lastPage ? `${firstPage}-${lastPage}` : firstPage || lastPage || "";

      if (!title || !year) continue;

      const authorStr = authors.length ? authors.join(", ") : "Unknown";
      const apa = `${authorStr} (${year}). ${title}. ${journal || "Journal"}, ${vol ? vol + (issue ? `(${issue})` : "") : "?"}${pages ? `, ${pages}` : ""}.`;
      results.push({ raw: apa });
    }
    if (list.length < OPENALEX_PER_PAGE) break;
    page++;
  }
  return results.slice(0, count);
  } finally {
    clearTimeout(timeout);
  }
}

function buildCases(manualRefs: string[], openalexRefs: Array<{ raw: string }>): FinaleCase[] {
  const cases: FinaleCase[] = [];
  let idx = 0;

  for (const raw of manualRefs) {
    const outputStyle = OUTPUT_STYLES[idx % OUTPUT_STYLES.length];
    cases.push({
      id: `manual-${idx}`,
      raw,
      source: "manual",
      outputStyle,
    });
    idx++;
  }

  for (let i = 0; i < openalexRefs.length; i++) {
    const outputStyle = OUTPUT_STYLES[(manualRefs.length + i) % OUTPUT_STYLES.length];
    cases.push({
      id: `oa-${i}`,
      raw: openalexRefs[i].raw,
      source: "openalex",
      outputStyle,
    });
  }

  return cases.slice(0, TARGET_TOTAL);
}

async function runBatchesSimple(cases: FinaleCase[]): Promise<ApiReference[]> {
  const all: ApiReference[] = new Array(cases.length);
  for (let offset = 0; offset < cases.length; offset += BATCH_SIZE) {
    const chunk = cases.slice(offset, offset + BATCH_SIZE);
    for (const outputStyle of OUTPUT_STYLES) {
      const indices: number[] = [];
      const refs: string[] = [];
      chunk.forEach((c, i) => {
        if (c.outputStyle === outputStyle) {
          indices.push(offset + i);
          refs.push(c.raw);
        }
      });
      if (refs.length === 0) continue;
      const body = {
        references: refs,
        inputStyle: "auto",
        outputStyle,
        isPro: false,
        enrichWithAuthority: false,
      };
      const res = await fetch(`${API_BASE}/api/convert`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`API batch failed: ${res.status}`);
      const payload = (await res.json()) as { convertedReferences: ApiReference[] };
      const converted = payload.convertedReferences || [];
      indices.forEach((idx, j) => {
        all[idx] = converted[j];
      });
    }
    const batchNum = Math.floor(offset / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(cases.length / BATCH_SIZE);
    console.log(`  Batch ${batchNum}/${totalBatches} done`);
  }
  return all;
}

function evaluate(cases: FinaleCase[], converted: ApiReference[]) {
  const failures: Array<{ id: string; source: string; categories: string[]; actual?: Record<string, unknown> }> = [];
  const byCategory: Record<string, number> = {};
  const bySource: Record<string, { total: number; failed: number }> = { manual: { total: 0, failed: 0 }, openalex: { total: 0, failed: 0 } };
  const byStyle: Record<string, { total: number; failed: number }> = {};

  cases.forEach((tc, index) => {
    const ref = converted[index];
    bySource[tc.source].total++;
    byStyle[tc.outputStyle] = byStyle[tc.outputStyle] || { total: 0, failed: 0 };
    byStyle[tc.outputStyle].total++;

    const categories: string[] = [];
    if (!ref) {
      categories.push("missing-response");
    } else {
      const parsed = ref.parsedData || {};
      if (ref.styleDetectionFailed) categories.push("style-detection");
      if ((ref.referenceType || "").toLowerCase() === "other") categories.push("reference-type");
      if (!parsed.title || /Unknown Title/i.test(parsed.title)) categories.push("title");
      if (!parsed.year) categories.push("year");
      if (!ref.convertedText || ref.convertedText.length < 10) categories.push("empty-output");
      if (tc.outputStyle === "ieee" && !/^\[\d+\]\s+/.test((ref.convertedText || "").trim())) {
        categories.push("ieee-format");
      }
    }

    if (categories.length > 0) {
      failures.push({
        id: tc.id,
        source: tc.source,
        categories,
        actual: ref ? { outputStyle: ref.outputStyle, output: ref.convertedText?.slice(0, 150) } : undefined,
      });
      bySource[tc.source].failed++;
      byStyle[tc.outputStyle].failed++;
      for (const c of categories) byCategory[c] = (byCategory[c] || 0) + 1;
    }
  });

  return { failures, byCategory, bySource, byStyle };
}

async function run() {
  console.log("Loading manual-1500-batch.txt...");
  const manualRefs = loadManualBatch();
  console.log(`Loaded ${manualRefs.length} manual refs.`);

  let openalexRefs: Array<{ raw: string }> = [];
  try {
    console.log("Fetching OpenAlex works...");
    openalexRefs = await fetchOpenAlexWorks(OPENALEX_COUNT);
    console.log(`Fetched ${openalexRefs.length} OpenAlex refs.`);
  } catch (err) {
    console.warn("OpenAlex fetch failed (network/timeout), continuing with manual refs only:", (err as Error).message);
  }

  const cases = buildCases(manualRefs, openalexRefs);
  console.log(`Total cases: ${cases.length} (batches of ${BATCH_SIZE})`);

  console.log("Sending to converter...");
  const converted = await runBatchesSimple(cases);
  console.log(`Received ${converted.length} converted references.`);

  const { failures, byCategory, bySource, byStyle } = evaluate(cases, converted);

  const report = {
    generatedAt: new Date().toISOString(),
    totalCases: cases.length,
    totalFailures: failures.length,
    passRate: Number((((cases.length - failures.length) / cases.length) * 100).toFixed(2)),
    byCategory,
    bySource,
    byStyle,
    sampleFailures: failures.slice(0, 30),
  };

  const outPath = path.resolve(process.cwd(), "stress-finale-2500-report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  const reliablePath = path.resolve(process.cwd(), "data", "stress-reliable-2500.jsonl");
  const failureIds = new Set(failures.map((f) => f.id));
  const reliableLines = cases
    .map((c, i) => ({ c, ref: converted[i] }))
    .filter(({ c }) => !failureIds.has(c.id))
    .slice(0, 500)
    .map(({ c, ref }) =>
      JSON.stringify({
        id: c.id,
        raw: c.raw,
        source: c.source,
        outputStyle: c.outputStyle,
        convertedText: ref?.convertedText,
        parsedData: ref?.parsedData ? { year: ref.parsedData.year, title: ref.parsedData.title } : {},
      })
    )
    .join("\n");
  fs.mkdirSync(path.dirname(reliablePath), { recursive: true });
  fs.writeFileSync(reliablePath, reliableLines + (reliableLines ? "\n" : ""), "utf8");

  console.log("\n--- Finale 2500 report ---");
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nReport: ${outPath}`);
  console.log(`Reliable data (500 passing): ${reliablePath}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
