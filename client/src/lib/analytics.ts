export type AnalyticsEventName =
  | "page_view"
  | "converter_started"
  | "converter_completed"
  | "converter_failed";

const VISITOR_ID_KEY = "bulkreferences_visitor_id";
const SESSION_ID_KEY = "bulkreferences_session_id";

function createVisitorId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `anon_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function createSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `s_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function getVisitorId() {
  if (typeof window === "undefined") return "server";

  const existing = window.localStorage.getItem(VISITOR_ID_KEY);
  if (existing) return existing;

  const next = createVisitorId();
  window.localStorage.setItem(VISITOR_ID_KEY, next);
  return next;
}

function getSessionId() {
  if (typeof window === "undefined") return "server";

  const existing = window.sessionStorage.getItem(SESSION_ID_KEY);
  if (existing) return existing;

  const next = createSessionId();
  window.sessionStorage.setItem(SESSION_ID_KEY, next);
  return next;
}

function getDeviceType() {
  if (typeof window === "undefined") return "unknown";

  const width = window.innerWidth;
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

function detectBrowser(userAgent: string) {
  if (/edg\//i.test(userAgent)) return "edge";
  if (/opr\//i.test(userAgent) || /opera/i.test(userAgent)) return "opera";
  if (/chrome\//i.test(userAgent) && !/edg\//i.test(userAgent)) return "chrome";
  if (/safari\//i.test(userAgent) && !/chrome\//i.test(userAgent)) return "safari";
  if (/firefox\//i.test(userAgent)) return "firefox";
  return "unknown";
}

function detectOperatingSystem(userAgent: string) {
  if (/windows/i.test(userAgent)) return "windows";
  if (/android/i.test(userAgent)) return "android";
  if (/iphone|ipad|ipod/i.test(userAgent)) return "ios";
  if (/mac os x|macintosh/i.test(userAgent)) return "macos";
  if (/linux/i.test(userAgent)) return "linux";
  return "unknown";
}

function getReferrerHost() {
  if (typeof document === "undefined" || !document.referrer) return "direct";

  try {
    const referrerUrl = new URL(document.referrer);
    return referrerUrl.hostname || "direct";
  } catch {
    return "direct";
  }
}

function getRouteName(pathname: string) {
  if (pathname === "/") return "home";
  const trimmed = pathname.replace(/^\/+|\/+$/g, "");
  if (!trimmed) return "home";
  return trimmed.replace(/\//g, ":").slice(0, 80);
}

function getUtmMetadata() {
  if (typeof window === "undefined") return {};

  const params = new URLSearchParams(window.location.search);
  return {
    utmSource: params.get("utm_source"),
    utmMedium: params.get("utm_medium"),
    utmCampaign: params.get("utm_campaign"),
    utmTerm: params.get("utm_term"),
    utmContent: params.get("utm_content"),
  };
}

function buildAnalyticsContext(pathname: string) {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {};
  }

  const userAgent = navigator.userAgent || "";

  return {
    sessionId: getSessionId(),
    hostname: window.location.hostname || "unknown",
    routeName: getRouteName(pathname),
    referrerHost: getReferrerHost(),
    deviceType: getDeviceType(),
    browser: detectBrowser(userAgent),
    operatingSystem: detectOperatingSystem(userAgent),
    language: navigator.language || "unknown",
    screenWidth: window.screen?.width ?? window.innerWidth,
    screenHeight: window.screen?.height ?? window.innerHeight,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    isAdminSurface: pathname.startsWith("/admin"),
    ...getUtmMetadata(),
  };
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined) {
  if (!metadata) return undefined;

  const entries: Array<[string, string | number | boolean | null]> = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (value == null) {
      entries.push([key, null]);
      continue;
    }
    if (typeof value === "boolean") {
      entries.push([key, value]);
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      entries.push([key, Number(value.toFixed(2))]);
      continue;
    }
    if (typeof value === "string") {
      entries.push([key, value.slice(0, 120)]);
    }
  }

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function trackAnalyticsEvent(
  event: AnalyticsEventName,
  metadata?: Record<string, unknown>,
) {
  if (typeof window === "undefined") return;
  const pathname = window.location.pathname;

  const payload = JSON.stringify({
    event,
    visitorId: getVisitorId(),
    path: pathname,
    metadata: sanitizeMetadata({
      ...buildAnalyticsContext(pathname),
      ...metadata,
    }),
  });

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function" && typeof Blob !== "undefined") {
    const didQueue = navigator.sendBeacon(
      "/api/analytics/track",
      new Blob([payload], { type: "application/json" }),
    );
    if (didQueue) return;
  }

  void fetch("/api/analytics/track", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: payload,
    keepalive: true,
  }).catch(() => {
    // Analytics should never interrupt the product flow.
  });
}
