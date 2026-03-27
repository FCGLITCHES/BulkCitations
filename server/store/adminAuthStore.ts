import { randomBytes, scryptSync, timingSafeEqual, createHmac, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createPostgresPoolConfig, getUsableDatabaseUrl } from "./databaseUrl.js";
import { resolveDataFile } from "./persistence.js";

export type AdminAccountStatus = "pending" | "approved";

export type AdminAccountRecord = {
  id: string;
  name: string;
  username: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  status: AdminAccountStatus;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type AdminAuthState = {
  accounts: AdminAccountRecord[];
};

type CreateAdminAccessRequestResult =
  | {
    ok: true;
    account: ReturnType<typeof sanitizeRecord>;
    approvalToken: string;
  }
  | {
    ok: false;
    reason: "approved_exists" | "pending_exists";
  };

type ApproveAdminAccessRequestResult =
  | {
    ok: true;
    alreadyApproved: boolean;
    account: ReturnType<typeof sanitizeRecord>;
  }
  | {
    ok: false;
    reason: "invalid_token";
  };

type IAdminAuthStore = {
  getAccountRecordById(id: string): Promise<AdminAccountRecord | null>;
  getApprovedAdminByIdentifier(identifier: string): Promise<AdminAccountRecord | null>;
  findAdminAccountByEmailOrUsername(emailOrUsername: string): Promise<AdminAccountRecord | null>;
  createAdminAccessRequest(input: {
    name: string;
    username: string;
    email: string;
    password: string;
  }): Promise<CreateAdminAccessRequestResult>;
  approveAdminAccessRequest(token: string): Promise<ApproveAdminAccessRequestResult>;
};

const ADMIN_AUTH_FILE = resolveDataFile("admin-auth.json");

const adminAccountRows = pgTable("admin_auth_accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  status: text("status").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

function createEmptyState(): AdminAuthState {
  return { accounts: [] };
}

function readState(): AdminAuthState {
  if (!fs.existsSync(ADMIN_AUTH_FILE)) {
    return createEmptyState();
  }

  try {
    const raw = fs.readFileSync(ADMIN_AUTH_FILE, "utf8");
    if (!raw.trim()) return createEmptyState();
    const parsed = JSON.parse(raw) as Partial<AdminAuthState>;
    return {
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
    };
  } catch (error) {
    console.warn(
      `[admin-auth] Failed to read ${ADMIN_AUTH_FILE}:`,
      error instanceof Error ? error.message : String(error),
    );
    return createEmptyState();
  }
}

function writeState(state: AdminAuthState) {
  fs.mkdirSync(path.dirname(ADMIN_AUTH_FILE), { recursive: true });
  fs.writeFileSync(ADMIN_AUTH_FILE, JSON.stringify(state, null, 2), "utf8");
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString("hex");
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest();
}

function getAdminTokenSecret() {
  return process.env.ADMIN_SESSION_SECRET?.trim() ?? "";
}

function signApprovalPayload(encodedPayload: string) {
  return createHmac("sha256", getAdminTokenSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function buildApprovalToken(accountId: string, createdAt: string) {
  const encodedPayload = Buffer.from(JSON.stringify({
    sub: accountId,
    iat: createdAt,
  })).toString("base64url");

  return `${encodedPayload}.${signApprovalPayload(encodedPayload)}`;
}

function decodeApprovalToken(token: string) {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature || !getAdminTokenSecret()) {
    return null;
  }

  const actualSignatureHash = hashValue(signature);
  const expectedSignatureHash = hashValue(signApprovalPayload(encodedPayload));
  if (actualSignatureHash.length !== expectedSignatureHash.length) {
    return null;
  }

  if (!timingSafeEqual(actualSignatureHash, expectedSignatureHash)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as {
      sub?: string;
      iat?: string;
    };
    if (typeof payload.sub !== "string" || typeof payload.iat !== "string") {
      return null;
    }
    return {
      sub: payload.sub,
      iat: payload.iat,
    };
  } catch {
    return null;
  }
}

function sanitizeRecord(record: AdminAccountRecord) {
  return {
    id: record.id,
    name: record.name,
    username: record.username,
    email: record.email,
    status: record.status,
    approvedAt: record.approvedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function buildAdminAccountRecord(input: {
  id?: string;
  name: string;
  username: string;
  email: string;
  password: string;
  now?: string;
}): AdminAccountRecord {
  const passwordSalt = randomBytes(16).toString("hex");
  const createdAt = input.now ?? new Date().toISOString();

  return {
    id: input.id ?? randomBytes(12).toString("hex"),
    name: input.name.trim(),
    username: normalizeUsername(input.username),
    email: normalizeEmail(input.email),
    passwordHash: hashPassword(input.password, passwordSalt),
    passwordSalt,
    status: "pending",
    approvedAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

export function verifyAdminAccountPassword(record: AdminAccountRecord, password: string) {
  const actual = Buffer.from(hashPassword(password, record.passwordSalt), "hex");
  const expected = Buffer.from(record.passwordHash, "hex");

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}

class FileAdminAuthStore implements IAdminAuthStore {
  private getState(): AdminAuthState {
    const state = readState();
    return {
      accounts: [...state.accounts],
    };
  }

  private setState(state: AdminAuthState) {
    writeState({
      accounts: [...state.accounts],
    });
  }

  async getAccountRecordById(id: string): Promise<AdminAccountRecord | null> {
    const state = this.getState();
    return state.accounts.find((account) => account.id === id) ?? null;
  }

  async getApprovedAdminByIdentifier(identifier: string): Promise<AdminAccountRecord | null> {
    const normalized = identifier.trim().toLowerCase();
    const state = this.getState();
    return state.accounts.find((account) => (
      account.status === "approved"
      && (account.email === normalized || account.username === normalized)
    )) ?? null;
  }

  async findAdminAccountByEmailOrUsername(emailOrUsername: string): Promise<AdminAccountRecord | null> {
    const normalized = emailOrUsername.trim().toLowerCase();
    const state = this.getState();
    return state.accounts.find((account) => (
      account.email === normalized || account.username === normalized
    )) ?? null;
  }

  async createAdminAccessRequest(input: {
    name: string;
    username: string;
    email: string;
    password: string;
  }): Promise<CreateAdminAccessRequestResult> {
    const existing = await this.findAdminAccountByEmailOrUsername(input.email)
      ?? await this.findAdminAccountByEmailOrUsername(input.username);

    if (existing) {
      return {
        ok: false,
        reason: existing.status === "approved" ? "approved_exists" : "pending_exists",
      };
    }

    const record = buildAdminAccountRecord(input);
    const state = this.getState();
    state.accounts.push(record);
    this.setState(state);

    return {
      ok: true,
      account: sanitizeRecord(record),
      approvalToken: buildApprovalToken(record.id, record.createdAt),
    };
  }

  async approveAdminAccessRequest(token: string): Promise<ApproveAdminAccessRequestResult> {
    const payload = decodeApprovalToken(token);
    if (!payload) {
      return { ok: false, reason: "invalid_token" };
    }

    const state = this.getState();
    const account = state.accounts.find((entry) => entry.id === payload.sub);

    if (!account || account.createdAt !== payload.iat) {
      return { ok: false, reason: "invalid_token" };
    }

    if (account.status === "approved") {
      return {
        ok: true,
        alreadyApproved: true,
        account: sanitizeRecord(account),
      };
    }

    const now = new Date().toISOString();
    account.status = "approved";
    account.approvedAt = now;
    account.updatedAt = now;
    this.setState(state);

    return {
      ok: true,
      alreadyApproved: false,
      account: sanitizeRecord(account),
    };
  }
}

class PostgresAdminAuthStore implements IAdminAuthStore {
  private db;
  private ready: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.db = drizzle({ connection: createPostgresPoolConfig(connectionString) });
  }

  private async ensureReady() {
    if (!this.ready) {
      this.ready = this.db.execute(sql`
        create table if not exists admin_auth_accounts (
          id text primary key,
          name text not null,
          username text not null unique,
          email text not null unique,
          password_hash text not null,
          password_salt text not null,
          status text not null,
          approved_at timestamptz,
          created_at timestamptz not null,
          updated_at timestamptz not null
        )
      `).then(() => undefined);
    }

    await this.ready;
  }

  private mapAccount(row: typeof adminAccountRows.$inferSelect): AdminAccountRecord {
    return {
      id: row.id,
      name: row.name,
      username: row.username,
      email: row.email,
      passwordHash: row.passwordHash,
      passwordSalt: row.passwordSalt,
      status: row.status as AdminAccountStatus,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async getAccountRecordById(id: string): Promise<AdminAccountRecord | null> {
    await this.ensureReady();
    const rows = await this.db.select().from(adminAccountRows).where(eq(adminAccountRows.id, id)).limit(1);
    return rows[0] ? this.mapAccount(rows[0]) : null;
  }

  async getApprovedAdminByIdentifier(identifier: string): Promise<AdminAccountRecord | null> {
    await this.ensureReady();
    const normalized = identifier.trim().toLowerCase();
    const rows = await this.db.select().from(adminAccountRows).where(
      sql`${adminAccountRows.status} = 'approved' and (${adminAccountRows.email} = ${normalized} or ${adminAccountRows.username} = ${normalized})`,
    ).limit(1);
    return rows[0] ? this.mapAccount(rows[0]) : null;
  }

  async findAdminAccountByEmailOrUsername(emailOrUsername: string): Promise<AdminAccountRecord | null> {
    await this.ensureReady();
    const normalized = emailOrUsername.trim().toLowerCase();
    const rows = await this.db.select().from(adminAccountRows).where(
      or(eq(adminAccountRows.email, normalized), eq(adminAccountRows.username, normalized)),
    ).limit(1);
    return rows[0] ? this.mapAccount(rows[0]) : null;
  }

  async createAdminAccessRequest(input: {
    name: string;
    username: string;
    email: string;
    password: string;
  }): Promise<CreateAdminAccessRequestResult> {
    await this.ensureReady();

    const existing = await this.findAdminAccountByEmailOrUsername(input.email)
      ?? await this.findAdminAccountByEmailOrUsername(input.username);

    if (existing) {
      return {
        ok: false,
        reason: existing.status === "approved" ? "approved_exists" : "pending_exists",
      };
    }

    const record = buildAdminAccountRecord(input);
    const createdAt = new Date(record.createdAt);
    const updatedAt = new Date(record.updatedAt);

    await this.db.insert(adminAccountRows).values({
      id: record.id,
      name: record.name,
      username: record.username,
      email: record.email,
      passwordHash: record.passwordHash,
      passwordSalt: record.passwordSalt,
      status: record.status,
      approvedAt: null,
      createdAt,
      updatedAt,
    });

    return {
      ok: true,
      account: sanitizeRecord(record),
      approvalToken: buildApprovalToken(record.id, record.createdAt),
    };
  }

  async approveAdminAccessRequest(token: string): Promise<ApproveAdminAccessRequestResult> {
    await this.ensureReady();

    const payload = decodeApprovalToken(token);
    if (!payload) {
      return { ok: false, reason: "invalid_token" };
    }

    const account = await this.getAccountRecordById(payload.sub);
    if (!account || account.createdAt !== payload.iat) {
      return { ok: false, reason: "invalid_token" };
    }

    if (account.status === "approved") {
      return {
        ok: true,
        alreadyApproved: true,
        account: sanitizeRecord(account),
      };
    }

    const now = new Date();
    await this.db.update(adminAccountRows)
      .set({
        status: "approved",
        approvedAt: now,
        updatedAt: now,
      })
      .where(eq(adminAccountRows.id, account.id));

    return {
      ok: true,
      alreadyApproved: false,
      account: sanitizeRecord({
        ...account,
        status: "approved",
        approvedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      }),
    };
  }
}

class ResilientAdminAuthStore implements IAdminAuthStore {
  private primary: IAdminAuthStore;
  private fallback: IAdminAuthStore;
  private usingFallback = false;

  constructor(primary: IAdminAuthStore, fallback: IAdminAuthStore) {
    this.primary = primary;
    this.fallback = fallback;
  }

  private shouldFallback(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return /Error connecting to database|fetch failed|ECONNRESET|ENOTFOUND|ETIMEDOUT|connection/i.test(message);
  }

  private async runWithFallback<T>(operation: (store: IAdminAuthStore) => Promise<T>): Promise<T> {
    if (this.usingFallback) {
      return operation(this.fallback);
    }

    try {
      return await operation(this.primary);
    } catch (error) {
      if (!this.shouldFallback(error)) throw error;
      this.usingFallback = true;
      console.warn(
        "[adminAuthStore] Database unavailable, falling back to local admin auth storage:",
        error instanceof Error ? error.message : String(error),
      );
      return operation(this.fallback);
    }
  }

  async getAccountRecordById(id: string) {
    return this.runWithFallback((store) => store.getAccountRecordById(id));
  }

  async getApprovedAdminByIdentifier(identifier: string) {
    return this.runWithFallback((store) => store.getApprovedAdminByIdentifier(identifier));
  }

  async findAdminAccountByEmailOrUsername(emailOrUsername: string) {
    return this.runWithFallback((store) => store.findAdminAccountByEmailOrUsername(emailOrUsername));
  }

  async createAdminAccessRequest(input: {
    name: string;
    username: string;
    email: string;
    password: string;
  }) {
    return this.runWithFallback((store) => store.createAdminAccessRequest(input));
  }

  async approveAdminAccessRequest(token: string) {
    return this.runWithFallback((store) => store.approveAdminAccessRequest(token));
  }
}

function createAdminAuthStore(): IAdminAuthStore {
  const fallback = new FileAdminAuthStore();
  const connectionString = getUsableDatabaseUrl();
  if (!connectionString) return fallback;
  return new ResilientAdminAuthStore(new PostgresAdminAuthStore(connectionString), fallback);
}

export const adminAuthStore = createAdminAuthStore();

export async function getAdminAccountById(id: string) {
  const account = await adminAuthStore.getAccountRecordById(id);
  return account ? sanitizeRecord(account) : null;
}

export async function getApprovedAdminByIdentifier(identifier: string) {
  return adminAuthStore.getApprovedAdminByIdentifier(identifier);
}

export async function findAdminAccountByEmailOrUsername(emailOrUsername: string) {
  return adminAuthStore.findAdminAccountByEmailOrUsername(emailOrUsername);
}

export async function createAdminAccessRequest(input: {
  name: string;
  username: string;
  email: string;
  password: string;
}) {
  return adminAuthStore.createAdminAccessRequest(input);
}

export async function approveAdminAccessRequest(token: string) {
  return adminAuthStore.approveAdminAccessRequest(token);
}
