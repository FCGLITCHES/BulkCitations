# Frontend Documentation

This section tracks frontend-facing documentation and planning for the admin and user interfaces.

## Overview

- The frontend is a Vite + React single-page app living in `frontend/` (client code under `frontend/client/src`).
- Dev server runs on port `2397` (`pnpm dev` launches it alongside the API and ML service).
- Production build output is `frontend/dist/public`; the app deploys to Vercel (SPA rewrites to `/index.html`).
- Auth is Clerk + WorkOS. API requests resolve through `VITE_API_BASE_URL`.
- Admin training surfaces (BIO review, certification, bulk actions, render variants) live under `frontend/client/src/components/admin-training/`.

## Contents

- `frontend_plan.md`
  - File-by-file documentation plan and implemented/pending status for frontend docs in this folder.

## Notes

- Detailed component-level behavior is still documented primarily in source.
- As frontend docs are promoted, add them here and keep `frontend_plan.md` updated.
