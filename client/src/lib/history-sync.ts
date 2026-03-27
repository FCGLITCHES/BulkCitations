import type { UserHistoryItem } from "@shared/schema";

const HISTORY_KEY = "bulkcitations_history";
const HISTORY_PENDING_KEY = "bulkcitations_history_pending_snapshot";
const HISTORY_CLIENT_ID_KEY = "bulkcitations_history_client_id";

let onlineListenerAttached = false;

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readJson<T>(key: string, fallback: T): T {
  if (!canUseStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function removeKey(key: string) {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(key);
}

function createClientId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export function getHistoryClientId() {
  if (!canUseStorage()) return "server";
  const existing = window.localStorage.getItem(HISTORY_CLIENT_ID_KEY);
  if (existing && /^[A-Za-z0-9_-]{8,80}$/.test(existing)) {
    return existing;
  }
  const next = createClientId();
  window.localStorage.setItem(HISTORY_CLIENT_ID_KEY, next);
  return next;
}

export function readLocalHistory(): UserHistoryItem[] {
  return readJson<UserHistoryItem[]>(HISTORY_KEY, []);
}

function writeLocalHistory(items: UserHistoryItem[]) {
  writeJson(HISTORY_KEY, items);
}

function readPendingSnapshot(): UserHistoryItem[] | null {
  return readJson<UserHistoryItem[] | null>(HISTORY_PENDING_KEY, null);
}

function writePendingSnapshot(items: UserHistoryItem[]) {
  writeJson(HISTORY_PENDING_KEY, items);
}

function mergeHistory(localItems: UserHistoryItem[], cloudItems: UserHistoryItem[]) {
  const merged = new Map<string, UserHistoryItem>();
  for (const item of cloudItems) merged.set(item.id, item);
  for (const item of localItems) merged.set(item.id, item);
  return Array.from(merged.values())
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .slice(0, 5000);
}

async function pushSnapshot(items: UserHistoryItem[]) {
  const response = await fetch("/api/history", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      clientId: getHistoryClientId(),
      items,
    }),
  });

  if (!response.ok) {
    throw new Error("Cloud history save failed.");
  }

  const data = await response.json() as { items?: UserHistoryItem[] };
  return Array.isArray(data.items) ? data.items : items;
}

export async function syncPendingHistory() {
  const pending = readPendingSnapshot();
  if (!pending || (typeof navigator !== "undefined" && navigator.onLine === false)) {
    return pending ?? null;
  }

  try {
    const saved = await pushSnapshot(pending);
    writeLocalHistory(saved);
    removeKey(HISTORY_PENDING_KEY);
    return saved;
  } catch {
    return pending;
  }
}

export function ensureHistorySync() {
  if (onlineListenerAttached || typeof window === "undefined") return;
  onlineListenerAttached = true;
  window.addEventListener("online", () => {
    void syncPendingHistory();
  });
}

export async function loadHistorySnapshot() {
  ensureHistorySync();

  const local = readLocalHistory();
  const pending = readPendingSnapshot();
  if (pending) {
    writeLocalHistory(pending);
    void syncPendingHistory();
    return pending;
  }

  try {
    const response = await fetch(`/api/history?clientId=${encodeURIComponent(getHistoryClientId())}`, {
      credentials: "include",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Cloud history load failed.");
    }

    const data = await response.json() as { items?: UserHistoryItem[] };
    const cloud = Array.isArray(data.items) ? data.items : [];
    const merged = mergeHistory(local, cloud);
    writeLocalHistory(merged);

    if (merged.length !== cloud.length || JSON.stringify(merged) !== JSON.stringify(cloud)) {
      void saveHistorySnapshot(merged);
    }

    return merged;
  } catch {
    return local;
  }
}

export async function saveHistorySnapshot(items: UserHistoryItem[]) {
  ensureHistorySync();
  writeLocalHistory(items);

  try {
    const saved = await pushSnapshot(items);
    writeLocalHistory(saved);
    removeKey(HISTORY_PENDING_KEY);
    return { items: saved, savedToCloud: true };
  } catch {
    writePendingSnapshot(items);
    return { items, savedToCloud: false };
  }
}

export async function appendHistoryItems(items: UserHistoryItem[]) {
  const current = await loadHistorySnapshot();
  const next = mergeHistory(items, current);
  return saveHistorySnapshot(next);
}
