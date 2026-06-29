import { getEngineApiTargetInfo } from "./engine-api-base";

type EngineApiErrorKind = "network" | "http";

interface EngineApiErrorOptions {
  kind: EngineApiErrorKind;
  message: string;
  url: string;
  status?: number;
  code?: string;
  debugMessage?: string;
}

interface ErrorPayload {
  error?: string;
  message?: string;
  stack?: string;
}

export class EngineApiRequestError extends Error {
  readonly kind: EngineApiErrorKind;
  readonly url: string;
  readonly status?: number;
  readonly code?: string;
  readonly debugMessage?: string;

  constructor(options: EngineApiErrorOptions) {
    super(options.message);
    this.name = "EngineApiRequestError";
    this.kind = options.kind;
    this.url = options.url;
    this.status = options.status;
    this.code = options.code;
    this.debugMessage = options.debugMessage;
  }
}

export async function buildEngineApiHttpError(response: Response, url: string): Promise<EngineApiRequestError> {
  const payload = await readErrorPayload(response);
  const statusLabel = payload.message?.trim() || response.statusText || "Request failed";
  const debugMessage = extractDebugMessage(payload);

  return new EngineApiRequestError({
    kind: "http",
    message: statusLabel,
    url,
    status: response.status,
    code: payload.error,
    debugMessage,
  });
}

export function buildEngineApiNetworkError(url: string, error: unknown): EngineApiRequestError {
  const message = error instanceof Error ? error.message : "Network request failed";
  return new EngineApiRequestError({
    kind: "network",
    message,
    url,
  });
}

export function formatEngineApiError(error: unknown): string {
  const target = getEngineApiTargetInfo();

  if (!(error instanceof EngineApiRequestError)) {
    return error instanceof Error ? error.message : "Conversion failed";
  }

  if (error.kind === "network") {
    return [
      "The engine UI could not connect to the API.",
      "",
      `Current API target: ${target.displayLabel}`,
      `Health check: ${target.healthUrl}`,
      "",
      "If you’re running locally:",
      "- Start the API with `pnpm dev:server`, or use `pnpm dev` for the frontend + API pair.",
      "- If you changed ports, update `VITE_API_PROXY_TARGET` for dev or `VITE_API_BASE_URL` for a separate deployed API.",
    ].join("\n");
  }

  if (error.status === 429 || /quota|rate limit|too many requests/i.test(error.message)) {
    return [
      error.message || "Request limit reached.",
      "",
      "Sign in to continue with your account quota, or try again after the anonymous limit resets.",
    ].join("\n");
  }

  if (error.status && error.status >= 500) {
    const detail = import.meta.env.DEV && error.debugMessage
      ? `Cause: ${error.debugMessage}`
      : `Message: ${error.message}`;

    return [
      `The engine API returned ${error.status}${error.code ? ` (${error.code})` : ""}.`,
      detail,
      "",
      `Health check: ${target.healthUrl}`,
      "Check the server terminal for the failing route and dependency.",
    ].join("\n");
  }

  return error.message;
}

async function readErrorPayload(response: Response): Promise<ErrorPayload> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return await response.json().catch(() => ({})) as ErrorPayload;
  }

  const text = await response.text().catch(() => "");
  return {
    message: text || response.statusText,
  };
}

function extractDebugMessage(payload: ErrorPayload): string | undefined {
  if (!payload.stack) return undefined;

  const [firstLine] = payload.stack.split("\n");
  return firstLine.replace(/^Error:\s*/, "").trim() || undefined;
}
