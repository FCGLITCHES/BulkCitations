const explicitApiBaseUrl = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);

export function getConfiguredApiBaseUrl(): string {
  return explicitApiBaseUrl;
}

export function resolveApiUrl(path: string): string {
  if (isAbsoluteUrl(path)) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return explicitApiBaseUrl ? `${explicitApiBaseUrl}${normalizedPath}` : normalizedPath;
}

function normalizeBaseUrl(value: string | undefined): string {
  return value?.trim().replace(/\/+$/, "") ?? "";
}

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}
