# Technical Specification: Citing

**Stack**: TypeScript, React (Vite), Node.js (Express/FastAPI), TailwindCSS, Radix UI, pnpm.

## Styling Approach
- **Required**: TailwindCSS utility classes for 95% of styling.
- **Custom CSS**: Only allowed in `index.css` for global design tokens, complex keyframe animations, or third-party library overrides that cannot be handled via Tailwind.
- **Aesthetics**: Glassmorphism, dynamic transitions (Framer Motion), and modern typography.

## Testing Standards
- **Standard**: 100% coverage for citation extraction logic and CSL mapping.
- **Unit Testing**: Vitest for all engine phases.
- **E2E Testing**: Playwright for critical user flows (Bulk Paste → Conversion → Export).
- **Regression**: `Stress-Finale` harness must be run before every major release.

## Backend & Infrastructure
- **Language**: TypeScript for frontend/orchestration; Python for NLP/ML (FastAPI) to handle SciBERT and BART-NLI models.
- **Schema Architecture**: `shared/schema.ts` is a barrel re-export from 4 focused submodules: `schema/types.ts` (core), `schema/v2Types.ts` (v2 engine), `schema/reportTypes.ts` (failure reporting), `schema/validation.ts` (Zod + utilities).
- **Shared Utilities**: Common logic lives in `shared/` (e.g., `computeRulesScore.ts`, `confidence.ts`, `clustering.ts`). New duplicated patterns should always be extracted here.
- **Database**: 
    - **v2 Jobs**: Supabase Postgres via Drizzle ORM (`v2JobStorage.ts`, resilient pattern with in-memory fallback).
    - **Reports/Truth**: File-based JSONL (`data/reports.v2.jsonl`, `data/truthStore.v2.jsonl`).
    - **Cache**: Redis for embeddings and API (Crossref/Semantic Scholar) response caching.
- **Async Processing**: ARQ (Async Redis Queue) for handling large batch jobs (Phase 12+).
- **Deployment**: Vercel (Frontend/API) + GPU-enabled instances for NLP models (e.g., Render or Modal).

## API Design & Error Handling
- **Standard**: RESTful API with OpenAPI/Swagger documentation.
- **Error Handling**: All API boundaries MUST return consistent JSON error objects: `{ "error": string, "code": string, "details": any }`.
- **User-Facing Errors**: Use Sonner toasts for transient errors; inline alert components for validation errors.
- **Rate Limiting**: 100 citations per hour for free tier; authenticated API keys for B2B tiers.

## Intelligence Implementation (New Engine Architecture)
- **Ingestion**: `pdfplumber` and `python-docx` for structured extraction.
- **Citation Splitting**: Regex boundary detection + Binary Line-Pair classifier.
- **Format Detection**: Fine-tuned multi-label classifier (DistilBERT-base).
- **Field Extraction**: SciBERT + CRF Sequence Labeler (`SIRIS-Lab/citation-parser-ENTITY`).
- **Author Disambiguation**: Fine-tuned NER (`SIRIS-Lab/affilgood-NER-multilingual`).
- **Reference Type Classification**: Fine-tuned multi-class classifier on CSL types.
- **LLM Fallback**: GPT-4.1 nano for mandatory fields per source-type schema.
- **Deduplication**: MinHash + LSH (Locality Sensitive Hashing) clustering.
- **Enrichment Waterfall**: CrossRef → OpenAlex (additive-only rule).
- **Quality Scoring**: Calibrated ML regression model.
- **Authority**: CrossRef + Retraction Watch DB.
- **Self-Improvement**: Post-pipeline Feedback Layer with Active Learning queues.

## Discouraged Patterns
- **No Heavy Databases**: Avoid Postgres/Mongo for citation storage unless explicitly required for user accounts.
- **No Sequential API Calls**: Use `asyncio.gather` or `Promise.all` for all independent pipeline phases.
- **No Hardcoded Formats**: Use CSL for all output rendering; do not build manual string formatters.
- **No Direct Model Inference in Main API**: ML models must run in dedicated, scalable workers to prevent event loop blocking.

