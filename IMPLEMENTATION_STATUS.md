# Implementation Status & Architecture

## Core Pipeline Architecture (Hybrid Parser)

The engine has been refactored into a high-performance, HTTP-free pipeline in `server/engine/pipeline.ts`. 

### Pipeline Stages
1. **Normalise Encoding**: `server/engine/stages/normaliseEncoding.ts` — BOM, ligatures, OCR repair.
2. **Pre-Normalization**: `server/engine/citationParser.ts` — Numbering, HTML, and whitespace cleanup.
3. **Style Detection**: `server/engine/citationParser.ts` → `detectStyle()` — Heuristic scoring for 8+ styles.
4. **Hybrid Parsing**: 
   - **Static Rules**: Style-specific parsing (APA, IEEE, etc.).
   - **Dynamic Patterns**: `server/data/patterns.json`.
5. **CSL Conversion**: `server/engine/cslConverter.ts` — Maps parsed data to CiteProc-compatible JSON.
6. **Strict Rendering**: `server/engine/strictRenderer.ts` — CSL output is cross-referenced with 100+ style-guide compliance rules.
7. **Sanity Check**: `server/engine/stages/sanityCheck.ts` — Post-render validation (leaked tokens, short output).
8. **Confidence & Authority**: `shared/confidence.ts` & `shared/authorityLookup.ts` — Scoring via Semantic Scholar API.

---

## 🛠️ Implementation Progress

| Feature | Status | Location |
| :--- | :--- | :--- |
| **Hybrid Parser** | ✅ **100%** | `server/engine/citationParser.ts` |
| **Strict Compliance** | ✅ **95%** | `server/engine/strictRenderer.ts` (Assertions) |
| **Failure Reporting** | ✅ **100%** | `server/routes/reports.ts` & `client/src/components/AdminReportQueue.tsx` |
| **Auto-Queue** | ✅ **100%** | `server/store/autoQueue.ts` (Confidence < 60 triggers) |
| **Hot Reload Patterns** | ✅ **100%** | `server/utils/patternWriter.ts` (Writes live to `patterns.json`) |
| **Bulk PDF Processing** | 🧪 **Exp** | `tests/test-pdf-citations.test.ts` |

---

## 🚩 Where to Refine

- **Style Detection Fallback**: Currently defaults to APA if detection fails. Edit `server/engine/pipeline.ts` to change fallback behavior.
- **Reference Type Heuristics**: Fine-tune `determineReferenceType()` in `server/engine/citationParser.ts` for edge-case book chapters vs proceedings.
- **Pro Gating**: UI has `isPro` toggles but backend enforcement is limited to Authority Enrichment.

## 🧪 Testing
- Run `npm test` to execute Vitest unit tests.
- Run `npm run benchmark` (from scripts) to verify accuracy against the `benchmark-citations.json` corpus.
