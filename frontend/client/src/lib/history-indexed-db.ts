import type { UserHistoryItem } from "@shared/schema";

export type HistoryIndexedDbKey =
  | "bulkcitations_history"
  | "bulkcitations_history_pending_snapshot";

const HISTORY_INDEXED_DB_NAME = "bulkreferences-history";
const HISTORY_INDEXED_DB_STORE = "snapshots";
const HISTORY_INDEXED_DB_VERSION = 1;

interface PersistedHistorySnapshot {
  key: HistoryIndexedDbKey;
  items: UserHistoryItem[];
}

let historyIndexedDbPromise: Promise<IDBDatabase | null> | null = null;
const historyIndexedDbWriteQueue = new Map<HistoryIndexedDbKey, Promise<unknown>>();

function canUseHistoryIndexedDb() {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function queueHistoryIndexedDbOperation<T>(
  key: HistoryIndexedDbKey,
  operation: () => Promise<T>,
) {
  const previous = historyIndexedDbWriteQueue.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  historyIndexedDbWriteQueue.set(key, next);
  void next.finally(() => {
    if (historyIndexedDbWriteQueue.get(key) === next) {
      historyIndexedDbWriteQueue.delete(key);
    }
  });
  return next;
}

async function waitForHistoryIndexedDbQueue(key: HistoryIndexedDbKey) {
  const pendingOperation = historyIndexedDbWriteQueue.get(key);
  if (!pendingOperation) {
    return;
  }
  await pendingOperation.catch(() => undefined);
}

function openHistoryIndexedDb(): Promise<IDBDatabase | null> {
  if (!canUseHistoryIndexedDb()) {
    return Promise.resolve(null);
  }
  if (historyIndexedDbPromise) {
    return historyIndexedDbPromise;
  }

  historyIndexedDbPromise = new Promise((resolve) => {
    const request = window.indexedDB.open(HISTORY_INDEXED_DB_NAME, HISTORY_INDEXED_DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(HISTORY_INDEXED_DB_STORE)) {
        database.createObjectStore(HISTORY_INDEXED_DB_STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        historyIndexedDbPromise = null;
      };
      resolve(database);
    };

    request.onerror = () => {
      historyIndexedDbPromise = Promise.resolve(null);
      resolve(null);
    };

    request.onblocked = () => {
      historyIndexedDbPromise = Promise.resolve(null);
      resolve(null);
    };
  });

  return historyIndexedDbPromise;
}

export async function readHistoryIndexedDbSnapshot(key: HistoryIndexedDbKey) {
  await waitForHistoryIndexedDbQueue(key);
  const database = await openHistoryIndexedDb();
  if (!database) {
    return null;
  }

  return await new Promise<UserHistoryItem[] | null>((resolve) => {
    const transaction = database.transaction(HISTORY_INDEXED_DB_STORE, "readonly");
    const store = transaction.objectStore(HISTORY_INDEXED_DB_STORE);
    const request = store.get(key);

    request.onsuccess = () => {
      const result = request.result as PersistedHistorySnapshot | undefined;
      resolve(Array.isArray(result?.items) ? result.items : null);
    };

    request.onerror = () => {
      resolve(null);
    };

    transaction.onabort = () => {
      resolve(null);
    };
  });
}

export async function writeHistoryIndexedDbSnapshot(
  key: HistoryIndexedDbKey,
  items: UserHistoryItem[],
) {
  return await queueHistoryIndexedDbOperation(key, async () => {
    const database = await openHistoryIndexedDb();
    if (!database) {
      return false;
    }

    return await new Promise<boolean>((resolve) => {
      const transaction = database.transaction(HISTORY_INDEXED_DB_STORE, "readwrite");
      const store = transaction.objectStore(HISTORY_INDEXED_DB_STORE);
      store.put({ key, items } satisfies PersistedHistorySnapshot);

      transaction.oncomplete = () => {
        resolve(true);
      };

      transaction.onerror = () => {
        resolve(false);
      };

      transaction.onabort = () => {
        resolve(false);
      };
    });
  });
}

export async function removeHistoryIndexedDbSnapshot(key: HistoryIndexedDbKey) {
  await queueHistoryIndexedDbOperation(key, async () => {
    const database = await openHistoryIndexedDb();
    if (!database) {
      return;
    }

    await new Promise<void>((resolve) => {
      const transaction = database.transaction(HISTORY_INDEXED_DB_STORE, "readwrite");
      const store = transaction.objectStore(HISTORY_INDEXED_DB_STORE);
      store.delete(key);

      transaction.oncomplete = () => {
        resolve();
      };

      transaction.onerror = () => {
        resolve();
      };

      transaction.onabort = () => {
        resolve();
      };
    });
  });
}
