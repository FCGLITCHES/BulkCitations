export async function adminFetch<T>(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers ?? {});
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
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

    throw new Error(message || "Admin request failed.");
  }

  return payload as T;
}
export async function updateCitation<T>(jobId: string, index: number, data: any) {
  return adminFetch<T>(`/api/v2/jobs/${jobId}/citations/${index}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}
