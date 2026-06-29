# BulkReferences — Setup & Deploy Runbook

> **📌 Status note — updated 2026-06-25.** This document predates recent engineering work; parts below are point-in-time. Key changes since: the **BullMQ** queue layer described here was vestigial and has been **removed** (the live async path is in-process `queueMicrotask`); **enrichment is enabled** behind `FEATURE_LIVE_ENRICH` (+cache+budget); **AMA / ACS / Chicago-notes** render natively (no APA fallback); **pages, ISBN, and author-parsing** are fixed; health now flags confident-wrong fields; the **DeterministicResolver** DOI migration has started. See **[System Assessment](engine/system-assessment.md)** for the live status.


Reconstructed from `.env` + `render.yaml` + `package.json` scripts (2026-06-24). This is
the "I forgot how I wired this up" reference.

## Services this app uses (your actual stack)

| Service | Used for | Dev | Prod |
|---|---|---|---|
| **Postgres** | durable persistence (Drizzle) | local Docker `localhost:5432` | **Neon** (`DATABASE_URL=postgresql://…neon.tech/…?sslmode=require`) |
| **Redis** | **optional** — auth-revocation list + cache only. The live async path is in-process `queueMicrotask`; **there is no BullMQ queue**, so Redis is not required to process jobs. | **Redis Cloud / redislabs** (your `.env` points here) | Redis Cloud / Upstash |
| **ML service** | Phase-4 BIO extractor (FastAPI) | local `:8123` | optional — `ML_PHASE4_MODE=heuristic` means the API runs fine without it |
| **Cloudflare R2** | large export artifacts | account `8472cc…`, bucket `bulkreferences` | same |
| **OpenAI** | Phase 6.5 LLM repair | `OPENAI_API_KEY` | same |
| **Clerk** | primary auth (JWT) | `dashing-wasp-57.clerk.accounts.dev` | same |
| **WorkOS** | institutional SSO | `WORKOS_*` | same |
| **Crossref / OpenAlex / Semantic Scholar** | Phase 8 enrichment | HTTP, keys optional | same |
| **Resend** | contact-form email | `RESEND_API_KEY` | same |
| **Render** | backend host | — | web service `bulkreferences-api` |
| **Vercel** | frontend host | — | project `bulkreferences-frontend` |

> ⚠️ Your `.env` `REDIS_URL` points at a redislabs host that currently fails DNS
> (`getaddrinfo ENOTFOUND`) — that Redis Cloud instance looks expired. Redis is
> **optional** (the server runs "degraded" without it), so this doesn't block the
> backend. To restore it: recreate a Redis Cloud/Upstash DB and update `REDIS_URL`,
> or for local dev point it at Docker: `REDIS_URL=redis://localhost:6379`.

## A. Run the backend locally

Prereqs: Node 20+, `pnpm`, Python 3.11+, Docker Desktop.

```bash
# 1. install workspace deps (root = pnpm monorepo: frontend + server)
pnpm install

# 2. secrets — you already have a filled-in .env at repo root. If starting clean:
cp .env.example .env   # then fill DATABASE_URL, OPENAI_API_KEY, R2_*, CLERK_*, WORKOS_*, etc.

# 3. infra (local Postgres + Redis via Docker)
pnpm run infra:up      # docker compose up -d postgres redis
#   NOTE: if REDIS_URL in .env points at redislabs, the server uses that, not the
#   Docker redis. Set REDIS_URL=redis://localhost:6379 to use the local one.

# 4. apply DB migrations
pnpm --dir server run db:migrate

# 5a. everything at once (server :4000, frontend :2397, ml :8123)
pnpm run dev
# 5b. or piecemeal:
pnpm run dev:server    # Fastify API on :4000
pnpm run dev:frontend  # Vite app on :2397
pnpm run dev:ml        # FastAPI ML on :8123 (needs `pip install -r ml-service/requirements.txt`)
```

Verify: `curl http://localhost:4000/health` → `{"status":"ok"|"degraded", "checks":{"postgres":{"status":"ok"}…}}`
("degraded" just means Redis is down — fine.) Then `POST http://localhost:4000/v1/convert`
with `{"sourceType":"text","content":"<a reference>","outputStyle":"apa7"}`.

### Run the production build locally (what Render runs)
```bash
pnpm --dir server run build      # tsc -> server/dist
node server/dist/index.js        # reads server/.env; listens on $PORT (4000)
```

## B. Deploy the backend (Render)

The web service is **`bulkreferences-api`** (`render.yaml`): `rootDir: server`,
build `npm install && npm run build`, start `node dist/index.js`, health `/health`.

`render.yaml` only declares `NODE_ENV` + a generated `SESSION_SECRET` — **every other
env var is set manually in the Render dashboard** (Service → Environment). That's the
part that's easy to forget. Paste these from your `.env` (prod values):

- **Required**: `DATABASE_URL` (Neon, `?sslmode=require`), `SESSION_SECRET` (generate: `openssl rand -hex 32`)
- **Auth**: `AUTH_MODE=hybrid`, `CLERK_JWKS_URL`, `CLERK_JWT_ISSUER`, `WORKOS_API_KEY`, `WORKOS_JWKS_URL`, `WORKOS_CLIENT_ID` (⚠️ currently empty in `.env` — set it to match `VITE_WORKOS_CLIENT_ID`)
- **Integrations**: `OPENAI_API_KEY`, `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME`, `SEMANTIC_SCHOLAR_API_KEY`, `RESEND_API_KEY`, `CROSSREF_EMAIL`
- **Optional**: `REDIS_URL` (omit to run without Redis), `ML_SERVICE_URL` (omit unless you deploy the FastAPI service too)
- **CORS**: `CORS_ALLOWED_ORIGINS` must include the Vercel frontend origin (e.g. `https://bulkreferences-frontend.vercel.app`)

After deploy, Render gives you a URL like `https://bulkreferences-api.onrender.com`.
Confirm `GET https://bulkreferences-api.onrender.com/health` → 200. **That URL is what
the frontend needs next.**

## C. Make the Vercel frontend fully work

The 404 is already fixed (`frontend/vercel.json` pins `outputDirectory: dist/public`).
But `VITE_*` are **build-time** vars and the Vercel project currently has **none set**,
so the deployed app loads but can't reach the backend or init auth. Add these in
**Vercel → bulkreferences-frontend → Settings → Environment Variables** (Production +
Preview), then **redeploy** (build-time = must rebuild):

- `VITE_API_BASE_URL` = the Render backend URL from step B (e.g. `https://bulkreferences-api.onrender.com`)
- `VITE_CLERK_PUBLISHABLE_KEY` = your `pk_…` from `.env` (public key — safe to set)
- `VITE_WORKOS_CLIENT_ID` = your `client_…` from `.env`
- (optional) `VITE_CLERK_JWT_TEMPLATE`, `VITE_DEBUG_AUTH=false`

Redeploy: `vercel --prod` (from repo root, already linked) **or** push to `main` (GitHub
→ Vercel auto-deploys). All `VITE_*` are public (they ship in the client bundle), so
none of these are secrets.

> The auto-generated deployment URLs (`…-xxxx.vercel.app`) return 302 → Vercel SSO
> because **Deployment Protection** is on. The production alias
> `bulkreferences-frontend.vercel.app` is public (200). If you want preview URLs public
> too, turn it off in Settings → Deployment Protection.

## Order of operations (the dependency chain)
1. Backend up on Render → get its public URL.
2. Set `VITE_API_BASE_URL` (+ Clerk/WorkOS) on Vercel → redeploy.
3. Add the Vercel origin to the backend's `CORS_ALLOWED_ORIGINS` → redeploy backend.
4. Frontend now talks to backend. Done.
