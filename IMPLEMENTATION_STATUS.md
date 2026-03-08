# Implementation Status & Where to Refine

## Live reload (site updates when code changes)

- **Dev:** Run `npm run dev`; Vite HMR updates the client on save. The server may need a restart for backend changes unless you use something like `nodemon` for the server.
- **Backend-only change:** Restart the dev server (`npm run dev`) so the new code is loaded.

---

## What’s not fully implemented

| Area | Status | Where to change |
|------|--------|------------------|
| **Hot reload server** | Server does not auto-restart on file change | Use `nodemon` or `tsx watch` for `server/index.ts` if you want server HMR |
| **Style detection fallback** | When detection fails we now produce an APA stub + warning instead of skipping | `server/routes.ts`: `styleDetectionFailed` + fallback `detectedStyle = 'apa'` |
| **“In: … Editor” → book chapter** | Heuristic sets `editor`/`bookTitle` and `determineReferenceType` returns `bookChapter` | `server/services/citationParser.ts`: “Chapter-like” block + `determineReferenceType()` |
| **Leading number in authors** | Sanitize “Smith, 2. J. A.” → “Smith, J. A.” in parsed authors | `server/services/citationParser.ts`: `normalizeParsedReference()` author cleanup |
| **E-locator / article-number** | Article number stored; “pages missing” badge suppressed when present | `shared`/parser: `article-number`; `client/.../reference-output.tsx`: badge condition |
| **Vol/No in journal string** | Residual “Vol. 60, No. 12:…” stripped from journal/publisher/bookTitle | `server/services/citationParser.ts`: `normalizeParsedReference()` strip block |
| **Duplicate year in output** | Trailing “(YYYY).” removed from journal/pages/publisher/bookTitle | Same `normalizeParsedReference()` year-dedup loop |
| **Pro / Free gating** | `isPro` defaults to `true` for dev; not wired to real auth | `client/.../citation-converter.tsx`: `useState(true)`; later wire to auth |
| **Recheck** | Works for a single reference by `referenceId` | `POST /api/recheck` in `server/routes.ts`; `ScholarPreview` + `handleRecheck` in client |
| **Pattern hits** | Returned in API and stored; no dedicated UI “Details” yet | `patternHits` on `ConvertedReference`; optional “Details” in `reference-output.tsx` |
| **workKey** | Computed and stored; not yet used for “duplicate of winner” merge | `server/utils/workKey.ts`; `clusterCitations` in `shared/clustering.ts` still similarity-based |

---

## Do “pattern failed” / detection-failed citations cluster?

- **Yes, in the same way as others.** There is no separate “failed” list.
- **Flow:**
  1. If style detection fails we **no longer skip**; we set `detectedStyle = 'apa'`, set `styleDetectionFailed = true`, and parse with the fallback. The reference is converted and pushed into `convertedReferences` with an **error-level warning**: “Style could not be detected; output is a best-guess stub.”
  2. **Clustering** runs once on the full `convertedReferences` array: `clusterCitations(convertedReferences, 80)` in `server/routes.ts`. So detection-failed (and any other) entries are included and can end up in a cluster or as standalone.
  3. **Where to see them:** In the UI, every converted reference (including stubs) appears in `ReferenceOutput`. Clusters are shown as “best” + collapsible “Highly Similar Deduplicated Citations”. Errors/warnings (e.g. detection failed) are in the per-reference `warnings` and in the top-level `errors` array in the convert response (e.g. “Could not detect citation style for reference 1 — converted as best-guess stub”).

So: **pattern-/detection-failed citations are not in a separate bucket; they’re in the same `convertedReferences` and `clusters`**, with warnings so you can refine backend and custom logic.

---

## Where to refine backend and custom behavior

| Goal | File(s) |
|------|--------|
| **Detection rules / scoring** | `server/services/citationParser.ts` → `detectStyle()` |
| **Parse rules (APA, IEEE, Vancouver, etc.)** | `server/services/citationParser.ts` → `parseAPA`, `parseIEEE`, … |
| **Dynamic patterns (Vol/No, pages, publisher, …)** | `server/data/patterns.json` + `citationParser.ts` → `applyDynamicPatterns()` |
| **Reference type (journal vs book chapter vs …)** | `server/services/citationParser.ts` → `determineReferenceType()` + “In: … Editor” block |
| **Post-parse normalization (authors, Vol/No, year, article-number)** | `server/services/citationParser.ts` → `normalizeParsedReference()` |
| **Convert pipeline (preNormalize, soft-fail, warnings)** | `server/routes.ts` → `POST /api/convert` loop |
| **Clustering similarity** | `shared/clustering.ts` → `clusterCitations()`, `calculateCitationSimilarity()` |
| **Confidence / authority** | `shared/confidence.ts`, `shared/authorityLookup.ts` |
| **Style-specific formatting and assertions** | `server/services/strictRenderer.ts` |
| **“Pages missing” / “publisher missing” badges** | `client/src/components/reference-output.tsx` (CitationRow) |
| **Pro vs Free UI** | `client/.../citation-converter.tsx` (isPro), `ScholarPreview.tsx`, `reference-output.tsx` |

---

## Quick regression checks (after fixes)

1. **Leading number not in authors:** Paste numbered lines (e.g. “2. Smith, J. A. (2020). Title. Journal. 3. Jones, B. (2021). …”) and confirm no “2.” or “3.” in author fields.
2. **E-locator not “pages missing”:** Paste something like “Phys Rev Lett. 128(4):040501” and confirm no red “Incomplete: pages missing” when 040501 is present.
3. **Chapter type and badges:** Paste “Wilson. Title. In: Thompson R, Editor. Book Title. Publisher.” and confirm type is “Book chapter” and that chapter-appropriate warnings (e.g. pages/publisher) show as intended.
4. **Vol/No and year:** Paste Vancouver-style “Walker … 2021;60(12):1456-78. (2021).” and confirm output has no literal “Vol. 60, No. 12” and no duplicated “(2021).”.
5. **Detection soft-fail:** Paste an incomplete or ambiguous reference and confirm you get a converted stub plus a clear warning (no hard “reference N failed” only).
