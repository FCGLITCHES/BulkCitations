/** Bearer identity may have changed — refresh public `/v1/auth/session` and any client that depends on tokens. */
export const USER_AUTH_SESSION_EVENT = "bulkreferences-user-auth-changed";

/** Admin role / admin session snapshot changed (logout, tab sync). Refresh UI that chooses admin vs public nav. */
export const ADMIN_AUTH_SESSION_EVENT = "bulkreferences-admin-auth-changed";
