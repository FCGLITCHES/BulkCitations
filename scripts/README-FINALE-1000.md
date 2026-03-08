# Finale 1000 citation stress test

This test runs **1000 genuine citations** through the converter to measure robustness.

## Sources

- **~900 citations**: Real papers from [OpenAlex](https://openalex.org/) (has_doi filter). Each work is formatted in one of six styles (APA, IEEE, Vancouver, Harvard, MLA, Chicago) in rotation.
- **~100 citations**: Curated real pasted strings from `scripts/data/real_citations_curated.json` (Google Scholar–style and real published examples).

All citations use real metadata (real titles, authors, venues, years); only the formatted string may be generated from that metadata for the OpenAlex portion.

## How to run

1. Start the server: `npm run dev`
2. In another terminal: `npm run stress:finale`

Or: `npx tsx scripts/stressFinale1000.ts`

The script will:

1. Fetch up to 1000 works from the OpenAlex API (5 × 200 per page).
2. Build 900 cases from those works (one citation string per work, style rotated).
3. Append 100 cases from the curated list (repeating if needed).
4. Send all 1000 to `POST /api/convert` in batches of 200.
5. Evaluate detection, parsing, and output (year, title, author, venue, reference type, placeholders).
6. Write `stress-finale-1000-report.json` in the project root.

## Report contents

- **totalCases** / **totalFailures** / **passRate**
- **byCategory**: failure counts (style-detection, reference-type, year, title, author, venue, placeholder-output).
- **bySource**: openalex vs curated pass/fail.
- **byStyle**: pass/fail per input style (APA, IEEE, Vancouver, Harvard, MLA, Chicago).
- **failureExamples**: sample failures per category.
- **sampleFailures**: first 20 full failure objects.

## Notes

- Venue is not counted as a failure when the OpenAlex record had no source (venueToken `"Unknown"`).
- The converter must be running at `http://127.0.0.1:5000` (or set `API_BASE` in the script).
