import type { UserHistoryItem } from "@shared/schema";
import {
  getExternalAuthToken,
  getPublicSessionProbeReadiness,
} from "@/oauth/runtime";
import { workosEnabled } from "@/oauth/config";
import { resolveApiUrl } from "@/lib/api-url";
import {
  readHistoryIndexedDbSnapshot,
  removeHistoryIndexedDbSnapshot,
  writeHistoryIndexedDbSnapshot,
} from "@/lib/history-indexed-db";
import { USER_AUTH_SESSION_EVENT } from "@/lib/userAuthEvents";

const HISTORY_KEY = "bulkcitations_history";
const HISTORY_PENDING_KEY = "bulkcitations_history_pending_snapshot";
const HISTORY_CLIENT_ID_KEY = "bulkcitations_history_client_id";

const API_HISTORY = "/v1/history";
const PENDING_SYNC_RETRY_MS = 15_000;
const MAX_PENDING_SYNC_RETRY_MS = 120_000;
const AUTH_FETCH_TIMEOUT_MS = 15_000;
const WORKOS_CONFIGURED = workosEnabled;
const MAX_HISTORY_SNAPSHOT_ITEMS = 5_000;
const MAX_STORED_HISTORY_ITEMS = 200;
const MAX_HISTORY_STORAGE_CHARS = 1_250_000;
const HISTORY_STORAGE_STRATEGIES = [
  { maxItems: MAX_STORED_HISTORY_ITEMS, textLimit: 3_000 },
  { maxItems: 150, textLimit: 2_000 },
  { maxItems: 100, textLimit: 1_200 },
  { maxItems: 50, textLimit: 800 },
  { maxItems: 20, textLimit: 400 },
  { maxItems: 5, textLimit: 250 },
] as const;

let onlineListenerAttached = false;
let authListenerAttached = false;
let focusListenerAttached = false;
let pendingSyncTimer: number | null = null;
let pendingSyncInFlight = false;
let historyBackendReachable = true;
let pendingSyncRetryDelayMs = PENDING_SYNC_RETRY_MS;
let pendingSnapshotMemoryCache: UserHistoryItem[] | null = null;
let historyFallbackHydrationPromise: Promise<void> | null = null;
let historyFallbackStateVersion = 0;
type HistorySyncStatus = "synced" | "syncing" | "offline";

interface HistorySyncState {
  status: HistorySyncStatus;
}

let historySyncState: HistorySyncState = { status: "synced" };
const historySyncListeners = new Set<() => void>();
const historySnapshotListeners = new Set<() => void>();
let historySnapshotCache: UserHistoryItem[] = [];

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function emitHistorySyncState() {
  for (const listener of historySyncListeners) {
    listener();
  }
}

function setHistorySyncState(status: HistorySyncStatus) {
  if (historySyncState.status === status) {
    return;
  }
  historySyncState = { status };
  emitHistorySyncState();
}

function resolveCurrentHistorySyncStatus(): HistorySyncStatus {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "offline";
  }
  if (!historyBackendReachable) {
    return "offline";
  }
  if (pendingSyncInFlight || readPendingSnapshot()) {
    return "syncing";
  }
  return "synced";
}

function refreshHistorySyncState() {
  setHistorySyncState(resolveCurrentHistorySyncStatus());
}

export function subscribeHistorySyncState(listener: () => void) {
  historySyncListeners.add(listener);
  return () => {
    historySyncListeners.delete(listener);
  };
}

function emitHistorySnapshot() {
  for (const listener of historySnapshotListeners) {
    listener();
  }
}

export function subscribeHistorySnapshot(listener: () => void) {
  historySnapshotListeners.add(listener);
  return () => {
    historySnapshotListeners.delete(listener);
  };
}

export function getHistorySnapshotStoreSnapshot() {
  return historySnapshotCache;
}

export function getHistorySyncStateSnapshot(): HistorySyncState {
  refreshHistorySyncState();
  return historySyncState;
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
  if (!canUseStorage()) return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
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
  try {
    window.localStorage.setItem(HISTORY_CLIENT_ID_KEY, next);
  } catch {
    return next;
  }
  return next;
}

function compactHistoryText(value: string, maxLength: number) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function sortHistoryItems(items: UserHistoryItem[]) {
  return [...items].sort(
    (left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime(),
  );
}

function normalizeHistoryItems(items: UserHistoryItem[]) {
  return sortHistoryItems(items).slice(0, MAX_HISTORY_SNAPSHOT_ITEMS);
}

function compactHistoryItems(
  items: UserHistoryItem[],
  strategy: (typeof HISTORY_STORAGE_STRATEGIES)[number],
) {
  return sortHistoryItems(items)
    .slice(0, strategy.maxItems)
    .map((item) => ({
      ...item,
      originalText: compactHistoryText(item.originalText, strategy.textLimit),
      convertedText: compactHistoryText(item.convertedText, strategy.textLimit),
      inputStyle: item.inputStyle.trim().slice(0, 80),
      outputStyle: item.outputStyle.trim().slice(0, 80),
      healthState: item.healthState?.trim().slice(0, 40),
      timestamp: item.timestamp.trim().slice(0, 80),
      customName: item.customName?.trim().slice(0, 160),
    }));
}

function estimateHistoryStorageChars(items: UserHistoryItem[]) {
  try {
    return JSON.stringify(items).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function fitHistoryItemsForStorage(items: UserHistoryItem[]) {
  for (const strategy of HISTORY_STORAGE_STRATEGIES) {
    const candidate = compactHistoryItems(items, strategy);
    if (estimateHistoryStorageChars(candidate) <= MAX_HISTORY_STORAGE_CHARS) {
      return candidate;
    }
  }

  return compactHistoryItems(items, HISTORY_STORAGE_STRATEGIES[HISTORY_STORAGE_STRATEGIES.length - 1]);
}

async function hydrateHistoryFallbackCache() {
  if (historyFallbackHydrationPromise) {
    await historyFallbackHydrationPromise;
    return;
  }

  historyFallbackHydrationPromise = (async () => {
    const stateVersion = historyFallbackStateVersion;
    const hasLocalHistory = readJson<UserHistoryItem[] | null>(HISTORY_KEY, null);
    const hasLocalPending = readJson<UserHistoryItem[] | null>(HISTORY_PENDING_KEY, null);
    const [fallbackHistory, fallbackPending] = await Promise.all([
      hasLocalHistory ? Promise.resolve(null) : readHistoryIndexedDbSnapshot(HISTORY_KEY),
      hasLocalPending ? Promise.resolve(null) : readHistoryIndexedDbSnapshot(HISTORY_PENDING_KEY),
    ]);

    if (stateVersion !== historyFallbackStateVersion) {
      return;
    }

    let shouldEmitSnapshot = false;

    if (!hasLocalHistory && fallbackHistory) {
      historySnapshotCache = normalizeHistoryItems(fallbackHistory);
      shouldEmitSnapshot = true;
    }

    if (!hasLocalPending && fallbackPending) {
      pendingSnapshotMemoryCache = normalizeHistoryItems(fallbackPending);
    }

    if (shouldEmitSnapshot) {
      emitHistorySnapshot();
    }
  })();

  try {
    await historyFallbackHydrationPromise;
  } finally {
    historyFallbackHydrationPromise = null;
  }
}

function writeLocalHistory(items: UserHistoryItem[]) {
  historyFallbackStateVersion += 1;
  const normalizedItems = normalizeHistoryItems(items);
  const compactedItems = fitHistoryItemsForStorage(normalizedItems);
  if (!writeJson(HISTORY_KEY, compactedItems)) {
    removeKey(HISTORY_KEY);
    void writeHistoryIndexedDbSnapshot(HISTORY_KEY, normalizedItems);
  } else {
    void removeHistoryIndexedDbSnapshot(HISTORY_KEY);
  }
  historySnapshotCache = normalizedItems;
  emitHistorySnapshot();
}

function readPendingSnapshot(): UserHistoryItem[] | null {
  if (pendingSnapshotMemoryCache) {
    return pendingSnapshotMemoryCache;
  }

  const storedSnapshot = readJson<UserHistoryItem[] | null>(HISTORY_PENDING_KEY, null);
  if (!storedSnapshot) {
    return null;
  }

  const normalizedItems = normalizeHistoryItems(storedSnapshot);
  pendingSnapshotMemoryCache = normalizedItems;
  const compactedItems = fitHistoryItemsForStorage(normalizedItems);
  if (!writeJson(HISTORY_PENDING_KEY, compactedItems)) {
    removeKey(HISTORY_PENDING_KEY);
    void writeHistoryIndexedDbSnapshot(HISTORY_PENDING_KEY, normalizedItems);
  } else {
    void removeHistoryIndexedDbSnapshot(HISTORY_PENDING_KEY);
  }
  return normalizedItems;
}

function writePendingSnapshot(items: UserHistoryItem[]) {
  historyFallbackStateVersion += 1;
  const normalizedItems = normalizeHistoryItems(items);
  const compactedItems = fitHistoryItemsForStorage(normalizedItems);
  pendingSnapshotMemoryCache = normalizedItems;
  if (!writeJson(HISTORY_PENDING_KEY, compactedItems)) {
    removeKey(HISTORY_PENDING_KEY);
    void writeHistoryIndexedDbSnapshot(HISTORY_PENDING_KEY, normalizedItems);
  } else {
    void removeHistoryIndexedDbSnapshot(HISTORY_PENDING_KEY);
  }
}

async function clearPendingSnapshot() {
  historyFallbackStateVersion += 1;
  pendingSnapshotMemoryCache = null;
  removeKey(HISTORY_PENDING_KEY);
  await removeHistoryIndexedDbSnapshot(HISTORY_PENDING_KEY);
}

/** Clears persisted history for signed-out / anonymous sessions (no local retention). */
export async function clearLocalHistoryKeys() {
  historyFallbackStateVersion += 1;
  removeKey(HISTORY_KEY);
  await removeHistoryIndexedDbSnapshot(HISTORY_KEY);
  await clearPendingSnapshot();
  historySnapshotCache = [];
  emitHistorySnapshot();
}

function mergeHistory(incoming: UserHistoryItem[], existing: UserHistoryItem[]) {
  const merged = new Map<string, UserHistoryItem>();
  for (const item of existing) merged.set(item.id, item);
  for (const item of incoming) merged.set(item.id, item);
  return Array.from(merged.values())
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .slice(0, MAX_HISTORY_SNAPSHOT_ITEMS);
}

async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  const token = await getExternalAuthToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = typeof window !== "undefined" && controller
    ? window.setTimeout(() => controller.abort(), AUTH_FETCH_TIMEOUT_MS)
    : null;

  try {
    return await fetch(resolveApiUrl(url), {
      ...init,
      headers,
      credentials: "include",
      cache: "no-store",
      signal: controller?.signal ?? init.signal,
    });
  } finally {
    if (timeoutId != null && typeof window !== "undefined") {
      window.clearTimeout(timeoutId);
    }
  }
}

type SessionAuthStatus = "authenticated" | "unauthenticated" | "unknown";

function clearPendingSyncTimer() {
  if (pendingSyncTimer) {
    clearTimeout(pendingSyncTimer);
    pendingSyncTimer = null;
  }
  refreshHistorySyncState();
}

function resetPendingSyncRetryDelay() {
  pendingSyncRetryDelayMs = PENDING_SYNC_RETRY_MS;
}

function registerPendingSyncFailure() {
  pendingSyncRetryDelayMs = Math.min(
    pendingSyncRetryDelayMs * 2,
    MAX_PENDING_SYNC_RETRY_MS,
  );
}

function schedulePendingHistoryRetry(delayMs = PENDING_SYNC_RETRY_MS) {
  if (typeof window === "undefined") {
    return;
  }
  if (!readPendingSnapshot()) {
    clearPendingSyncTimer();
    return;
  }
  if (pendingSyncTimer) {
    return;
  }
  const nextDelayMs = Math.max(delayMs, pendingSyncRetryDelayMs);
  pendingSyncTimer = window.setTimeout(() => {
    pendingSyncTimer = null;
    void retryPendingHistorySync();
  }, nextDelayMs);
  refreshHistorySyncState();
}

async function getSessionAuthStatus(): Promise<SessionAuthStatus> {
  if (!getPublicSessionProbeReadiness(WORKOS_CONFIGURED).ready) {
    return "unknown";
  }

  try {
    const response = await authFetch("/v1/auth/session");
    if (response.ok) {
      historyBackendReachable = true;
      const data = (await response.json()) as { authenticated?: boolean };
      if (data.authenticated) {
        return "authenticated";
      }
      return "unauthenticated";
    }
    if (response.status === 401) {
      historyBackendReachable = true;
      return "unauthenticated";
    }
  } catch {
    // Fall through to the history endpoint below.
    historyBackendReachable = false;
  }

  try {
    const response = await authFetch(
      `${API_HISTORY}?clientId=${encodeURIComponent(getHistoryClientId())}`,
    );
    if (response.status === 401) {
      historyBackendReachable = true;
      return "unauthenticated";
    }
    if (response.ok) {
      historyBackendReachable = true;
      return "authenticated";
    }
    historyBackendReachable = false;
    return "unknown";
  } catch {
    historyBackendReachable = false;
    return "unknown";
  }
}

async function fetchHistorySnapshot() {
  const response = await authFetch(
    `${API_HISTORY}?clientId=${encodeURIComponent(getHistoryClientId())}`,
  );

  if (response.status === 401) {
    historyBackendReachable = true;
    await clearLocalHistoryKeys();
    throw new Error("Unauthorized");
  }

  if (!response.ok) {
    historyBackendReachable = false;
    throw new Error("Cloud history load failed.");
  }

  historyBackendReachable = true;
  const data = (await response.json()) as { items?: UserHistoryItem[] };
  return Array.isArray(data.items) ? data.items : [];
}

async function handleAuthSessionEvent() {
  await hydrateHistoryFallbackCache();
  const status = await getSessionAuthStatus();
  if (status === "unauthenticated") {
    await clearLocalHistoryKeys();
    clearPendingSyncTimer();
    refreshHistorySyncState();
    return;
  }
  if (status === "authenticated" && readPendingSnapshot()) {
    schedulePendingHistoryRetry(0);
    return;
  }
  refreshHistorySyncState();
}

export async function syncPendingHistory() {
  await hydrateHistoryFallbackCache();
  const pending = readPendingSnapshot();
  if (!pending) {
    clearPendingSyncTimer();
    refreshHistorySyncState();
    return null;
  }
  const authStatus = await getSessionAuthStatus();
  if (authStatus === "unauthenticated") {
    await clearPendingSnapshot();
    clearPendingSyncTimer();
    refreshHistorySyncState();
    return null;
  }
  if (authStatus !== "authenticated") {
    schedulePendingHistoryRetry();
    refreshHistorySyncState();
    return null;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    schedulePendingHistoryRetry();
    refreshHistorySyncState();
    return pending;
  }

  try {
    setHistorySyncState("syncing");
    const saved = await pushSnapshot(pending);
    writeLocalHistory(saved);
    await clearPendingSnapshot();
    resetPendingSyncRetryDelay();
    clearPendingSyncTimer();
    refreshHistorySyncState();
    return saved;
  } catch {
    registerPendingSyncFailure();
    schedulePendingHistoryRetry();
    refreshHistorySyncState();
    return pending;
  }
}

async function retryPendingHistorySync() {
  if (pendingSyncInFlight) {
    return;
  }
  pendingSyncInFlight = true;
  refreshHistorySyncState();
  try {
    await syncPendingHistory();
  } finally {
    pendingSyncInFlight = false;
    refreshHistorySyncState();
  }
}

async function pushSnapshot(items: UserHistoryItem[]) {
  const response = await authFetch(API_HISTORY, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: getHistoryClientId(),
      items,
    }),
  });

  if (response.status === 401) {
    historyBackendReachable = true;
    await clearLocalHistoryKeys();
    throw new Error("Unauthorized");
  }

  if (!response.ok) {
    historyBackendReachable = false;
    throw new Error("Cloud history save failed.");
  }

  historyBackendReachable = true;
  const data = (await response.json()) as { items?: UserHistoryItem[] };
  return Array.isArray(data.items) ? data.items : items;
}

export function ensureHistorySync() {
  if (typeof window === "undefined") return;
  void hydrateHistoryFallbackCache().finally(() => {
    if (readPendingSnapshot()) {
      schedulePendingHistoryRetry(0);
    }
    refreshHistorySyncState();
  });
  if (!onlineListenerAttached) {
    onlineListenerAttached = true;
    window.addEventListener("online", () => {
      historyBackendReachable = true;
      schedulePendingHistoryRetry(0);
      refreshHistorySyncState();
    });
    window.addEventListener("offline", () => {
      refreshHistorySyncState();
    });
  }
  if (!authListenerAttached) {
    authListenerAttached = true;
    window.addEventListener(USER_AUTH_SESSION_EVENT, () => {
      void handleAuthSessionEvent();
    });
  }
  if (!focusListenerAttached) {
    focusListenerAttached = true;
    window.addEventListener("focus", () => {
      schedulePendingHistoryRetry(0);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        schedulePendingHistoryRetry(0);
      }
    });
  }
  if (readPendingSnapshot()) {
    schedulePendingHistoryRetry(0);
  }
  refreshHistorySyncState();
}

/**
 * Loads conversion history for the current session.
 * Signed-in users: data comes from the server (local cache is a mirror for offline retry).
 * Anonymous users: always empty; any prior local-only history is cleared.
 */
export async function loadHistorySnapshot(): Promise<UserHistoryItem[]> {
  ensureHistorySync();
  await hydrateHistoryFallbackCache();

  const pending = readPendingSnapshot();
  if (pending) {
    writeLocalHistory(pending);
    void syncPendingHistory();
    refreshHistorySyncState();
    return historySnapshotCache;
  }

  try {
    setHistorySyncState("syncing");
    const cloud = await fetchHistorySnapshot();
    writeLocalHistory(cloud);
    refreshHistorySyncState();
    return historySnapshotCache;
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      refreshHistorySyncState();
      return [];
    }
    const cached =
      historySnapshotCache.length > 0
        ? historySnapshotCache
        : normalizeHistoryItems(readJson<UserHistoryItem[]>(HISTORY_KEY, []));
    historySnapshotCache = cached;
    refreshHistorySyncState();
    return cached;
  }
}

export async function saveHistorySnapshot(items: UserHistoryItem[]) {
  ensureHistorySync();
  const normalizedItems = normalizeHistoryItems(items);

  writeLocalHistory(normalizedItems);

  try {
    setHistorySyncState("syncing");
    const saved = await pushSnapshot(normalizedItems);
    writeLocalHistory(saved);
    await clearPendingSnapshot();
    clearPendingSyncTimer();
    refreshHistorySyncState();
    return { items: historySnapshotCache, savedToCloud: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "Unauthorized") {
      clearPendingSyncTimer();
      refreshHistorySyncState();
      return { items: [] as UserHistoryItem[], savedToCloud: false };
    }
    writePendingSnapshot(normalizedItems);
    schedulePendingHistoryRetry();
    refreshHistorySyncState();
    return { items: readPendingSnapshot() ?? historySnapshotCache, savedToCloud: false };
  }
}

export async function appendHistoryItems(items: UserHistoryItem[]) {
  const current = await loadHistorySnapshot();
  const next = mergeHistory(items, current);
  return saveHistorySnapshot(next);
}

historySnapshotCache = normalizeHistoryItems(readJson<UserHistoryItem[]>(HISTORY_KEY, []));
