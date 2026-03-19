# Technical Specification: Citing (Bulk Citations)
*Stack: React, Vite, TailwindCSS (for UI), Node.js/Express (for Engine), Radix UI (for Components), pnpm 10 (for package management).*

### Infrastructure & Deployment
- **Vercel Deployment**: Requires `packageManager` field in `package.json` set to `pnpm@10.32.1`.
- **Lockfile**: `pnpm-lock.yaml` (version 9) must be committed to the root for correct Vercel detection.
- **Auto-Detection**: `vercel.json` should avoid overriding `installCommand` or `buildCommand` to allow Vercel to use the native pnpm build pipeline.


### Styling & UI
- **Required**: Vanilla CSS + TailwindCSS utility classes.
- **Library**: Radix UI (via Shadcn) for components. High-premium aesthetic: glassmorphism, animated transitions (Framer Motion).

### Citation Engine Architecture
1. **Pipeline**: Encoding → Pre-Normalization → Style Detection → Parsing (Hybrid) → CSL Conversion → Post-Processing/Formatting → Strict Assertion Running → Confidence Scoring.
2. **Hybrid Parser**: Combines a static waterfall with dynamic patterns stored in `patterns.json`.
3. **Strict Renderer**: CSL output is checked against 100+ fine-grained regex rules (assertions) per style to ensure 100% compliance with style guides (APA 7, IEEE, etc.).

### Failure Reporting & Auto-Detection
- **Storage**: JSONL (`data/reports.v2.jsonl`) with base64 fingerprinting for deduplication.
- **Auto-Queue Triggers**: 
  - `confidence < 60`
  - `styleDetectionFailed === true`
  - Any error-level assertion (from `strictRenderer.ts`)
  - Cluster type inconsistency
  - Parser artifacts (Field leakage / "et al." primary author)
- **Fix Propagation**: 
  - `dynamic-pattern` fixes are written directly to `server/data/patterns.json`.
  - The `CitationParser` hot-reloads patterns on file change using `fs.watch`.

### Database & Auth
- **Admin Access**: Current admin routes (`/admin/reports`) are unprotected (MVP).
- **Persistence**: File-based storage (JSONL/JSON) to avoid Postgres/Neon dependency overhead for high-write-volume citation patterns.
- **Rate Limiting**: IP-hashed rate limiting (10 reports/day/IP) to prevent spam.

### Testing
- **Vitest**: Unit tests for parser normalization and style guides.
- **Stress-Finale Harness**: 1000+ real-world citations from various PDFs for regression testing.
