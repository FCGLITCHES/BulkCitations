# Engine Folder Overview

The `server/engine/` folder holds the **citation conversion pipeline**: parsing free-text references, converting to CSL-JSON, and formatting output. The app uses this engine for all convert/reformat requests.

---

## Files and Roles

| File | Purpose |
|------|--------|
| **citationParser.ts** | **Input parsing.** Detects style (APA, IEEE, Vancouver, etc.), parses raw text into structured fields (authors, title, year, journal, volume, issue, pages, publisher, etc.), applies dynamic patterns from `server/data/patterns.json`, and determines reference type (journal, book, conference, thesis, report, etc.). |
| **cslConverter.ts** | **Output formatting.** Maps our `ParsedReference` → CSL-JSON, then uses citation-js (citeproc) to render APA, MLA, Harvard, Chicago, IEEE, Vancouver. Loads custom CSL styles from `server/csl-styles/`. |
| **strictRenderer.ts** | **Post-processing and checks.** `fixFormatting()` applies style-specific cleanup (abbreviation expansion, duplicate year removal, et al. formatting). `runAssertions()` runs style rules and produces warnings/highlights. Defines fallback format when CSL fails. |
| **citationConverter.ts** | **Legacy/alternative converter.** Hand-built formatters (e.g. `convertToAPA`, `convertToMLA`) that don’t use CSL. Not used by the main `/api/convert` flow (which uses cslConverter + strictRenderer). |
| **doiEnrichment.ts** | **Crossref lookup.** Fetches metadata by DOI and merges with parsed data. Currently not wired into the main convert path (DOI handling was scaled back). |
| **storageService.ts** | **Persistence helpers.** Stores/retrieves citation records (e.g. for history). Used by routes that need DB access. |
| **strictRenderer.test.ts** | **Tests** for `strictRenderer` (assertions, fixFormatting behavior). |

---

## Why Some Regex Lives in Code vs `patterns.json`

- **In code (citationParser.ts):**  
  The main parsing logic (style detection, splitting on quotes/commas, IEEE “Author, Title, Journal, Year;Vol(Issue):Pages”, Vancouver “Year;Vol(Issue):Pages”, APA “Author (Year). Title.”, chapter “In Book Title (pp. X–Y).”, report/thesis “Report submitted at …”, etc.) is **structural**. It decides *how* to interpret the string (where author ends and title starts, whether the last segment is journal or title). That depends on control flow, order of operations, and fallbacks (e.g. generic vs IEEE). Putting that into a single JSON pattern list would be hard to maintain and easy to break, so it stays in TypeScript.

- **In `patterns.json`:**  
  **Fill-in-the-blank** rules: “when you see *this* substring/regex, set field X (and optionally Y) **if** that field is still missing.” Used for variants that don’t change structure, e.g. “Volume-7, Issue-6” → volume/issue, “3(5), 3792-7” → volume, issue, pages. The parser already has a generic flow; these patterns add coverage for alternate phrasings without touching the main code. They’re loaded at startup and can be **updated from user reports or manual edits** by editing `server/data/patterns.json` (and restarting or relying on the file watcher). New rules can be added as new entries in the JSON array; the schema is: `regex`, `fields` (map of field name → capture group index), optional `priority`, `styles`, `category`, `description`.

So: **structure and control flow stay in code**; **extra field-extraction variants** that you want to tune or extend over time live in **patterns.json** so you can add/change rules without editing the parser.

---

## Data Flow (Convert Pipeline)

1. **Client** sends `{ references: string[], inputStyle, outputStyle }`. References are split client-side (e.g. by blank lines or numbered lines).
2. **routes.ts** normalizes each string with `citationParser.preNormalize()`, detects style (or uses `inputStyle`), then `citationParser.parseReference(normalized, style)`.
3. **citationParser** runs the style-specific parser (e.g. IEEE, Vancouver, APA), then shared steps: chapter extraction, dynamic patterns from `patterns.json`, `normalizeParsedReference`, year recovery.
4. **referenceType** = `citationParser.determineReferenceType(parsedData)`.
5. **cslConverter**: `parsedReferenceToCSL(parsedData, referenceType)` → CSL-JSON; `formatCSLData(cslData, outputStyle)` → raw string.
6. **strictRenderer**: `fixFormatting(outputStyle, rawConvertedText, parsedData)` → final string.
7. Assertions and confidence scoring run on that result; response is built in routes.

---

## Adding or Changing Extraction Rules

- **New wording for volume/issue/pages (or similar):** Add an entry to `server/data/patterns.json` with a `regex` and `fields` mapping. Keep the same schema as existing entries; optional `priority` (lower = run earlier) and `styles` to restrict by detected style.
- **New structure (e.g. a new citation shape):** That typically requires changes in `server/engine/citationParser.ts` (e.g. a new branch in `parseIEEECommaSeparated`, or a new pattern in the shared chapter/report logic). Optionally, you can add a minimal hook in code that only “suggests” a field and let a **pattern** in `patterns.json` do the actual capture so that part stays data-driven.
