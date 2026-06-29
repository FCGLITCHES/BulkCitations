/**
 * Verbose auth pipeline logging (Clerk vs WorkOS vs admin session).
 *
 * - Dev: on by default. Set `VITE_DEBUG_AUTH=false` to silence.
 * - Prod: only if `VITE_DEBUG_AUTH=true`, `localStorage bulkreferences:debugAuth=1`, or `window.__bulkreferencesAuthDebug=true`.
 */
function authDebugEnabled(): boolean {
  const envFlag = import.meta.env.VITE_DEBUG_AUTH;
  if (envFlag === "false") {
    return false;
  }
  if (envFlag === "true") {
    return true;
  }
  if (import.meta.env.DEV) {
    return true;
  }
  if (typeof window === "undefined") {
    return false;
  }
  try {
    if (window.localStorage?.getItem("bulkreferences:debugAuth") === "1") {
      return true;
    }
    if ((window as unknown as { __bulkreferencesAuthDebug?: boolean }).__bulkreferencesAuthDebug === true) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

let seq = 0;

function sanitize(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (typeof v === "string" && (k.toLowerCase().includes("token") || k === "authorization")) {
      out[k] = v.length > 24 ? `[string len=${v.length}]` : v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function authDebug(scope: string, step: string, detail?: Record<string, unknown>): void {
  if (!authDebugEnabled()) {
    return;
  }
  seq += 1;
  const payload = detail ? sanitize(detail) : undefined;
  console.debug(`[auth #${seq} ${scope}] ${step}`, payload ?? "");
}

export function authTokenMeta(token: string | null | undefined): { present: boolean; length: number } {
  if (!token) {
    return { present: false, length: 0 };
  }
  return { present: true, length: token.length };
}

/** Call from the console: `__bulkreferencesDumpAuth()` */
export async function dumpAuthPipelineState(): Promise<void> {
  if (!authDebugEnabled()) {
    console.info("[auth] Enable debug first: localStorage.setItem('bulkreferences:debugAuth','1'); location.reload()");
    return;
  }
  const getter =
    typeof window !== "undefined"
      ? (window as unknown as {
          __bulkreferencesGetOAuthRuntimeSnapshot?: () => unknown;
        }).__bulkreferencesGetOAuthRuntimeSnapshot
      : undefined;

  if (!getter) {
    console.info("[auth] OAuth runtime snapshot is not available yet.");
    return;
  }

  console.debug("[auth dump] pipeline", getter());
}

if (typeof window !== "undefined" && import.meta.env.DEV) {
  (window as unknown as { __bulkreferencesDumpAuth?: typeof dumpAuthPipelineState }).__bulkreferencesDumpAuth =
    dumpAuthPipelineState;
}
