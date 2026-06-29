/**
 * Query param used to distinguish sign-in entry points on /login.
 * - user: individual Clerk account (default)
 * - admin: should land on /adm1n instead; kept for redirects / old links
 */
export const LOGIN_FLOW_QUERY = "flow" as const;
export const LOGIN_MODE_QUERY = "mode" as const;

export type LoginFlowKind = "user" | "admin" | "institutional";
export type LoginModeKind = "sign-in" | "sign-up";

export function parseLoginFlow(search: string): LoginFlowKind {
  const raw = new URLSearchParams(search).get(LOGIN_FLOW_QUERY)?.toLowerCase();
  if (raw === "admin") return "admin";
  if (raw === "institutional") return "institutional";
  if (raw === "user" || raw === "individual") return "user";
  return "user";
}

export function parseLoginMode(search: string): LoginModeKind {
  const raw = new URLSearchParams(search).get(LOGIN_MODE_QUERY)?.toLowerCase();
  if (raw === "sign-up" || raw === "signup" || raw === "register" || raw === "create-account") {
    return "sign-up";
  }
  return "sign-in";
}

/** Default post-auth destination when no safe `redirect` is present. */
export function defaultRedirectForFlow(flow: LoginFlowKind): string {
  switch (flow) {
    case "admin":
      return "/admin/dashboard";
    case "institutional":
    case "user":
    default:
      return "/";
  }
}

export function readSafeRedirect(search: string): string | null {
  const raw = new URLSearchParams(search).get("redirect");
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) {
    return raw;
  }
  return null;
}

type AuthEntryUrlOptions = {
  flow: LoginFlowKind;
  mode?: LoginModeKind;
  redirect?: string | null;
};

export function buildAuthEntryUrl(options: AuthEntryUrlOptions): string {
  const params = new URLSearchParams();
  const mode = options.mode ?? "sign-in";

  if (options.flow !== "user") {
    params.set(LOGIN_FLOW_QUERY, options.flow);
  } else {
    params.set(LOGIN_FLOW_QUERY, "user");
  }

  if (mode === "sign-up") {
    params.set(LOGIN_MODE_QUERY, "sign-up");
  }

  if (options.redirect && options.redirect.startsWith("/") && !options.redirect.startsWith("//")) {
    params.set("redirect", options.redirect);
  }

  const path = options.flow === "admin"
    ? "/adm1n"
    : options.flow === "institutional"
      ? "/institutional-login"
      : "/login";
  const query = params.toString();

  return query ? `${path}?${query}` : path;
}

/** True when this URL should use the admin portal (/adm1n), not the public /login UI. */
export function shouldUseAdminPortal(search: string): boolean {
  const q = new URLSearchParams(search);
  if (q.get(LOGIN_FLOW_QUERY)?.toLowerCase() === "admin") {
    return true;
  }
  const redir = q.get("redirect") ?? "";
  return redir.startsWith("/admin");
}
