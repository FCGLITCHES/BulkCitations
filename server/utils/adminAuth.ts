import type { NextFunction, Request, Response } from "express";
import { createHash, createHmac, timingSafeEqual } from "crypto";

const ADMIN_SESSION_COOKIE = "bulkreferences_admin_session";
const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12;
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_LOGIN_MAX_ATTEMPTS = 10;

type LoginAttemptState = {
  count: number;
  resetAt: number;
};

const failedLoginAttempts = new Map<string, LoginAttemptState>();

function hashValue(value: string) {
  return createHash("sha256").update(value).digest();
}

function getAdminPassword() {
  return process.env.ADMIN_PASSWORD?.trim() ?? "";
}

function getAdminSessionSecret() {
  return process.env.ADMIN_SESSION_SECRET?.trim() ?? "";
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

  if (options.httpOnly) {
    parts.push("HttpOnly");
  }

  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }

  if (options.secure) {
    parts.push("Secure");
  }

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
  return createHmac("sha256", getAdminSessionSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function buildSessionToken() {
  const encodedPayload = Buffer.from(JSON.stringify({
    exp: Date.now() + (ADMIN_SESSION_TTL_SECONDS * 1000),
  })).toString("base64url");

  return `${encodedPayload}.${signSessionPayload(encodedPayload)}`;
}

function verifySessionToken(token: string | null) {
  if (!token || !isAdminAuthConfigured()) {
    return false;
  }

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return false;
  }

  const actualSignatureHash = hashValue(signature);
  const expectedSignatureHash = hashValue(signSessionPayload(encodedPayload));

  if (!timingSafeEqual(actualSignatureHash, expectedSignatureHash)) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as { exp?: number };
    return typeof payload.exp === "number" && payload.exp > Date.now();
  } catch {
    return false;
  }
}

function getLoginAttemptState(ip: string) {
  const current = failedLoginAttempts.get(ip);
  const now = Date.now();

  if (!current || current.resetAt <= now) {
    failedLoginAttempts.delete(ip);
    return { count: 0, resetAt: now + ADMIN_LOGIN_WINDOW_MS };
  }

  return current;
}

export function isAdminAuthConfigured() {
  return Boolean(getAdminPassword() && getAdminSessionSecret());
}

export function getAdminSessionStatus(req: Request) {
  return {
    authenticated: verifySessionToken(parseCookie(req, ADMIN_SESSION_COOKIE)),
    configured: isAdminAuthConfigured(),
  };
}

export function verifyAdminPassword(password: string) {
  const configuredPassword = getAdminPassword();
  if (!configuredPassword) {
    return false;
  }

  return timingSafeEqual(hashValue(password), hashValue(configuredPassword));
}

export function checkAdminLoginRateLimit(req: Request) {
  const ip = getForwardedIP(req);
  const state = getLoginAttemptState(ip);

  return {
    allowed: state.count < ADMIN_LOGIN_MAX_ATTEMPTS,
    remaining: Math.max(0, ADMIN_LOGIN_MAX_ATTEMPTS - state.count),
    retryAfterSeconds: Math.max(1, Math.ceil((state.resetAt - Date.now()) / 1000)),
  };
}

export function recordFailedAdminLogin(req: Request) {
  const ip = getForwardedIP(req);
  const state = getLoginAttemptState(ip);

  failedLoginAttempts.set(ip, {
    count: state.count + 1,
    resetAt: state.resetAt,
  });
}

export function clearAdminLoginFailures(req: Request) {
  failedLoginAttempts.delete(getForwardedIP(req));
}

export function setAdminSessionCookie(req: Request, res: Response) {
  res.setHeader("Set-Cookie", serializeCookie(ADMIN_SESSION_COOKIE, buildSessionToken(), {
    httpOnly: true,
    maxAge: ADMIN_SESSION_TTL_SECONDS,
    path: "/",
    sameSite: "Strict",
    secure: isCookieSecure(req),
  }));
}

export function clearAdminSessionCookie(req: Request, res: Response) {
  res.setHeader("Set-Cookie", serializeCookie(ADMIN_SESSION_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "Strict",
    secure: isCookieSecure(req),
  }));
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "no-store");

  if (!isAdminAuthConfigured()) {
    return res.status(503).json({
      message: "Admin access is not configured. Set ADMIN_PASSWORD and ADMIN_SESSION_SECRET.",
    });
  }

  if (!verifySessionToken(parseCookie(req, ADMIN_SESSION_COOKIE))) {
    return res.status(401).json({ message: "Admin authentication required." });
  }

  return next();
}
