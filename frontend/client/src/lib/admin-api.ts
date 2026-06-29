import { getExternalAuthToken } from "@/oauth/runtime";
import { resolveApiUrl } from "@/lib/api-url";

export class AdminRequestError extends Error {
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = "AdminRequestError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

function resolveUrl(url: string): string {
  return resolveApiUrl(url);
}

export async function adminFetch<T>(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers ?? {});
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const token = await getExternalAuthToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(resolveUrl(url), {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  if (!response.ok) {
    const message = typeof payload === "object" && payload && "message" in payload
      ? String((payload as { message?: unknown }).message ?? "")
      : typeof payload === "string" && payload
        ? payload
        : `${response.status} ${response.statusText}`;

    const details = typeof payload === "object" && payload && "details" in payload
      ? (payload as { details?: unknown }).details
      : undefined;

    throw new AdminRequestError(message || "Admin request failed.", response.status, details);
  }

  return payload as T;
}
/** Download a binary or text response (e.g. NDJSON export) with the same auth as `adminFetch`. */
export async function adminDownloadBlob(url: string): Promise<{ blob: Blob; filename: string | null }> {
  const headers = new Headers();
  const token = await getExternalAuthToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(resolveUrl(url), {
    credentials: "include",
    cache: "no-store",
    headers,
  });

  const disposition = response.headers.get("content-disposition");
  let filename: string | null = null;
  if (disposition) {
    const parts = disposition.split("filename=");
    if (parts[1]) {
      filename = parts[1].trim().replace(/^["']|["']$/g, "") || null;
    }
  }

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message.trim() || `${response.status} ${response.statusText}`);
  }

  const blob = await response.blob();
  return { blob, filename };
}

