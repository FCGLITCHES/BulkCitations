/**
 * Finale stress test: 1000 journal-article citations.
 * - All from OpenAlex (type: journal-article), realistic refs in APA, IEEE, Vancouver, Harvard, MLA, Chicago.
 * - No conference/proceedings, no curated edge cases.
 * Run with: npx tsx scripts/stressFinale1000.ts
 * Server must be running: npm run dev
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const TARGET_TOTAL = 1000;
export const OPENALEX_PER_PAGE = 200;
export const OPENALEX_MAX_PAGES = 8; // fetch until we have 1000 journal articles
const BATCH_SIZE = 200;
export const API_BASE = "http://127.0.0.1:5000";

/** Debug IDs for Phase 0 mini harness: 4 Harvard + 4 APA reference-type other + 7 for detection/title/venue. */
export const DEBUG_IDS = [
  "oa-33", "oa-51", "oa-123", "oa-285",  // Harvard
  "oa-72", "oa-105", "oa-159", "oa-225", // APA reference-type other
  "oa-25", "oa-169", "oa-234", "oa-15", "oa-30", "oa-39",
];

export type Style = "apa" | "ieee" | "vancouver" | "harvard" | "mla" | "chicago";

export type Author = { family: string; given: string };

export type Work = {
  id: string;
  type: "journal" | "conference";
  title: string;
  year: string;
  authors: Author[];
  journal?: string;
  conferenceTitle?: string;
  publisher?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  articleNumber?: string;
  month?: string;
  venueToken: string;
};

export type FinaleCase = {
  id: string;
  raw: string;
  source: "openalex" | "curated";
  style?: Style;
  expected?: {
    year: string;
    titleToken: string;
    firstAuthorFamily: string;
    venueToken: string;
    referenceType: "journal" | "conference";
  };
};

// --- OpenAlex types (minimal) ---
type OpenAlexAuthor = { author: { display_name: string }; raw_author_name?: string };
type OpenAlexWork = {
  id: string;
  title: string;
  publication_year: number | null;
  authorships: OpenAlexAuthor[];
  biblio?: { volume?: string; issue?: string; first_page?: string; last_page?: string };
  primary_location?: {
    source?: { display_name: string; type?: string };
    raw_type?: string;
  };
  type?: string;
};

export function parseAuthor(displayName: string): Author {
  const raw = (displayName || "").trim();
  if (!raw) return { family: "Unknown", given: "" };
  if (raw.includes(",")) {
    const [family, ...givenParts] = raw.split(",").map(s => s.trim());
    return { family: family || "Unknown", given: givenParts.join(" ").trim() };
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { family: "Unknown", given: "" };
  if (parts.length === 1) return { family: parts[0], given: "" };
  const family = parts[parts.length - 1];
  const given = parts.slice(0, -1).join(" ");
  return { family, given };
}

export function workFromOpenAlex(w: OpenAlexWork, index: number): Work | null {
  const title = (w.title || "").trim();
  const year = (w.publication_year != null ? String(w.publication_year) : "").trim();
  if (!title || !year) return null;

  const authors = (w.authorships || [])
    .map(a => (a.raw_author_name || a.author?.display_name || "").trim())
    .filter(Boolean)
    .slice(0, 8)
    .map(parseAuthor);
  if (authors.length === 0) authors.push({ family: "Unknown", given: "" });

  const src = w.primary_location?.source;
  const journalName = (src?.display_name || "").trim();
  const rawType = (w.primary_location?.raw_type || w.type || "").toLowerCase();
  const isProceeding =
    rawType === "proceeding" ||
    /proceeding|conference|proc\.|workshop/i.test(journalName);

  const b = w.biblio || {};
  const volume = (b.volume || "").trim();
  const issue = (b.issue || "").trim();
  let firstPage = (b.first_page || "").trim();
  const lastPage = (b.last_page || "").trim();
  if (firstPage && lastPage && firstPage !== lastPage) {
    firstPage = `${firstPage}-${lastPage}`;
  } else if (!firstPage && lastPage) firstPage = lastPage;
  const pages = firstPage || undefined;

  const venueToken = journalName
    ? journalName.replace(/\s*(?:proceedings?|proc\.?|conference|workshop)\s*/gi, " ").trim()
    : "Unknown";

  // Exclude conference/proceedings — test set is journals only
  if (isProceeding) return null;

  // Require a real journal name (no placeholders, no empty)
  const journal = (journalName || "").trim();
  if (!journal || journal.length < 2) return null;

  return {
    id: `oa-${index}`,
    type: "journal",
    title,
    year,
    authors,
    journal,
    volume,
    issue: issue || undefined,
    pages,
    venueToken: venueToken || journal,
  };
}

// --- Render helpers (same logic as stressMixedCitations) ---
export function compactInitials(g: string): string {
  return g.replace(/[^A-Z]/g, "");
}
export function tightInitials(g: string): string {
  return g.replace(/\s+/g, "");
}
export function firstLast(a: Author): string {
  return `${a.given} ${a.family}`;
}
export function inverted(a: Author): string {
  return `${a.family}, ${a.given}`;
}
export function harvardInverted(a: Author): string {
  return `${a.family}, ${tightInitials(a.given)}`;
}
export function vancouverName(a: Author): string {
  return `${a.family} ${compactInitials(a.given)}`;
}
export function apaAuthors(authors: Author[]): string {
  if (authors.length === 1) return inverted(authors[0]);
  if (authors.length === 2) return `${inverted(authors[0])}, & ${inverted(authors[1])}`;
  return `${authors.slice(0, -1).map(inverted).join(", ")}, & ${inverted(authors[authors.length - 1])}`;
}
export function harvardAuthors(authors: Author[]): string {
  if (authors.length === 1) return harvardInverted(authors[0]);
  if (authors.length === 2) return `${harvardInverted(authors[0])} and ${harvardInverted(authors[1])}`;
  return `${authors.slice(0, -1).map(harvardInverted).join(", ")} and ${harvardInverted(authors[authors.length - 1])}`;
}
export function ieeeAuthors(authors: Author[]): string {
  if (authors.length === 1) return firstLast(authors[0]);
  if (authors.length === 2) return `${firstLast(authors[0])} and ${firstLast(authors[1])}`;
  return `${authors.slice(0, -1).map(firstLast).join(", ")}, and ${firstLast(authors[authors.length - 1])}`;
}
export function vancouverAuthors(authors: Author[]): string {
  return `${authors.map(vancouverName).join(", ")}.`;
}
export function mlaAuthors(authors: Author[]): string {
  if (authors.length === 1) return `${inverted(authors[0])}.`;
  const rest = authors.slice(1).map(firstLast);
  if (rest.length === 1) return `${inverted(authors[0])}, and ${rest[0]}.`;
  return `${inverted(authors[0])}, ${rest.slice(0, -1).join(", ")}, and ${rest[rest.length - 1]}.`;
}
export function chicagoAuthors(authors: Author[]): string {
  if (authors.length === 1) return `${inverted(authors[0])}.`;
  const rest = authors.slice(1).map(firstLast);
  if (rest.length === 1) return `${inverted(authors[0])}, and ${rest[0]}.`;
  return `${inverted(authors[0])}, ${rest.slice(0, -1).join(", ")}, and ${rest[rest.length - 1]}.`;
}

export function renderJournal(work: Work, style: Style): string {
  const locator = work.pages
    ? work.pages
    : work.articleNumber
      ? `Article ${work.articleNumber}`
      : "";
  const volIssue = `${work.volume || "?"}${work.issue ? `(${work.issue})` : ""}`;
  switch (style) {
    case "apa":
      return `${apaAuthors(work.authors)} (${work.year}). ${work.title}. ${work.journal}, ${volIssue}${locator ? `, ${locator}` : ""}.`;
    case "ieee":
      return `${ieeeAuthors(work.authors)}, "${work.title}," ${work.journal}, vol. ${work.volume || "?"}${work.issue ? `, no. ${work.issue}` : ""}${work.pages ? `, pp. ${work.pages}` : work.articleNumber ? `, Art. no. ${work.articleNumber}` : ""}, ${work.year}.`;
    case "vancouver":
      return `${vancouverAuthors(work.authors)} ${work.title}. ${work.journal}. ${work.year};${volIssue}:${work.pages || work.articleNumber || ""}.`;
    case "harvard":
      return `${harvardAuthors(work.authors)}, ${work.year}. ${work.title}. ${work.journal}, ${volIssue}${work.pages ? `, pp.${work.pages}` : work.articleNumber ? `, Article ${work.articleNumber}` : ""}.`;
    case "mla":
      return `${mlaAuthors(work.authors)} "${work.title}." ${work.journal}, vol. ${work.volume || "?"}${work.issue ? `, no. ${work.issue}` : ""}, ${work.year}${work.pages ? `, pp. ${work.pages}` : work.articleNumber ? `, Article ${work.articleNumber}` : ""}.`;
    case "chicago":
      return `${chicagoAuthors(work.authors)} "${work.title}." ${work.journal} ${work.volume || "?"}${work.issue ? `, no. ${work.issue}` : ""} (${work.year})${work.pages ? `: ${work.pages}` : work.articleNumber ? `: Article ${work.articleNumber}` : ""}.`;
  }
}

export function renderConference(work: Work, style: Style): string {
  const month = work.month || "January";
  const pub = work.publisher || "IEEE";
  switch (style) {
    case "apa":
      return `${apaAuthors(work.authors)} (${work.year}, ${month}). ${work.title}. In ${work.conferenceTitle}${work.pages ? ` (pp. ${work.pages})` : ""}. ${pub}.`;
    case "ieee":
      return `${ieeeAuthors(work.authors)}, "${work.title}," in Proc. ${work.conferenceTitle}${work.pages ? `, pp. ${work.pages}` : ""}, ${work.year}.`;
    case "vancouver":
      return `${vancouverAuthors(work.authors)} ${work.title}. In ${work.conferenceTitle} ${work.year}${work.pages ? ` (pp. ${work.pages})` : ""}. ${pub}.`;
    case "harvard":
      return `${harvardAuthors(work.authors)}, ${work.year}, ${month}. ${work.title}. In ${work.conferenceTitle}${work.pages ? ` (pp. ${work.pages})` : ""}. ${pub}.`;
    case "mla":
      return `${mlaAuthors(work.authors)} "${work.title}." ${work.conferenceTitle}.${work.pages ? ` pp. ${work.pages}.` : ""} ${pub}, ${work.year}.`;
    case "chicago":
      return `${chicagoAuthors(work.authors)} "${work.title}." In ${work.conferenceTitle}${work.pages ? `, pp. ${work.pages}` : ""}. ${pub}, ${work.year}.`;
  }
}

export function renderCitation(work: Work, style: Style): string {
  return work.type === "journal" ? renderJournal(work, style) : renderConference(work, style);
}

export const STYLES: Style[] = ["apa", "ieee", "vancouver", "harvard", "mla", "chicago"];

export async function fetchOpenAlexWorks(): Promise<Work[]> {
  const works: Work[] = [];
  let page = 1;
  while (works.length < TARGET_TOTAL && page <= OPENALEX_MAX_PAGES) {
    const url = new URL("https://api.openalex.org/works");
    url.searchParams.set("filter", "has_doi:true,type:article");
    url.searchParams.set("per_page", String(OPENALEX_PER_PAGE));
    url.searchParams.set("page", String(page));
    url.searchParams.set(
      "select",
      "id,title,publication_year,authorships,biblio,primary_location,type"
    );
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`OpenAlex failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { results: OpenAlexWork[] };
    const results = data.results || [];
    let baseIndex = works.length;
    for (let i = 0; i < results.length; i++) {
      const w = workFromOpenAlex(results[i], baseIndex + i);
      if (w) works.push(w);
    }
    if (results.length < OPENALEX_PER_PAGE) break;
    page++;
  }
  return works.slice(0, TARGET_TOTAL);
}

/** Build 1000 cases from OpenAlex journal works only; round-robin styles (APA, IEEE, Vancouver, Harvard, MLA, Chicago). */
function buildCases(openalexWorks: Work[]): FinaleCase[] {
  const cases: FinaleCase[] = [];
  const useCount = Math.min(TARGET_TOTAL, openalexWorks.length);
  for (let i = 0; i < useCount; i++) {
    const work = openalexWorks[i];
    const style = STYLES[i % STYLES.length];
    const raw = renderCitation(work, style);
    cases.push({
      id: `oa-${i}`,
      raw,
      source: "openalex",
      style,
      expected: {
        year: work.year,
        titleToken: (work.title || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        firstAuthorFamily: work.authors[0]?.family || "",
        venueToken: work.venueToken,
        referenceType: work.type,
      },
    });
  }
  return cases;
}

type ApiReference = {
  id: string;
  originalText: string;
  convertedText: string;
  referenceType: string;
  parsedData: Record<string, any>;
  inputStyle: string;
  outputStyle: string;
  warnings?: string[];
  styleDetectionFailed?: boolean;
};

function normalize(value: string | undefined): string {
  return (value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function runBatches(cases: FinaleCase[]): Promise<ApiReference[]> {
  const all: ApiReference[] = [];
  for (let offset = 0; offset < cases.length; offset += BATCH_SIZE) {
    const chunk = cases.slice(offset, offset + BATCH_SIZE);
    const body = {
      references: chunk.map(c => c.raw),
      inputStyle: "auto",
      outputStyle: "apa",
      isPro: false,
      enrichWithAuthority: false,
    };
    const res = await fetch(`${API_BASE}/api/convert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`API batch failed: ${res.status} ${res.statusText}`);
    }
    const payload = (await res.json()) as { convertedReferences: ApiReference[] };
    const refs = payload.convertedReferences || [];
    all.push(...refs);
  }
  return all;
}

function evaluate(cases: FinaleCase[], converted: ApiReference[]) {
  const failures: Array<{
    id: string;
    source: string;
    categories: string[];
    expected?: FinaleCase["expected"];
    actual: Record<string, unknown>;
  }> = [];
  const byCategory: Record<string, number> = {};
  const bySource: Record<string, { total: number; failed: number }> = { openalex: { total: 0, failed: 0 }, curated: { total: 0, failed: 0 } };
  const byStyle: Record<string, { total: number; failed: number }> = {};

  cases.forEach((tc, index) => {
    const ref = converted[index];
    bySource[tc.source].total++;
    if (tc.style) {
      byStyle[tc.style] = byStyle[tc.style] || { total: 0, failed: 0 };
      byStyle[tc.style].total++;
    }

    const categories: string[] = [];
    if (!ref) {
      categories.push("missing-response");
    } else {
      const parsed = ref.parsedData || {};
      const actualVenue =
        parsed.conferenceTitle || parsed.journal || parsed.bookTitle || "";
      const actualFirst = parsed.authors?.[0] || "";

      if (ref.styleDetectionFailed) categories.push("style-detection");
      if ((ref.referenceType || "").toLowerCase() === "other")
        categories.push("reference-type");
      if (/Unknown Title|Unknown Author/.test(ref.convertedText || ""))
        categories.push("placeholder-output");

      if (tc.expected) {
        if ((parsed.year || "").trim() !== tc.expected.year)
          categories.push("year");
        const normExpectedTitle = normalize((tc.expected.titleToken || "").replace(/<[^>]+>/g, ""));
        const normParsedTitle = normalize(parsed.title);
        if (!normParsedTitle.includes(normExpectedTitle) && !normExpectedTitle.includes(normParsedTitle))
          categories.push("title");
        if (
          !normalize(actualFirst).includes(normalize(tc.expected.firstAuthorFamily))
        )
          categories.push("author");
      if (tc.expected.venueToken && tc.expected.venueToken !== "Unknown") {
        const fixVenueTypos = (s: string) =>
          s.replace(/\besses\b/g, "processes").replace(/\bessing\b/g, "processing");
        const normActual = normalize(actualVenue || ref.convertedText || "");
        const normExpected = normalize(fixVenueTypos(tc.expected.venueToken));
        const venueMatch =
          normActual.includes(normExpected) || normExpected.includes(normActual);
        if (!venueMatch) categories.push("venue");
      }
        if (
          (ref.referenceType || "").toLowerCase() !== tc.expected.referenceType
        )
          categories.push("reference-type");
      }
    }

    if (categories.length > 0) {
      failures.push({
        id: tc.id,
        source: tc.source,
        categories,
        expected: tc.expected,
        actual: ref
          ? {
              inputStyle: ref.inputStyle,
              referenceType: ref.referenceType,
              year: ref.parsedData?.year,
              title: ref.parsedData?.title,
              firstAuthor: ref.parsedData?.authors?.[0],
              venue:
                ref.parsedData?.conferenceTitle ||
                ref.parsedData?.journal ||
                ref.parsedData?.bookTitle,
              output: ref.convertedText?.slice(0, 200),
            }
          : {},
      });
      bySource[tc.source].failed++;
      if (tc.style) byStyle[tc.style].failed++;
      for (const c of categories) byCategory[c] = (byCategory[c] || 0) + 1;
    }
  });

  return { failures, byCategory, bySource, byStyle };
}

/** Returns the same case list as the full stress test (for mini harness). */
export async function getCasesForDebug(): Promise<FinaleCase[]> {
  const openalexWorks = await fetchOpenAlexWorks();
  return buildCases(openalexWorks);
}

async function run() {
  console.log("Fetching real works from OpenAlex...");
  const openalexWorks = await fetchOpenAlexWorks();
  console.log(`Fetched ${openalexWorks.length} works from OpenAlex.`);

  const cases = buildCases(openalexWorks);
  console.log(`Total test cases: ${cases.length}`);

  console.log("Sending to converter (batches of %d)...", BATCH_SIZE);
  const converted = await runBatches(cases);
  console.log(`Received ${converted.length} converted references.`);

  const { failures, byCategory, bySource, byStyle } = evaluate(cases, converted);

  const failureExamples: Record<string, typeof failures> = {};
  failures.slice(0, 100).forEach(f => {
    f.categories.forEach(c => {
      if (!failureExamples[c]) failureExamples[c] = [];
      if (failureExamples[c].length < 5) failureExamples[c].push(f);
    });
  });

  const report = {
    generatedAt: new Date().toISOString(),
    totalCases: cases.length,
    totalFailures: failures.length,
    passRate: Number(
      (((cases.length - failures.length) / cases.length) * 100).toFixed(2)
    ),
    byCategory,
    bySource,
    byStyle,
    failureExamples,
    sampleFailures: failures.slice(0, 20),
  };

  const outPath = path.resolve(process.cwd(), "stress-finale-1000-report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  // Wire stress-debug.json from API response for DEBUG_IDS (tc.raw, converted[index].parsedData, inputStyle, convertedText)
  const debugIdsSet = new Set(DEBUG_IDS);
  const debugEntries: Array<{
    id: string;
    rawInput: string;
    detectedStyle: string;
    parsedIntermediate: Record<string, unknown>;
    finalOutput: { year?: string; title?: string; venue?: string; firstAuthor?: string; referenceType?: string; output: string };
  }> = [];
  cases.forEach((tc, index) => {
    if (!debugIdsSet.has(tc.id)) return;
    const ref = converted[index];
    if (!ref) {
      debugEntries.push({
        id: tc.id,
        rawInput: tc.raw,
        detectedStyle: "",
        parsedIntermediate: {},
        finalOutput: { output: "" },
      });
      return;
    }
    const parsed = (ref.parsedData || {}) as Record<string, unknown>;
    debugEntries.push({
      id: tc.id,
      rawInput: tc.raw,
      detectedStyle: ref.inputStyle || "",
      parsedIntermediate: parsed,
      finalOutput: {
        year: parsed.year as string | undefined,
        title: parsed.title as string | undefined,
        venue: (parsed.conferenceTitle || parsed.journal || parsed.bookTitle) as string | undefined,
        firstAuthor: (Array.isArray(parsed.authors) ? parsed.authors[0] : undefined) as string | undefined,
        referenceType: ref.referenceType,
        output: ref.convertedText || "",
      },
    });
  });
  if (debugEntries.length > 0) {
    const debugPath = path.resolve(process.cwd(), "stress-debug.json");
    fs.writeFileSync(debugPath, JSON.stringify(debugEntries, null, 2), "utf8");
    console.log(`Wrote ${debugEntries.length} DEBUG_IDS entries to ${debugPath}`);
  }

  console.log("\n--- Finale 1000 report ---");
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nReport written to ${outPath}`);
}

const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && (process.argv[1] === __filename || process.argv[1].endsWith("stressFinale1000.ts"));
if (isMain) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
