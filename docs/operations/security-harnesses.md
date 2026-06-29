# Security Harnesses

Last verified on 2026-06-25 against `server/scripts/security/*` and the root/`server` `package.json` scripts.

This project includes three dedicated security harnesses that are meant to be rerun during route hardening, runtime changes, and release checks. Sources live in `server/scripts/security/` (`pentest.ts`, `fuzz.ts`, `realistic.ts`, plus shared helpers in `shared.ts`).

## Commands

(Root `package.json` delegates each to the matching `server` script.)

- `pnpm security:pentest`
  - Runs targeted authorization and admin-surface checks.
  - Covers API-key cross-tenant create/list and server-side tier derivation, job status / legacy `/stream` / live `/events` SSE / delete / export / pro-enrich access boundaries (with job-access-token sharing), JWT audience-mismatch rejection and revocation-outage behavior, admin-approve anonymous rejection, and anonymous ML admin runtime access.
- `pnpm security:fuzz`
  - Sends malformed and adversarial payloads through the server and ML service.
  - Flags unexpected `5xx` responses, parser crashes, and timeouts.
- `pnpm security:realistic`
  - Exercises production-like flows.
  - Covers async upload plus token polling/export, shared upload ceilings, multi-tenant concurrency fairness, and usage-counter race scenarios.
- `pnpm security:all`
  - Runs all three harnesses in sequence (`pentest && fuzz && realistic`), so it stops at the first harness that fails.
  - This command is expected to fail when the harnesses detect a live issue.

## Output

- Reports are written to `docs/test-results/security/`.
- Each run emits both:
  - a machine-readable JSON report
  - a Markdown summary for review history

## Runtime Notes

- The harnesses start a local ML service automatically when a check needs it.
- If the local machine is slower to boot Python or the ML service, set `SECURITY_ML_STARTUP_TIMEOUT_MS` before running the harnesses.
- Example:
  - PowerShell: `$env:SECURITY_ML_STARTUP_TIMEOUT_MS = '45000'`
- This only extends the harness startup budget. It does not relax request-timeout assertions inside the security checks.

## Intended Use

- Run these harnesses after changes to:
  - job ownership and access control
  - auth middleware or token issuance
  - upload ingestion paths
  - queue admission logic
  - ML admin or serving endpoints
- Pair these harnesses with dependency audit and the existing backend test suite for broader release validation.
