import { getConfiguredApiBaseUrl, resolveApiUrl } from "./api-url";

const explicitEngineApiBaseUrl = getConfiguredApiBaseUrl();
export const ENGINE_API_PREFIX = "/api/engine";

export interface EngineApiTargetInfo {
  mode: "explicit-base-url" | "dev-proxy" | "same-origin";
  baseUrl: string;
  displayLabel: string;
  healthUrl: string;
}

export function resolveEngineApiUrl(path: string): string {
  return resolveApiUrl(path);
}

export function getEngineApiTargetInfo(): EngineApiTargetInfo {
  if (explicitEngineApiBaseUrl) {
    return {
      mode: "explicit-base-url",
      baseUrl: explicitEngineApiBaseUrl,
      displayLabel: explicitEngineApiBaseUrl,
      healthUrl: `${explicitEngineApiBaseUrl}${ENGINE_API_PREFIX}/health`,
    };
  }

  if (import.meta.env.DEV) {
    return {
      mode: "dev-proxy",
      baseUrl: window.location.origin,
      displayLabel: `the Vite dev proxy for \`${ENGINE_API_PREFIX}/*\``,
      healthUrl: `${ENGINE_API_PREFIX}/health`,
    };
  }

  return {
    mode: "same-origin",
    baseUrl: window.location.origin,
    displayLabel: window.location.origin,
    healthUrl: `${window.location.origin}${ENGINE_API_PREFIX}/health`,
  };
}
