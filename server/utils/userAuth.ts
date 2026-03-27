import type { Request, Response } from "express";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { publicAuthStore } from "../store/publicAuthStore.js";

const PUBLIC_SESSION_COOKIE = "bulkreferences_session";
const PUBLIC_SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
const PUBLIC_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const PUBLIC_LOGIN_MAX_ATTEMPTS = 10;

type PublicSessionPayload = {
  exp: number;
  sub: string;
};

type LoginAttemptState = {
  count: number;
  resetAt: number;
};

const failedLoginAttempts = new Map<string, LoginAttemptState>();

function hashValue(value: string) {
  return createHash("sha256").update(value).digest();
}

function getForwardedIP(req: Request) {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
    || req.socket.remoteAddress
    || "unknown";
}

function isCookieSecure(req: Request) {
  const vercel = process.env.VERCEL?.toLowerCase();
  return req.secure
    || process.env.NODE_ENV === "production"
    || vercel === "1"
    || vercel === "true";
}

function getPublicSessionSecret() {
  return process.env.APP_SESSION_SECRET?.trim()
    || process.env.ADMIN_SESSION_SECRET?.trim()
    || (process.env.NODE_ENV === "production" ? "" : "dev-bulkreferences-session-secret");
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    httpOnly?: boolean;
    maxAge?: number;
    path?: string;
    sameSite?: "Strict" | "Lax";
    secure?: boolean;
  } = {},
) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge != null) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }

  parts.push(`Path=${options.path ?? "/"}`);

  if (options.httpOnly) parts.push("HttpOnly");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push("Secure");

  return parts.join("; ");
}

function parseCookie(req: Request, name: string) {
  const rawCookie = req.headers.cookie;
  if (!rawCookie) return null;

  for (const entry of rawCookie.split(";")) {
    const [key, ...rest] = entry.trim().split("=");
    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }

  return null;
}

function signSessionPayload(encodedPayload: string) {
  return createHmac("sha256", getPublicSessionSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function buildSessionToken(accountId: string) {
  const encodedPayload = Buffer.from(JSON.stringify({
    exp: Date.now() + (PUBLIC_SESSION_TTL_SECONDS * 1000),
    sub: accountId,
  } satisfies PublicSessionPayload)).toString("base64url");

  return `${encodedPayload}.${signSessionPayload(encodedPayload)}`;
}

function decodeSessionToken(token: string | null): PublicSessionPayload | null {
  if (!token || !isPublicAuthConfigured()) return null;

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  const actualSignatureHash = hashValue(signature);
  const expectedSignatureHash = hashValue(signSessionPayload(encodedPayload));
  if (actualSignatureHash.length !== expectedSignatureHash.length) return null;
  if (!timingSafeEqual(actualSignatureHash, expectedSignatureHash)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<PublicSessionPayload>;
    if (typeof payload.exp !== "number" || payload.exp <= Date.now() || typeof payload.sub !== "string") {
      return null;
    }
    return {
      exp: payload.exp,
      sub: payload.sub,
    };
  } catch {
    return null;
  }
}

function getLoginAttemptState(ip: string) {
  const current = failedLoginAttempts.get(ip);
  const now = Date.now();
  if (!current || current.resetAt <= now) {
    failedLoginAttempts.delete(ip);
    return { count: 0, resetAt: now + PUBLIC_LOGIN_WINDOW_MS };
  }
  return current;
}

export function isPublicAuthConfigured() {
  return Boolean(getPublicSessionSecret());
}

export async function getAuthenticatedPublicUserFromRequest(req: Request) {
  const payload = decodeSessionToken(parseCookie(req, PUBLIC_SESSION_COOKIE));
  if (!payload) return null;
  return publicAuthStore.getSessionAccountById(payload.sub);
}

export async function getPublicSessionStatus(req: Request) {
  const account = await getAuthenticatedPublicUserFromRequest(req);
  return {
    authenticated: Boolean(account),
    configured: isPublicAuthConfigured(),
    account,
  };
}

export function checkPublicLoginRateLimit(req: Request) {
  const ip = getForwardedIP(req);
  const state = getLoginAttemptState(ip);
  return {
    allowed: state.count < PUBLIC_LOGIN_MAX_ATTEMPTS,
    remaining: Math.max(0, PUBLIC_LOGIN_MAX_ATTEMPTS - state.count),
    retryAfterSeconds: Math.max(1, Math.ceil((state.resetAt - Date.now()) / 1000)),
  };
}

export function recordFailedPublicLogin(req: Request) {
  const ip = getForwardedIP(req);
  const state = getLoginAttemptState(ip);
  failedLoginAttempts.set(ip, {
    count: state.count + 1,
    resetAt: state.resetAt,
  });
}

export function clearPublicLoginFailures(req: Request) {
  failedLoginAttempts.delete(getForwardedIP(req));
}

export function setPublicSessionCookie(req: Request, res: Response, accountId: string) {
  res.setHeader("Set-Cookie", serializeCookie(PUBLIC_SESSION_COOKIE, buildSessionToken(accountId), {
    httpOnly: true,
    maxAge: PUBLIC_SESSION_TTL_SECONDS,
    path: "/",
    sameSite: "Lax",
    secure: isCookieSecure(req),
  }));
}

export function clearPublicSessionCookie(req: Request, res: Response) {
  res.setHeader("Set-Cookie", serializeCookie(PUBLIC_SESSION_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "Lax",
    secure: isCookieSecure(req),
  }));
}
