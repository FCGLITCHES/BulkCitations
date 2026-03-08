import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  type Work,
  type Style,
  STYLES,
  fetchOpenAlexWorks,
  renderCitation,
} from "./stressFinale1000";

/**
 * Generate a manual batch of ~1500 realistic citations for eyeballing.
 *
 * - Uses the same OpenAlex-backed Work builder as the finale-1000 script.
 * - For the first N works, renders multiple styles per work so you see
 *   APA / IEEE / Vancouver / Harvard / MLA / Chicago variants.
 *
 * Output:
 *   manual-1500-batch.txt  – one citation per line, numbered, with no internal IDs.
 *
 * Run with:
 *   npx tsx scripts/generateManual1500.ts
 */

const TARGET_CITATIONS = 1500;

function isGoodForManual(work: Work): boolean {
  // Skip placeholder/unknown authors
  if (!work.authors?.length || work.authors[0].family === "Unknown") return false;
  if (!work.title || /unknown/i.test(work.title)) return false;

  if (work.type === "journal") {
    // Require real journal name, volume, and pages to avoid "Journal, ?" / missing locators
    if (!work.journal || work.journal === "Journal") return false;
    if (!work.volume || !work.pages) return false;
  } else {
    // Conference: require a non-generic title and some locator
    if (!work.conferenceTitle || work.conferenceTitle === "Conference") return false;
    if (!work.pages) return false;
  }

  return true;
}

function buildManualBatch(works: Work[]): string[] {
  const out: string[] = [];

  // Filter out placeholder / low-signal works so the manual set is clean.
  const goodWorks = works.filter(isGoodForManual);

  // Use enough works so that works * styles ≈ TARGET_CITATIONS
  const stylesPerWork = STYLES.length; // 6
  const maxWorks = Math.min(goodWorks.length, Math.ceil(TARGET_CITATIONS / stylesPerWork));

  let counter = 1;
  for (let i = 0; i < maxWorks && counter <= TARGET_CITATIONS; i++) {
    const work = goodWorks[i];
    for (const style of STYLES) {
      if (counter > TARGET_CITATIONS) break;
      const raw = renderCitation(work, style as Style);
      // Simple human-readable numbering, no oa-XXX or style tag prefixes.
      out.push(`${counter}. ${raw}`);
      counter++;
    }
  }

  return out;
}

async function run() {
  console.log("Fetching works from OpenAlex for manual batch...");
  const works = await fetchOpenAlexWorks();
  console.log(`Fetched ${works.length} works.`);

  if (!works.length) {
    console.error("No works returned from OpenAlex – cannot build manual batch.");
    process.exit(1);
  }

  const lines = buildManualBatch(works);
  const outPath = path.resolve(process.cwd(), "manual-1500-batch.txt");
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`Wrote ${lines.length} citations to ${outPath}`);
}

// Guard so this doesn't auto-run if imported
const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && (process.argv[1] === __filename || process.argv[1].endsWith("generateManual1500.ts"));
if (isMain) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

