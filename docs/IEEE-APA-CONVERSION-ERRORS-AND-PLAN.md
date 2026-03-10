# IEEE-style list → APA conversion: errors and fix plan

You pasted 46 numbered references in a mixed IEEE / comma-separated style. Below is the **list of error categories** we infer from the parser/converter code and your samples, plus a **concrete fix plan**. Tell me which items to implement or change.

---

## 1. Style detection: many refs not treated as IEEE

**What happens:** Refs like `[1] Whitley D, A genetic algorithm tutorial, Statistics and computing, 1994 Jun 1;4(2):65-85.` are sent to the server **without** the `[1]` (client strips it). So the server sees:

`Whitley D, A genetic algorithm tutorial, Statistics and computing, 1994 Jun 1;4(2):65-85.`

- **IEEE** is boosted by `^\[\d+\]` in `detectStyle` — but that only matches the **raw** string before `preNormalize` strips numbering. So after normalization there is no `[1]`, and IEEE loses that signal.
- There is **no quoted title** (`"Title,"`), so the **IEEE parser** requires a quote and immediately falls back to **parseGeneric**.
- **Vancouver** looks for `Year;Vol(Issue):Pages` and period-before-year patterns; here the tail is `, 1994 Jun 1;4(2):65-85` (comma before year, not period), so Vancouver may not win.

**Result:** Many refs are classified as **APA** or **generic**, and the IEEE-specific parser never runs.

**Fix plan:**

- **A.** In `detectStyle`, add a path that treats **comma-separated “Author Initials, Title, Journal, Year;Vol(Issue):Pages”** as an IEEE-like / Vancouver-like hybrid (e.g. give IEEE or a new “comma-ieee” style a strong score when `, (19|20)\d{2} \w+ \d+;\d+\(\d+\)` appears and there’s no quoted title).
- **B.** Or: when **input style is “auto”** and the **client** has just stripped `[N]`, send a hint (e.g. `leadingBracketNumber: true`) so the server can bias toward IEEE.
- **C.** Or: add a dedicated **“comma-separated journal”** parser that doesn’t require a quoted title and that handles `Author, Title, Journal, Year;Vol(Issue):Pages` and similar, then map that to journal + type.

---

## 2. IEEE parser requires a quoted title

**What happens:** `parseIEEE` does:

```ts
const titleMatch = cleanText.match(/"([^"]+)"/);
if (!titleMatch) {
  return this.parseGeneric(cleanText);
}
```

So any ref **without** double-quoted title (e.g. `Whitley D, A genetic algorithm tutorial, ...`) is parsed by **parseGeneric**, which only does minimal extraction (year, optional quoted title, first token as author).

**Result:** No journal, no volume/issue/pages, wrong or single author, type often “other”.

**Fix plan:**

- **A.** Add an **alternative branch** in the IEEE parser (or a new “IEEE-comma” parser) for refs that **don’t** have a quoted title but **do** match:
  - `AuthorPart, TitlePart, JournalPart, Year [;,] Vol(Issue):Pages`
  - with AuthorPart like `Initial(s) Surname` or `Surname Initial(s)` (e.g. `Whitley D`, `Goldberg DE, Holland JH`).
- **B.** Use a **comma-count + tail regex** heuristic: e.g. split on commas, take last segment as `Year;Vol(Issue):Pages` or `Year.` and the preceding segments as journal, title, authors (with care for “Title, Subtitle” and multi-author).

---

## 3. Vancouver parser expects period-separated segments

**What happens:** `parseVancouver` assumes “Author. Title. Journal. Year;Vol(Issue):Pages” (period + space between segments). Your refs are **comma-separated**: “Author, Title, Journal, Year;Vol(Issue):Pages”.

**Result:** Even when Vancouver is detected, author/title/journal get wrong (e.g. one long string in one field).

**Fix plan:**

- **A.** Add a **Vancouver-comma** variant: detect tail `, (19|20)\d{2}[^;]*;\d+\(\d+\):[^.]*\.?$`, then split the part before that tail on commas and assign: last segment → year (strip time if present), previous → journal, previous → title, rest → authors.
- **B.** Or: in Vancouver, if the standard period-split yields only 1–2 segments but the string contains `;Vol(Issue):Pages`, try a comma-split and reassign.

---

## 4. Book chapter “In Book Title Year (pp. X–Y).” not fully extracted

**What happens:** Refs like [4] and [5]: `"Genetic algorithm: Theory..." In Nature-Inspired Optimizers 2020 (pp. 69-85).` or `In Evolutionary algorithms and neural networks, pp. 43-55. Springer, Cham, 2019.`

Post-parse chapter extraction looks for:

- `In: Editor (Ed.), Book Title`
- `In ... (Eds.), Book Title (pp. ...). Publisher`

So “In **Book Title** Year (pp. ...).” is not matched; **bookTitle** and **pages** are not set.

**Result:** Type may be “other” or book; missing book title and/or pages in output.

**Fix plan:**

- **A.** Add a pattern in the shared “chapter extraction” (or in IEEE/Chicago) for:
  - `In Book Title Year (pp. X–Y).` or `In Book Title, Year (pp. X–Y).`
  - and optionally `In Book Title, pp. X–Y. Publisher, Year.`
- **B.** Set `parsed.bookTitle`, `parsed.pages`, and `parsed.year` from these matches and keep type as bookChapter.

---

## 5. Report / thesis: institution and type

**What happens:** [9] `Mathew, T.V., 2012. Genetic algorithm. Report submitted at IIT Bombay.`  
[39] `Piserchia, Zachary. "Applications of Genetic Algorithms in Bioinformatics." PhD diss., UC Riverside, 2018.`

- **determineReferenceType** gives thesis/report when “report”, “phd”, “diss” appear in raw text.
- **parseGeneric** (and others) don’t set **publisher** or **institution** from “Report submitted at X” or “PhD diss., X, Year”.

**Result:** Type can be correct, but institution/publisher missing and APA output incomplete.

**Fix plan:**

- **A.** In generic (or a shared helper): regex for “Report submitted at **Institution**” and “PhD diss., **Institution**, Year” / “Master’s thesis, **Institution**, Year” and set `parsed.institution` or `parsed.publisher`.
- **B.** Ensure CSL/APA rendering uses institution when present for report/thesis.

---

## 6. “Volume-7, Issue-6” and “Vol. 7, no. 1” variants

**What happens:** Some refs use “Volume-7, Issue-6” or “Vol 7, no. 1” or “3(5), 3792-7” without “vol.”/“no.” prefixes. Current parsers look for `vol\.\s*\d+` and `no\.\s*\d+`.

**Result:** Volume and issue sometimes missing → weak journal type score → “other” or wrong type.

**Fix plan:**

- **A.** Add optional patterns: `Volume[- ]?\s*(\d+)`, `Issue[- ]?\s*(\d+)`, and bare `(\d+)\((\d+)\)` (and `(\d+)\((\d+)\),\s*p?\.?\s*(\d+[-–]\d+)`) in IEEE/Vancouver/generic and map to volume, issue, pages.
- **B.** In generic parser, add a single “journal tail” regex that captures Vol(Issue):Pages or Volume-Issue and sets volume, issue, pages in one go.

---

## 7. Multi-line references and newlines

**What happens:** Refs like [16] or [27] span two lines. The client merges lines within a numbered block into one string (with space). So the server gets one ref with spaces where newlines were. No issue if `preNormalize` already collapses whitespace.

**Result:** Usually fine; only risk is if a pattern assumes a single line (e.g. `$` for “end of string” when the real end is after a newline). Quick check: ensure all “tail” regexes use `\s*$` or trim before matching.

**Fix plan:**

- **A.** Confirm `preNormalize` collapses newlines to space (already does).
- **B.** When adding new patterns, use `\s*$` or trim so trailing newline doesn’t break matches.

---

## 8. Abbreviated / odd journal names

**What happens:** “Int. j. of eng. Sc. and tech.”, “Int. j. of eng. Sc. and tech.”, “Statistics and computing” — no structural failure, but abbreviated journals may not match “journal” patterns that expect longer words.

**Result:** Usually still parsed as journal if volume/issue/pages are present; type scoring may be borderline. Low priority unless we see “other” for these.

**Fix plan:**

- **A.** Leave as-is unless data show many misclassified; optionally add “Int. j.” / “J. of” as a soft journal signal in type scoring.

---

## 9. References with no journal/venue (standalone book, report)

**What happens:** [2] `Goldberg DE, Holland JH, Genetic algorithms and machine learning, 1988.` — no journal, no “In …”, no publisher. So we get author, title, year only. **determineReferenceType** needs publisher or book-like cues to score “book”; without them we get **other**.

**Result:** Type “other”, and possibly “Unclear source type” in Reference Health.

**Fix plan:**

- **A.** In type scoring: if we have author + title + year and no journal/conference/bookTitle, give **book** a small positive score so we don’t default to “other” when it’s clearly a standalone work.
- **B.** Or: add a “minimal book” rule: author, title, year, no venue → book (and render as “Author. (Year). Title.” with optional “Publisher” if we ever get it).

---

## 10. DOI and URLs

**What happens:** [14], [17], etc. contain “DOI: …” or “https://doi.org/…”. Product strips DOI from output. No bug.

**Result:** Expected; no change unless you want to show “DOI available but omitted” in the breakdown.

---

## Summary table

| # | Error category | Likely refs affected | Proposed fix (short) |
|---|----------------|----------------------|-----------------------|
| 1 | Style not detected as IEEE/hybrid | Most of 1–46 | Bias IEEE or add comma-ieee when tail matches `Year;Vol(Issue):Pages` |
| 2 | IEEE requires quoted title → generic | 1, 2, 3, 6, 7, 10, 13, 16, … | Add IEEE path (or new parser) for comma-separated Author, Title, Journal, Year;Vol:Pages |
| 3 | Vancouver expects “. ” not “, ” | 1, 7, 10, 13, … | Add Vancouver-comma branch or comma-split when tail matches |
| 4 | Book chapter “In Title Year (pp.)” | 4, 5, 28, 31 | Add chapter pattern In Book Title Year (pp. X–Y). |
| 5 | Report/thesis institution | 9, 39, 38 | Extract “Report submitted at X”, “PhD diss., X, Year” → institution |
| 6 | Volume/Issue variants | 7, 13, 14, 15, … | Regex for Volume-N, Issue-N and bare Vol(Issue):Pages |
| 7 | Multi-line refs | 16, 27, … | Confirm trim/collapse; use \s*$ in new regexes |
| 8 | Abbreviated journals | 7, … | Optional: soft journal signal for “Int. j.” etc. |
| 9 | No venue → “other” | 2, 6, … | Score “book” when author+title+year only |

---

## Suggested implementation order

1. **Comma-separated journal parser (covers 1, 2, 3)**  
   One new path (e.g. “comma-journal” or extended Vancouver) that:
   - Detects tail `, (19|20)\d{2}[^;]*;\d+\(\d+\):[^.]*` or `, (19|20)\d{2}\.` and similar.
   - Splits the rest on commas and assigns authors, title, journal, year, volume, issue, pages.
   - Runs when style is auto and no quoted title (or when IEEE is detected but no quote).

2. **Book chapter “In Title Year (pp.)” (covers 4)**  
   Single regex in post-parse chapter extraction.

3. **Report/thesis institution (covers 5)**  
   One small helper in generic (or shared) for “Report submitted at X” and “PhD diss., X, Year”.

4. **Volume/Issue/pages variants (covers 6)**  
   Add optional patterns in the new comma parser and in generic for `Volume-N`, `Issue-N`, `(\d+)\((\d+)\)[,:]`.

5. **Type “book” when author+title+year only (covers 9)**  
   In `determineReferenceType`, add a rule: if journal/conference/bookTitle/publisher all empty and we have author + title + year, add +2 to book so we don’t fall to “other”.

Tell me which of these you want implemented first (or which to change), and I’ll apply the code changes accordingly.
