// Builds an offline provider-record fixture from the real-input gold corpus, so
// Phase 8 enrichment can be verified end-to-end with ZERO live API calls. The gold
// was itself derived from Crossref/OpenLibrary, so each row's expected_fields IS
// the canonical record a provider would return for that DOI. Output is keyed by
// normalized DOI and consumed by test/helpers/fixtureProviders.ts.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const GOLD = "../datasets/engine-v2/gold/real-input/real-input-gold-v1.jsonl";
const OUT = "test/fixtures/provider-records.gold-v1.json";

function normalizeDoi(value: string): string {
  return value
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim()
    .toLowerCase();
}

function parseAuthor(s: string): { family: string; given?: string | null } {
  const comma = s.indexOf(",");
  if (comma >= 0) return { family: s.slice(0, comma).trim(), given: s.slice(comma + 1).trim() || null };
  const parts = s.trim().split(/\s+/);
  if (parts.length === 1) return { family: parts[0] ?? "", given: null };
  return { family: parts[parts.length - 1] ?? "", given: parts.slice(0, -1).join(" ") };
}

const rows = readFileSync(GOLD, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const byDoi: Record<string, unknown> = {};
let kept = 0;
for (const row of rows) {
  const ef = row.expected_fields ?? {};
  const doi = typeof ef.doi === "string" && ef.doi ? normalizeDoi(ef.doi) : null;
  if (!doi || byDoi[doi]) continue;
  const authors = Array.isArray(ef.authors) ? ef.authors.map((a: string) => parseAuthor(String(a))) : undefined;
  const fields: Record<string, unknown> = {};
  for (const k of ["doi", "title", "year", "journal", "volume", "issue", "pages", "url", "issn", "publisher"]) {
    if (ef[k] != null && ef[k] !== "") fields[k] = ef[k];
  }
  if (authors) fields.authors = authors;
  byDoi[doi] = {
    confidence: 0.95, // DOI-keyed canonical record clears the >=0.9 apply gate
    referenceType: row.reference_type ?? null,
    fields,
    ...(authors ? { authors } : {}),
  };
  kept += 1;
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(byDoi, null, 2));
console.log(`Wrote ${kept} DOI-keyed provider records (of ${rows.length} gold rows) -> ${OUT}`);
