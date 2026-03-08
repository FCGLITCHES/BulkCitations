# Stress Finale 1000 — Fix Plan (patterns.json–First)

**Current state:** 96.7% pass rate, 33 failures. Target: 98%+.

**Principle:** Rare, format-specific recoveries go in `patterns.json`. Core parser only gets broad heuristics that improve many citations.

---

## Architectural Vision — Staged Field Inference

The current parser treats citations as one regex-shaped string and splits by position. That fails when:
- Article IDs (`n71`, `2402039`, `e1000097`) appear instead of page ranges
- Journal names contain commas (`Physical Review. B, Condensed matter`)
- Authors are corporate (`LHD Experiment Group`, `Water Environment Federation`)
- Issue data is fused (`7718`, `5416`, `1931`)

**Better approach:** Parse in passes with staged scoring, not a single rigid split.

### Pipeline: `detectCandidates → scoreCandidates → assembleBestParse → repairEdgeCases`

1. **Normalize** — punctuation and whitespace; preserve periods in initials and source names.
2. **Extract anchors first** — year, volume/issue, pages/article-number (high-confidence patterns).
3. **Classify article-number vs pages** — if a numeric tail is a single token after vol/issue and looks non-range-like, treat as `article-number` before `pages`. Covers BMJ `n71`, PLoS `e1000097`, Plasma and Fusion Research `2402039`.
4. **Split author block** — use first likely title boundary (quoted string, period before journal-like text).
5. **Resolve journal/container** — score remaining spans; do not hard-split on commas. `Physical review. B, Condensed matter` should win as journal even with internal punctuation.
6. **Repair fused fields** — e.g. `1931` → vol 193, issue 1 when structure supports it.

### Smart Detection Rules (per token span)

| Field | Signals |
|-------|---------|
| **Year** | 4-digit, 1900–current year |
| **Volume/issue** | `vol. 15`, `no. 0`, fused pairs `1931`, `7718`, `5416` |
| **Pages/article ID** | Ranges `265-275`; article IDs `n71`, `e1000097`, `2402039`, `R137` |
| **Journal** | Spans after title matching journal-style names, including commas/section labels |
| **Author** | Leading span before title; personal names, initials, `et al.`, **corporate names** |

### Corporate Authors (first-class)

Mark as corporate when segment contains: **Group**, **Association**, **Federation**, **Society**, **Committee**, **Institute**, or multiple capitalized org chunks. Prevents bad splits (e.g. "Group" as surname, federation examples fragmented).

### Hybrid Implementation

- **Rule-based anchors** — year, volume, issue, pages, article IDs.
- **Scored inference** — journal and corporate-author phrases (dictionary or ML).
- **Post-processing validators** — reject impossible outputs (see Validator Rule below).

### Validator Rule (post-assembly)

If a terminal token after volume/issue matches an article-locator shape (`^[A-Za-z]\d{2,}$` or long unhyphenated numeric ID like `2402039`), **bar it from becoming `pages`** unless a true page range is also present. Covers BMJ `n71`, PLoS Medicine `e1000097`, Plasma and Fusion Research `2402039`. Promote to `article-number` instead.

### Fused Numeric Repair (first-class stage)

**Do not scatter** fused-numeric logic across style-specific heuristics. `1931`, `7718`, `5416`, `1512`, `3277414` are the same structural phenomenon across different venues. `repairEdgeCases` should be a **reusable pass** that applies to all parsed output.

**Near-term:** Tactical fixes below move toward this architecture. Phases 1–4 are incremental; a full refactor to staged scoring is a later milestone.

---

## Phase 1 — Evaluator Fix (quick win)

**Highest ROI change.** Title corruption from tag stripping is visible in the data (`forab initioitotal-energy`, `ofiSHELXi`). Many "parser failures" are evaluator false negatives. Do this first.

**File:** `scripts/stressFinale1000.ts`

**Problem:** HTML stripping in `buildCases` uses `.replace(/<[^>]+>/g, "")` which jams words: `"for <i>ab initio</i> total-energy"` → `"forab initiototal-energy"`. Parser output is correct (`"for ab initio total-energy"`) but evaluator fails.

**Change:** Replace tags with a space so word boundaries are preserved:

```ts
// buildCases, line ~289
titleToken: (work.title || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
```

**Gate:** oa-9, oa-20, oa-95, oa-112, oa-356, oa-361, oa-413 title failures should drop (evaluator false positives).

---

## Phase 2 — patterns.json Additions (rare recoveries)

**File:** `server/data/patterns.json`

**Rule:** Each pattern only fills **missing** fields. Never overwrites. Use `styles` to limit scope when pattern is format-specific.

**Why no overwrites:** Several failures are caused by wrong structural assignment (text moved between title and venue), not absent data. Letting patterns overwrite would mask parser regressions. A wrong parse can move text between title and venue (e.g. Becke, U-Net examples) — recovery patterns must not "fix" that blindly.

### 2.1 Year from Chicago/MLA format

**IDs affected:** oa-359, oa-569, oa-635, oa-641 — year is `n.d.` when it appears in `vol. X, no. Y (Year):` or `, Year, pp.`

```json
{
  "id": "year_chicago_parens",
  "description": "Year in parens after vol: vol. X, no. Y (Year): — rare Chicago/MLA recovery",
  "category": "year",
  "priority": 3,
  "regex": "\\\\bvol\\\\\\.?\\\\s*\\\\d+[^)]*\\\\s*\\\\\\(((?:19|20)\\\\d{2})\\\\)",
  "fields": { "year": 1 },
  "styles": ["chicago", "mla"]
},
{
  "id": "year_mla_comma",
  "description": "Year comma-bounded: , Year, pp. — rare MLA recovery",
  "category": "year",
  "priority": 3,
  "regex": ",\\\\s*((?:19|20)\\\\d{2})\\\\s*,?\\\\s*pp\\\\\\.?",
  "fields": { "year": 1 },
  "styles": ["chicago", "mla"]
}
```

**Note:** `applyDynamicPatterns` receives `raw` (full citation). Parser must pass `rawInput` or original text. Verify patterns run on full raw string.

### 2.2 Article locator uppercase (R137, B2535)

**ID affected:** oa-472 — R137 is article number, not title. Existing `article_locator_letter` uses `[a-z]` only.

```json
{
  "id": "article_locator_uppercase",
  "description": "Uppercase letter-prefixed locator (R137, B2535) — Genome biology, BMJ",
  "category": "pages",
  "priority": 5,
  "regex": "\\\\b([A-Z]\\\\d{2,})\\\\b",
  "fields": { "article-number": 1 }
}
```

**Guard:** Only fills when `article-number` is missing. May match other tokens (e.g. "E100"); use priority 5 so it runs after more specific patterns. Consider adding negative lookbehind for common false positives if needed.

### 2.3 GLOBOCAN year preference (optional, advanced)

**ID affected:** oa-226 — year 2012 (from "GLOBOCAN 2012") preferred over 2014.

**Limitation:** Patterns cannot overwrite existing year. This requires core parser year-ranking logic. **Do not add to patterns.json.** Document as core parser change in Phase 3.

---

## Phase 3 — Core Parser Changes (minimal)

Only changes that cannot be expressed as patterns.

**Priority order:** The three highest-impact parser fixes cut across several failures each. Do them first: (1) title-embedded year guard, (2) locator-vs-pages classification, (3) corporate-author handling. Then quoted-title boundary (narrower). IEEE PAMI is a late-stage scorer adjustment — do last.

### 3.1 [P0] Harvard BMJ/PRISMA — title-embedded year guard

**IDs affected:** oa-23, oa-557, oa-929 — title becomes "20", authors mangled.

**Root cause:** Harvard parser captures "2020" in "PRISMA 2020 statement" or "ROBINS-I" as year; remainder becomes wrong.

**File:** `server/services/citationParser.ts` — `parseHarvard`

**Change:** When year candidate is 2-digit "20" or 4-digit "2020" and appears immediately after a known title phrase ("PRISMA", "ROBINS-I", "pROC"), treat as title-embedded, not year. Options:
- Add to year ranking: penalize year when it appears in `\b(PRISMA|ROBINS-I|pROC)\s+\d{4}\b` context.
- Or: in `extractYearCandidates`, mark such matches as `title-embedded` with score 0.

**Gate:** oa-23, oa-557, oa-929 produce correct title and year.

### 3.2 [P0] Article-locator classification before page assignment

**IDs affected:** oa-472 (R137), plus BMJ `n71`, PLoS `e1000097`, Plasma and Fusion Research `2402039`.

**Change:** If a terminal token after volume/issue matches article-locator shape (`^[A-Za-z]\d{2,}$` or long unhyphenated numeric ID like `2402039`), classify as `article-number` **before** assigning to `pages`. Run in `extractLocator` or `normalizeParsedReference`.

**Gate:** n71, b2535, e1000097, 2402039, R137 end up in `article-number`, not `pages` or `title`.

### 3.3 [P0] Corporate-author handling

**ID affected:** oa-277. Covers Water Environment Federation, LHD Experiment Group, PRISMA Group.

**File:** `citationParser.ts` — author splitting

**Change:** When a segment contains **Group**, **Association**, **Federation**, **Society**, **Committee**, **Institute**, or matches `Expert Panel on .+`, treat as single organizational author — do not split on internal commas.

**Gate:** oa-277 first author includes "Expert Panel" or "Detection".

### 3.4 [P1] Harvard author/title boundary (quoted title)

**ID affected:** oa-229 — `"John Canny, \"A Computational Approach to Edge Detection\""` parsed as first author. Important but narrower.

**File:** `citationParser.ts` — Harvard author extraction

**Change:** Detect `Author, "Title"` pattern and split before the quote. Quoted substring is title, not author.

**Gate:** oa-229 first author is "Canny" not "John Canny, \"A Computational Approach...\"".

### 3.5 GLOBOCAN year ranking

**ID affected:** oa-226 — year 2012 vs 2014.

**File:** `citationParser.ts` — `extractYearCandidates` / `resolveYearFromCandidates`

**Change:** Ensure year in `GLOBOCAN 2012` context is scored as `title-embedded` (low). Prefer year from bibliography position.

**Gate:** oa-226 year is 2014.

### 3.6 Fused numeric repair (first-class stage)

**IDs affected:** `1931`, `7718`, `5416`, `1512`, `3277414` — same structural phenomenon across venues.

**Change:** Make fused-numeric split a **reusable pass**, not scattered style-specific conditionals. When volume/issue looks fused (6–7 digits, or 4-digit ambiguous), apply `splitMergedVolumeIssue` consistently. `repairEdgeCases` as first-class stage.

**Gate:** Fused tokens split or flagged; no style-specific heuristics.

### 3.7 Validator: bar article-locator from pages

**Change:** After assembly, if `pages` holds a token matching `^[A-Za-z]\d{2,}$` or `^\d{5,7}$` (long unhyphenated), move to `article-number` and clear `pages`. Covers BMJ, PLoS Medicine, Plasma and Fusion Research.

### 3.8 [P2] Reference-type: IEEE PAMI as journal

**ID affected:** oa-543 — "book" instead of "journal". Late-stage scorer, not foundational.

**File:** `citationParser.ts` — `determineReferenceType`

**Change:** When venue contains "IEEE Transactions" and has volume/issue/pages → journal, not book.

**Gate:** oa-543 reference-type is journal.

---

## Phase 4 — strictRenderer (acronym preservation)

**IDs affected:** oa-66 (DFT-D → D. F. T.-D), oa-472 (ChIP-Seq → Ch I. P.-Seq), oa-448 (ORTEP-III → ORTEP -I. I. I.).

**File:** `server/services/strictRenderer.ts`

**Change:** Extend acronym preservation:
- Hyphenated: `DFT-D`, `ChIP-Seq` (preserve, do not expand to initials).
- Roman numerals in acronyms: `ORTEP-III` → `ORTEP-III` not `ORTEP -I. I. I.`.

**Gate:** oa-66, oa-472, oa-448 titles preserve acronyms.

---

## Implementation Order

**Recommended sequence** (matches strongest recurring corpus patterns; moves toward staged scorer without full refactor):

| Step | Change | Est. impact |
|------|--------|-------------|
| 1 | Evaluator HTML strip with space | ~8–12 title false positives removed (highest ROI) |
| 2 | patterns.json: year_chicago_parens, year_mla_comma | 4 year failures (oa-359, 569, 635, 641) |
| 3 | patterns.json: article_locator_uppercase | R137, B2535 → article-number |
| 4 | Core [P0]: Title-embedded year guard | 3 (oa-23, 557, 929) |
| 5 | Core [P0]: Locator-vs-pages classification | n71, e1000097, 2402039, R137 |
| 6 | Core [P0]: Corporate-author detection | 1 (oa-277) + federation/group cases |
| 7 | Core [P1]: Harvard author/title boundary | 1 (oa-229) |
| 8 | Core: GLOBOCAN year ranking | 1 (oa-226) |
| 9 | Core: Fused numeric repair (first-class) | 1931, 7718, 5416, etc. |
| 10 | Core: Validator — bar locator from pages | Post-assembly cleanup |
| 11 | Core [P2]: IEEE PAMI as journal | 1 (oa-543) |
| 12 | strictRenderer: acronym preservation | 3 (oa-66, 472, 448) |

**Target:** 33 → ~5–8 failures, pass rate 99%+.

**Expected outcome:** If Phase 1 lands and parser changes stay limited to ambiguity reducers (not output rewrites), the plan should push remaining failures into a much smaller long tail. Earlier reports showed heavy concentration in year, title, and reference-type — evaluator fix + locator/year/corporate-author ambiguity fixes address those directly.

### Alignment with Architectural Vision

| Tactical fix | Maps to pipeline stage |
|--------------|------------------------|
| Evaluator HTML strip | (evaluator, not parser) |
| patterns.json year_chicago_parens, year_mla_comma | **Extract anchors** — year from vol/issue context |
| patterns.json article_locator_uppercase | **Classify article-number vs pages** — R137, B2535 |
| Title-embedded year guard | **Extract anchors** — avoid title-embedded year |
| Locator-vs-pages classification | **Classify article-number vs pages** — before page assignment |
| Corporate author | **Corporate authors** — first-class org names |
| Harvard author/title boundary | **Split author block** — quoted title not author |
| GLOBOCAN year ranking | **Extract anchors** — prefer bibliography-position year |
| Fused numeric repair | **repairEdgeCases** — first-class stage |
| Validator (bar locator from pages) | **Post-processing validators** |
| IEEE PAMI as journal | **assembleBestParse** — type scoring |
| strictRenderer acronyms | Post-render repair |

---

## patterns.json Schema Reference

```json
{
  "id": "string",
  "description": "optional",
  "category": "volume|pages|year|doi|publisher",
  "priority": 1–50,
  "regex": "double-escaped: \\\\d for \\d",
  "fields": { "fieldName": 1 },
  "styles": ["chicago", "mla"]
}
```

- **priority:** Lower = runs first. Use 3–5 for recovery patterns.
- **fields:** Map regex group index (1-based) to ParsedReference field. Group 0 = full match.
- **styles:** If present, pattern only runs when input style matches. Omit for all styles.
- **Guard:** `applyDynamicPatterns` only fills when `(fields as any)[key]` is falsy.

---

## Test Gates

After each phase:

1. `npm run stress:finale` — pass rate and category counts.
2. Spot-check: oa-23, oa-226, oa-229, oa-277, oa-359, oa-472, oa-543 in report.

Final gate: pass rate ≥ 98%, reference-type failures < 5.

---

## Future Roadmap — Full Staged Scoring (Phase 5+)

When tactical fixes are exhausted and pass rate is stable, consider a refactor to the full pipeline:

1. **`detectCandidates(raw)`** — Return `{ year?, volume?, issue?, pages?, articleNumber?, spans: Span[] }` where spans are unclassified text segments.
2. **`scoreCandidates(spans, anchors)`** — Assign each span scores for author, title, journal. Use dictionary for known journals; heuristics for corporate-author phrases.
3. **`assembleBestParse(candidates)`** — Pick highest-scoring assignment per span; resolve ties by position and style.
4. **`repairEdgeCases(parsed)`** — **First-class stage**, not scattered conditionals. Fused numeric split (`1931`, `7718`, `5416`), article-number promotion, validator pass (bar locator from pages).

This replaces style-specific regex chains with a single inference path. Patterns.json remains for rare, source-specific recoveries that don't fit the scorer.
