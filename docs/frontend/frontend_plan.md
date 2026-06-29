# Frontend Plan

Last reviewed: 2026-06-25

## Contents

- [Implemented Baseline](#implemented-baseline)
- [File Plan](#file-plan)
- [Future Planned Work](#future-planned-work)

## Implemented Baseline

- Frontend docs folder is established and linked from root docs.
- Frontend-specific plan and README now exist in a dedicated location.
- The client is a Vite + React single-page app under `frontend/client/src` (`pages/`, `components/`, `features/`, `hooks/`, `lib/`, `oauth/`, `providers/`). It runs on dev port `2397`, builds to `frontend/dist/public`, and deploys to Vercel. Auth uses Clerk + WorkOS.
- Admin training surfaces are implemented under `frontend/client/src/components/admin-training/` — including `AdminBioReview`, bulk selection/update (`AdminTrainingBulkSelectionBar`, `AdminTrainingBulkUpdateDialog`), certification (`AdminTrainingCertifyDialog`), render variants (`AdminTrainingRenderVariantsSection`), workflow/disclosure/guide sections, and the BIO training entry (`AdminBioTraining.tsx`). Admin routes exist as `pages/admin-login.tsx` and `pages/admin-approve.tsx`.
- Admin auth UI now treats transient `/internal/admin/session` failures as retryable probe failures instead of immediately showing the wrong-account message.
- Session probes now degrade to JWT/profile-backed identity on `/internal/admin/session` and `/v1/auth/session` when DB identity resolution is temporarily unavailable, so the UI does not mislabel that condition as a wrong-account result.

## File Plan

| File | Implemented Today | Future Planned Work |
| --- | --- | --- |
| `README.md` | Frontend docs entrypoint and scope are defined; now reflects the real Vite client, dev port `2397`, and Vercel deploy. | Add a deeper component-map section (`training`, `admin`, `references`, `analytics`) with file pointers. |
| `frontend_plan.md` | File-by-file planning structure is now available. | Expand with route-level UX docs and admin workflow state diagrams. |

## Future Planned Work

- Add docs for admin training surfaces:
  - bulk actions
  - expected/core/overlay truth editing
  - background job progress and toast behavior
- Add frontend error-state catalog (auth expiry, inactivity failures, rate-limit messaging).
- Add explicit frontend auth-state timing diagrams for admin probe retries, stale snapshot reuse, and backend-unavailable handling.
- Add accessibility and responsive behavior notes tied to tested viewport ranges.
