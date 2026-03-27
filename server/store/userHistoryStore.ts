import fs from "node:fs";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { UserHistoryItem } from "@shared/schema";
import {
  readJsonlFile,
  resolveDataFile,
  writeJsonlFile,
} from "./persistence.js";
import { createPostgresPoolConfig, getUsableDatabaseUrl } from "./databaseUrl.js";

type UserHistoryRecord = {
  ownerKey: string;
  items: UserHistoryItem[];
  updatedAt: string;
};

interface IUserHistoryStore {
  loadHistory(ownerKey: string): Promise<UserHistoryItem[]>;
  saveHistory(ownerKey: string, items: UserHistoryItem[]): Promise<UserHistoryItem[]>;
}

const HISTORY_FILE = resolveDataFile("user-history.v1.jsonl");

const userHistoryRows = pgTable("user_history_snapshots", {
  ownerKey: text("owner_key").primaryKey(),
  payload: jsonb("payload").$type<UserHistoryItem[]>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

function cloneItems(items: UserHistoryItem[]) {
  return items.map((item) => ({ ...item }));
}

class FileUserHistoryStore implements IUserHistoryStore {
  private cached: UserHistoryRecord[] | null = null;

  private readAll(): UserHistoryRecord[] {
    if (this.cached) {
      return this.cached.map((record) => ({
        ownerKey: record.ownerKey,
        updatedAt: record.updatedAt,
        items: cloneItems(record.items),
      }));
    }

    const rows = readJsonlFile<UserHistoryRecord>(HISTORY_FILE).map((record) => ({
      ownerKey: record.ownerKey,
      updatedAt: record.updatedAt,
      items: Array.isArray(record.items) ? cloneItems(record.items) : [],
    }));
    this.cached = rows;
    return rows.map((record) => ({
      ownerKey: record.ownerKey,
      updatedAt: record.updatedAt,
      items: cloneItems(record.items),
    }));
  }

  private writeAll(rows: UserHistoryRecord[]) {
    this.cached = rows.map((record) => ({
      ownerKey: record.ownerKey,
      updatedAt: record.updatedAt,
      items: cloneItems(record.items),
    }));
    writeJsonlFile(HISTORY_FILE, rows);
  }

  async loadHistory(ownerKey: string): Promise<UserHistoryItem[]> {
    const record = this.readAll().find((entry) => entry.ownerKey === ownerKey);
    return record ? cloneItems(record.items) : [];
  }

  async saveHistory(ownerKey: string, items: UserHistoryItem[]): Promise<UserHistoryItem[]> {
    const rows = this.readAll();
    const next: UserHistoryRecord = {
      ownerKey,
      updatedAt: new Date().toISOString(),
      items: cloneItems(items),
    };
    const index = rows.findIndex((entry) => entry.ownerKey === ownerKey);
    if (index >= 0) {
      rows[index] = next;
    } else {
      rows.push(next);
    }
    this.writeAll(rows);
    return cloneItems(next.items);
  }
}

class PostgresUserHistoryStore implements IUserHistoryStore {
  private db;
  private ready: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.db = drizzle({ connection: createPostgresPoolConfig(connectionString) });
  }

  private async ensureReady() {
    if (!this.ready) {
      this.ready = this.db.execute(sql`
        create table if not exists user_history_snapshots (
          owner_key text primary key,
          payload jsonb not null,
          updated_at timestamptz not null
        )
      `).then(() => undefined);
    }
    await this.ready;
  }

  async loadHistory(ownerKey: string): Promise<UserHistoryItem[]> {
    await this.ensureReady();
    const rows = await this.db.select().from(userHistoryRows).where(eq(userHistoryRows.ownerKey, ownerKey)).limit(1);
    return rows[0]?.payload ? cloneItems(rows[0].payload) : [];
  }

  async saveHistory(ownerKey: string, items: UserHistoryItem[]): Promise<UserHistoryItem[]> {
    await this.ensureReady();
    const nextItems = cloneItems(items);
    await this.db.insert(userHistoryRows).values({
      ownerKey,
      payload: nextItems,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: userHistoryRows.ownerKey,
      set: {
        payload: nextItems,
        updatedAt: new Date(),
      },
    });
    return nextItems;
  }
}

class ResilientUserHistoryStore implements IUserHistoryStore {
  private primary: IUserHistoryStore;
  private fallback: IUserHistoryStore;
  private warned = false;

  constructor(primary: IUserHistoryStore, fallback: IUserHistoryStore) {
    this.primary = primary;
    this.fallback = fallback;
  }

  private async runWithFallback<T>(operation: (store: IUserHistoryStore) => Promise<T>) {
    try {
      return await operation(this.primary);
    } catch (error) {
      if (!this.warned) {
        this.warned = true;
        console.warn("[userHistoryStore] Falling back to file storage:", error instanceof Error ? error.message : String(error));
      }
      return operation(this.fallback);
    }
  }

  async loadHistory(ownerKey: string): Promise<UserHistoryItem[]> {
    return this.runWithFallback((store) => store.loadHistory(ownerKey));
  }

  async saveHistory(ownerKey: string, items: UserHistoryItem[]): Promise<UserHistoryItem[]> {
    return this.runWithFallback((store) => store.saveHistory(ownerKey, items));
  }
}

const fileStore = new FileUserHistoryStore();
const databaseUrl = getUsableDatabaseUrl();
const userHistoryStore: IUserHistoryStore = databaseUrl
  ? new ResilientUserHistoryStore(new PostgresUserHistoryStore(databaseUrl), fileStore)
  : fileStore;

export function loadUserHistory(ownerKey: string) {
  return userHistoryStore.loadHistory(ownerKey);
}

export function saveUserHistory(ownerKey: string, items: UserHistoryItem[]) {
  return userHistoryStore.saveHistory(ownerKey, items);
}
