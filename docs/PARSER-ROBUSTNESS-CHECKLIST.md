# Parser Robustness — File-by-File Engineering Checklist

Defensive, recovery-oriented parsing: soft scoring over noisy evidence, year candidates, compact numeric splitting, locator preservation, and patterns.json separation.

---

## Separation Rule

**patterns.json** = rare or source-specific cleanup/recovery rules.  
**Core parser** = common, generalizable logic (year validation, title/remainder extraction, locator preservation, type scoring).

> Any low-frequency edge case that depends on a recognizable malformed string shape should be implemented in `patterns.json`; the core parser should only contain broad heuristics that improve many citations, not one-off corpus patches.

---

## 1. `shared/schema.ts`

| Change | Details |
|--------|---------|
| Add `parseWarnings?: string[]` to `ParsedReference` | Array of codes: `invalid-year-recovered`, `merged-volume-issue`, `title-remainder-ambiguous`, `venue-unknown`, `year-candidates-used`, etc. |
| Add `'preprint'` to `ReferenceType` | `'journal' \| 'book' \| 'bookChapter' \| 'conference' \| 'website' \| 'report' \| 'thesis' \| 'preprint' \| 'other'` |
| Add `yearCandidates?: string[]` to `ParsedReference` (optional) | For debugging when multiple plausible years exist |

---

## 2. `server/services/citationParser.ts`

### 2.1 Harvard Pattern 1 remainder fix (existing)

| Location | Change |
|----------|--------|
| ~line 1089 | `harvardWithParens[3]` → `harvardWithParens[4]` |

### 2.2 Year helpers (add near top of file, after imports)

| Helper | Signature | Purpose |
|--------|-----------|---------|
| `isValidYear` | `(candidate: string \| undefined): boolean` | Accept year only if in sane range (e.g. 1800–next year). Use `parseInt`, check bounds. |
| `extractYearCandidates` | `(rawInput: string): Array<{ year: string; index: number; context: 'author-boundary' \| 'title-boundary' \| 'venue-volume' \| 'unknown' }>` | Find all 4-digit candidates; classify context (near author/title vs inside venue/volume cluster). Prefer author-boundary, penalize venue-volume. |
| `resolveYearFromCandidates` | `(parsed: ParsedReference, rawInput: string, candidates: ReturnType<typeof extractYearCandidates>): string \| undefined` | If parsed.year valid, keep. Else pick best candidate by context rank. If none good, return undefined. Do not invent. |
| `recoverYear` | `(badYear: string \| undefined, rawInput: string): string \| undefined` | Wrapper: if valid keep; else call extractYearCandidates + resolveYearFromCandidates. Used for backward compatibility. |

### 2.3 Year normalization in `parseReference`

| Location | Change |
|----------|--------|
| After `normalizeParsedReference`, before `return` | Call year recovery: `if (normalizedParsed.year !== undefined) { const recovered = recoverYear(normalizedParsed.year, cleanText); if (recovered !== normalizedParsed.year) { normalizedParsed.year = recovered; (normalizedParsed as any).parseWarnings = [...((normalizedParsed as any).parseWarnings ?? []), 'invalid-year-recovered']; } }` |

### 2.4 Compact numeric splitter (core heuristic)

| Helper | Location | Purpose |
|--------|----------|---------|
| `splitMergedVolumeIssue` | New private method in `CitationParser` | Input: string like `5217553`, `3065696`, `1931`, `721-2`. Output: `{ volume?: string; issue?: string; remainder?: string }` or null. Heuristic: 6–7 digits → volume(3–4) + issue(2–3); 4 digits in venue context → possibly volume. Do not treat as year. Add `merged-volume-issue` to parseWarnings when applied. |
| Call site | Inside `normalizeParsedReference` or a new pre-pass | When `parsed.volume` looks like merged digits (e.g. `/\d{6,7}/.test(parsed.volume)`), call `splitMergedVolumeIssue` and overwrite volume/issue if result is plausible. |

### 2.5 Locator extractor (core heuristic)

| Helper | Location | Purpose |
|--------|----------|---------|
| `extractLocator` | New private method | Input: string. Recognize: (1) pages `\d+[-–]\d+`, `\d+`; (2) e-locators `e\d+`, `[A-Za-z]\d+` (e.g. `n71`, `b2535`, `e1000097`); (3) article numbers `154104`, `2402039` (5–7 digits). Return `{ pages?: string; 'article-number'?: string }`. Preserve letter-prefixed locators; never discard. |
| Call site | In `normalizeParsedReference` (article-number block) or in style-specific parsers | When `parsed.pages` contains `n71`, `b2535`, `e1000097`, etc., promote to `article-number` or keep in pages per CSL expectations. Ensure locator is never dropped. |

### 2.6 Replace `determineReferenceType` with scored resolution

| Location | Change |
|----------|--------|
| `determineReferenceType` (lines ~1766–1791) | Replace entire function with soft scorer. Use `parsed.editor` (singular, schema has no `editors`). Fix paste typo: `ranked[1]` for second-best, `ranked[1][1]` for secondScore. Return `'other'` only when `bestScore < 3` or `bestScore - secondScore < 2`. |

**Scored type logic (pseudocode):**

```ts
type TypeScore = Record<ReferenceType, number>;
const score: TypeScore = { journal: 0, conference: 0, book: 0, chapter: 0, thesis: 0, report: 0, website: 0, preprint: 0, other: 0 };
// Journal: journal +4, volume +2, issue +1, pages/startPage/articleNumber +2
// Conference: proceedings|conference|symposium|workshop|in proc +4; cvpr|iccv|eccv|neurips|icml|iclr|acl|emnlp|naacl|aaai|ijcai +3
// Chapter: bookTitle +4, editor +2
// Book: press|publisher|springer|elsevier|wiley|cambridge|oxford +3; no vol/issue/pages + publisher +2
// Thesis: thesis|dissertation|doctoral|phd|master +4
// Report: technical report|working paper|nber|oecd|world bank|who +4
// Preprint: arxiv|biorxiv|medrxiv|ssrn|preprint +4
// Website: url && !volume && !issue && !journal +3
const ranked = Object.entries(score).filter(([k]) => k !== 'other').sort((a, b) => b[1] - a[1]);
const [bestType, bestScore] = ranked[0];
const secondScore = ranked[1]?.[1] ?? 0;
if (bestScore < 3 || bestScore - secondScore < 2) return 'other';
return bestType as ReferenceType;
```

### 2.7 Pass `rawInput` into parsed for type scoring

| Location | Change |
|----------|--------|
| `parseReference` | Before calling `determineReferenceType` (in routes), set `(parsedData as any).rawInput = rawRef` so type scorer can use `parsed.rawInput` when matching venue + raw. Alternatively, pass `rawRef` as second arg to `determineReferenceType(parsed, rawRef)`. |

---

## 3. `server/data/patterns.json`

Add patterns for **rare, format-specific** recoveries. Core parser must not hard-code these.

| Pattern ID | Description | Regex / Fields | Purpose |
|------------|-------------|----------------|----------|
| `merged_vol_issue_6_7` | Split 6–7 digit merged volume+issue | Match `(\d{3,4})(\d{2,3})` in venue/volume context; `volume`: 1, `issue`: 2. Guard: only when no existing volume/issue. | `5217553` → vol 5217, issue 553 (or similar split). Low priority. |
| `merged_vol_issue_4` | Split 4-digit ambiguous (e.g. 1931) | Match in venue context; prefer volume over year when adjacent to journal name. | `1931` as volume when `Journal, 1931, 1-5` |
| `article_locator_n` | Letter-prefixed locator `n71`, `b2535` | `\b([a-zA-Z]\d+)\b` in pages/locator context; map to `article-number` or pages. | Preserve `n71`, `b2535` |
| `article_locator_e` | E-locator `e1000097` | `\b(e\d+)\b`; map to `article-number`. | Preserve `e1000097` |
| `venue_placeholder` | `Journal, ?` or `?` as venue | Optional: flag for `venue-unknown` warning; do not overwrite journal with `?`. | Debugging only |

**Rule:** Each pattern must have `priority` and `category`. Use high priority (e.g. 5) for recovery patterns so they run early. Guard: only fill **missing** fields.

**patterns.json schema** (existing): `{ id, description?, category?, priority, regex, fields: { fieldName: groupIndex }, styles? }`. Regex uses double-escaped backslashes in JSON.

---

## 4. `server/services/cslConverter.ts`

| Location | Change |
|----------|--------|
| `getCSLType` | Add `case 'preprint': return 'article';` (or `'article-journal'`) |

---

## 5. `server/routes.ts`

| Location | Change |
|----------|--------|
| After `parseReference`, before `determineReferenceType` | Set `(parsedData as any).rawInput = rawRef` so type scorer has raw text. |
| When building `convertedReferences` | Merge `parseWarnings` from `parsedData` into `warnings` array for UI: `warnings = [...(parsedData.parseWarnings ?? []).map(w => \`parse: \${w}\`), ...warnings]` |

---

## 6. `server/store/reportStore.ts` (optional)

| Change | Details |
|--------|---------|
| Add `parseWarnings` to report payload | If reports store parsed output, include `parseWarnings` for debugging. |

---

## 7. Test Gates

Add or extend tests to enforce:

| Gate | Assertion |
|------|-----------|
| Invalid year | No `7553`, `5696`, `6684` in final `parsed.year`. |
| Other + warning | Every `referenceType === 'other'` must have at least one `parseWarnings` entry explaining why. |
| Article locators | `n71`, `b2535`, `e1000097`, `2402039` preserved in `pages` or `article-number`. |
| Conference evidence | `Proceedings`, `IEEE Conference`, CVPR/NeurIPS/etc. must not silently fall to journal when conference score is strong. |
| Merged numeric | `5217553`, `3065696` either split to volume/issue or flagged as `merged-volume-issue`. |

---

## 8. Edge Cases to Cover (from corpus)

| Shape | Handling |
|-------|----------|
| Merged volume/issue | `5217553`, `3065696`, `3277414`, `3157109` → patterns.json or `splitMergedVolumeIssue` |
| Issue ranges | `721-2`, `651-2` → preserve; optional split in patterns.json |
| Article locators | `n71`, `b2535`, `e1000097`, `154104`, `2402039` → locator extractor; never discard |
| Venue placeholders | `Journal, ?` → flag `venue-unknown`; do not treat as valid journal |
| Conference phrasing | `In 2009 IEEE Conference...`, `Proceedings of...` → conference score +4 |
| Jammed tokens | `OliverH.`, `NiraJ.`, `LHDExperiment`, `Jakubv` → author split (existing); consider patterns.json if recurring |
| Title/venue boundary | `Nature`, `Science`, `BMJ` after title → ensure venue extraction doesn't eat title |

---

## 9. Implementation Order

1. **Schema** — `parseWarnings`, `preprint`, optional `yearCandidates`
2. **Harvard fix** — remainder group index
3. **Year helpers** — `isValidYear`, `extractYearCandidates`, `resolveYearFromCandidates`, `recoverYear`; wire into `parseReference`
4. **Scored type** — replace `determineReferenceType`; add `rawInput` pass-through
5. **CSL** — `preprint` case in `getCSLType`
6. **Locator extractor** — `extractLocator`; wire into `normalizeParsedReference`
7. **Compact numeric splitter** — `splitMergedVolumeIssue`; wire where volume looks merged
8. **patterns.json** — add merged-vol-issue, article-locator patterns (low priority, guarded)
9. **Routes** — `rawInput`, `parseWarnings` merge
10. **Test gates** — add assertions for invalid year, other+warning, locators, conference, merged numeric
