# BulkReferences Documentation

> **📌 Status note — updated 2026-06-25.** This document predates recent engineering work; parts below are point-in-time. Key changes since: the **BullMQ** queue layer described here was vestigial and has been **removed** (the live async path is in-process `queueMicrotask`); **enrichment is enabled** behind `FEATURE_LIVE_ENRICH` (+cache+budget); **AMA / ACS / Chicago-notes** render natively (no APA fallback); **pages, ISBN, and author-parsing** are fixed; health now flags confident-wrong fields; the **DeterministicResolver** DOI migration has started. See **[System Assessment](engine/system-assessment.md)** for the live status.


Last verified against the repository on 2026-06-25.

## What this is (current reality)

BulkReferences is a citation **converter**: a **17-phase** extraction/normalization/render
engine (`server/src/engine/phases/`) fronted by a Fastify API, with async work running
**in-process** (`queueMicrotask` — there is no live BullMQ queue; Redis is optional). The
BIO field extractor is an ONNX BiLSTM served by FastAPI on `:8123` (ML is **off by default**
in the fast lane). Provider **enrichment** (Crossref/OpenAlex) is gated behind
`FEATURE_LIVE_ENRICH` (default **off**). Phase 12 renders 9 first-class native styles
(APA7, MLA9, Chicago author-date, Chicago notes-bib, Vancouver, IEEE, Harvard, AMA, ACS)
with citeproc/CSL as the fallback. Backend deploys on **Render**, frontend on **Vercel**;
the LLM repair path uses OpenAI **gpt-5.4-nano**. For a holistic live read, start with
**[System Assessment](engine/system-assessment.md)** and **[Engine Overview](engine/engine-overview.md)**.

## Hierarchy

- `engine/`
  - The 17-phase pipeline: [engine-overview.md](engine/engine-overview.md), [phase-index.md](engine/phase-index.md), [system-assessment.md](engine/system-assessment.md), field-ownership / refactor-seam / quality-system notes, and per-phase docs under `e13-phases/`.
- `ml-system/`
  - ML serving, training, promotion, runbooks (`ml-ops-runbook.md`, `runbook.md`), model cards, and the BIO engine priority plan.
- `api/`
  - Public and internal API contracts and behavior (`api-contracts.md`, `error-and-response-contracts.md`, `b2b-overview.md`).
- `operations/`
  - Runtime operations, deployment controls, and security harnesses. **Backend setup/deploy lives at the top level: [SETUP-RUNBOOK.md](./SETUP-RUNBOOK.md)** (Postgres/Neon, optional Redis, R2, OpenAI, Clerk+WorkOS, Resend, Render+Vercel).
- `governance/`
  - Data/truth governance and decision ownership.
- `frontend/`
  - Frontend documentation entrypoint and planning.
- `shared/`
  - Cross-cutting architecture, benchmark summaries, ADRs (`decisions/`), and status.
- `test-results/`
  - Generated diagnostics with strict retention (first + latest per group).

## Planning Surface

- [later-plan.md](./later-plan.md)
  - Master planning index (domain-plan hub) and cross-domain backlog.
- [plan-later.md](./plan-later.md)
  - Dated ML/BIO engine-evidence and engine-v2 backlog (companion to `later-plan.md`).
- Domain plans:
  - [api/api_plan.md](./api/api_plan.md)
  - [engine/engine_plan.md](./engine/engine_plan.md)
  - [frontend/frontend_plan.md](./frontend/frontend_plan.md)
  - [governance/governance_plan.md](./governance/governance_plan.md)
  - [ml-system/ml_system_plan.md](./ml-system/ml_system_plan.md)
  - [operations/operations_plan.md](./operations/operations_plan.md)
  - [shared/shared_plan.md](./shared/shared_plan.md)

## Retention Rules

- `docs/test-results/regression-*`: keep first and latest run only.
- `docs/test-results/security/*`: keep first and latest per harness group, retaining both `.json` and `.md`.
- No generated test artifact should be kept outside `docs/test-results`.
