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
- **Database**: 
    - **Primary**: File-based JSONL for reports and patterns (low-overhead).
    - **Cache**: Redis for embeddings and API (Crossref/Semantic Scholar) response caching.
- **Async Processing**: ARQ (Async Redis Queue) for handling large batch jobs (Phase 12+).
- **Deployment**: Vercel (Frontend/API) + GPU-enabled instances for NLP models (e.g., Render or Modal).

## API Design & Error Handling
- **Standard**: RESTful API with OpenAPI/Swagger documentation.
- **Error Handling**: All API boundaries MUST return consistent JSON error objects: `{ "error": string, "code": string, "details": any }`.
- **User-Facing Errors**: Use Sonner toasts for transient errors; inline alert components for validation errors.
- **Rate Limiting**: 100 citations per hour for free tier; authenticated API keys for B2B tiers.

## Intelligence Implementation (Phase 2-11)
- **Format Detection**: `facebook/bart-large-mnli` (Zero-shot classification).
- **Field Extraction**: `allenai/scibert_scivocab_uncased` NER + GPT-4o-mini fallback.
- **Deduplication**: Qdrant (Vector Search) + `text-embedding-3-small`.
- **Enrichment Waterfall**: Crossref (DOI/Fuzzy) → Semantic Scholar → PubMed.

## Discouraged Patterns
- **No Heavy Databases**: Avoid Postgres/Mongo for citation storage unless explicitly required for user accounts.
- **No Sequential API Calls**: Use `asyncio.gather` or `Promise.all` for all independent pipeline phases.
- **No Hardcoded Formats**: Use CSL for all output rendering; do not build manual string formatters.
- **No Direct Model Inference in Main API**: ML models must run in dedicated, scalable workers to prevent event loop blocking.

