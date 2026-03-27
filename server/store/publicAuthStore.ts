import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createPostgresPoolConfig, getUsableDatabaseUrl } from "./databaseUrl.js";
import { resolveDataFile } from "./persistence.js";

export type PublicAccountType = "individual" | "institutional";

export type InstitutionRecord = {
  id: string;
  slug: string;
  name: string;
  domains: string[];
  createdAt: string;
  updatedAt: string;
};

export type PublicAccountRecord = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  accountType: PublicAccountType;
  institutionId: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

export type InstitutionPartnershipRequestRecord = {
  id: string;
  contactName: string;
  workEmail: string;
  institutionName: string;
  notes: string;
  status: "pending";
  createdAt: string;
  updatedAt: string;
};

export type PublicSessionAccount = {
  id: string;
  name: string;
  email: string;
  accountType: PublicAccountType;
  institution: {
    id: string;
    slug: string;
    name: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

type PublicAuthState = {
  accounts: PublicAccountRecord[];
  institutions: InstitutionRecord[];
  partnershipRequests: InstitutionPartnershipRequestRecord[];
};

type CreateAccountResult =
  | { ok: true; account: PublicSessionAccount }
  | { ok: false; reason: "email_exists" | "invalid_institution" | "domain_mismatch" };

type CreatePartnershipRequestResult =
  | { ok: true; request: InstitutionPartnershipRequestRecord }
  | { ok: false; reason: "pending_exists" };

type IPublicAuthStore = {
  getAccountRecordByEmail(email: string): Promise<PublicAccountRecord | null>;
  getSessionAccountById(id: string): Promise<PublicSessionAccount | null>;
  listInstitutions(query?: string): Promise<InstitutionRecord[]>;
  createIndividualAccount(input: { name: string; email: string; password: string }): Promise<CreateAccountResult>;
  createInstitutionalAccount(input: { name: string; email: string; password: string; institutionId: string }): Promise<CreateAccountResult>;
  recordSuccessfulLogin(accountId: string): Promise<PublicSessionAccount | null>;
  createPartnershipRequest(input: {
    contactName: string;
    workEmail: string;
    institutionName: string;
    notes: string;
  }): Promise<CreatePartnershipRequestResult>;
};

const PUBLIC_AUTH_FILE = resolveDataFile("public-auth.json");

const DEFAULT_INSTITUTIONS: InstitutionRecord[] = [
  { id: "inst_mit", slug: "mit", name: "Massachusetts Institute of Technology", domains: ["mit.edu"], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  { id: "inst_harvard", slug: "harvard", name: "Harvard University", domains: ["harvard.edu"], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  { id: "inst_oxford", slug: "oxford", name: "University of Oxford", domains: ["ox.ac.uk"], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  { id: "inst_cambridge", slug: "cambridge", name: "University of Cambridge", domains: ["cam.ac.uk"], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  { id: "inst_stanford", slug: "stanford", name: "Stanford University", domains: ["stanford.edu"], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  { id: "inst_imperial", slug: "imperial", name: "Imperial College London", domains: ["imperial.ac.uk"], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  { id: "inst_tsinghua", slug: "tsinghua", name: "Tsinghua University", domains: ["tsinghua.edu.cn"], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  { id: "inst_toronto", slug: "toronto", name: "University of Toronto", domains: ["utoronto.ca"], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
];

const institutionRows = pgTable("public_auth_institutions", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  domains: jsonb("domains").$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

const accountRows = pgTable("public_auth_accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  accountType: text("account_type").notNull(),
  institutionId: text("institution_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

const partnershipRows = pgTable("public_auth_partnership_requests", {
  id: text("id").primaryKey(),
  contactName: text("contact_name").notNull(),
  workEmail: text("work_email").notNull(),
  institutionName: text("institution_name").notNull(),
  notes: text("notes").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function slugifyInstitution(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getEmailDomain(email: string) {
  return normalizeEmail(email).split("@")[1] ?? "";
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString("hex");
}

export function verifyPublicAccountPassword(record: PublicAccountRecord, password: string) {
  const actual = Buffer.from(hashPassword(password, record.passwordSalt), "hex");
  const expected = Buffer.from(record.passwordHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function dedupeInstitutions(institutions: InstitutionRecord[]) {
  const byId = new Map<string, InstitutionRecord>();
  for (const institution of [...DEFAULT_INSTITUTIONS, ...institutions]) {
    byId.set(institution.id, {
      ...institution,
      domains: Array.from(new Set(institution.domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean))),
    });
  }
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function createEmptyState(): PublicAuthState {
  return {
    accounts: [],
    institutions: dedupeInstitutions([]),
    partnershipRequests: [],
  };
}

function readState(): PublicAuthState {
  if (!fs.existsSync(PUBLIC_AUTH_FILE)) return createEmptyState();

  try {
    const raw = fs.readFileSync(PUBLIC_AUTH_FILE, "utf8");
    if (!raw.trim()) return createEmptyState();
    const parsed = JSON.parse(raw) as Partial<PublicAuthState>;
    return {
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      institutions: dedupeInstitutions(Array.isArray(parsed.institutions) ? parsed.institutions : []),
      partnershipRequests: Array.isArray(parsed.partnershipRequests) ? parsed.partnershipRequests : [],
    };
  } catch (error) {
    console.warn(
      `[public-auth] Failed to read ${PUBLIC_AUTH_FILE}:`,
      error instanceof Error ? error.message : String(error),
    );
    return createEmptyState();
  }
}

function writeState(state: PublicAuthState) {
  fs.mkdirSync(path.dirname(PUBLIC_AUTH_FILE), { recursive: true });
  fs.writeFileSync(PUBLIC_AUTH_FILE, JSON.stringify({
    accounts: state.accounts,
    institutions: dedupeInstitutions(state.institutions),
    partnershipRequests: state.partnershipRequests,
  }, null, 2), "utf8");
}

function sanitizeInstitution(institution: InstitutionRecord) {
  return {
    id: institution.id,
    slug: institution.slug,
    name: institution.name,
  };
}

function sanitizeAccount(record: PublicAccountRecord, institutions: InstitutionRecord[]): PublicSessionAccount {
  const institution = record.institutionId
    ? institutions.find((candidate) => candidate.id === record.institutionId) ?? null
    : null;

  return {
    id: record.id,
    name: record.name,
    email: record.email,
    accountType: record.accountType,
    institution: institution ? sanitizeInstitution(institution) : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastLoginAt: record.lastLoginAt,
  };
}

class FilePublicAuthStore implements IPublicAuthStore {
  private getState(): PublicAuthState {
    const state = readState();
    return {
      accounts: [...state.accounts],
      institutions: dedupeInstitutions(state.institutions),
      partnershipRequests: [...state.partnershipRequests],
    };
  }

  private setState(nextState: PublicAuthState) {
    writeState({
      accounts: [...nextState.accounts],
      institutions: dedupeInstitutions(nextState.institutions),
      partnershipRequests: [...nextState.partnershipRequests],
    });
  }

  async getAccountRecordByEmail(email: string): Promise<PublicAccountRecord | null> {
    const normalizedEmail = normalizeEmail(email);
    const state = this.getState();
    return state.accounts.find((account) => account.email === normalizedEmail) ?? null;
  }

  async getSessionAccountById(id: string): Promise<PublicSessionAccount | null> {
    const state = this.getState();
    const account = state.accounts.find((candidate) => candidate.id === id);
    return account ? sanitizeAccount(account, state.institutions) : null;
  }

  async listInstitutions(query = ""): Promise<InstitutionRecord[]> {
    const normalizedQuery = query.trim().toLowerCase();
    const state = this.getState();
    if (!normalizedQuery) return state.institutions;

    return state.institutions.filter((institution) => (
      institution.name.toLowerCase().includes(normalizedQuery)
      || institution.slug.toLowerCase().includes(normalizedQuery)
      || institution.domains.some((domain) => domain.includes(normalizedQuery))
    ));
  }

  async createIndividualAccount(input: { name: string; email: string; password: string }): Promise<CreateAccountResult> {
    const state = this.getState();
    const normalizedEmail = normalizeEmail(input.email);
    if (state.accounts.some((account) => account.email === normalizedEmail)) {
      return { ok: false, reason: "email_exists" };
    }

    const passwordSalt = randomBytes(16).toString("hex");
    const now = new Date().toISOString();
    const record: PublicAccountRecord = {
      id: randomBytes(12).toString("hex"),
      name: input.name.trim(),
      email: normalizedEmail,
      passwordHash: hashPassword(input.password, passwordSalt),
      passwordSalt,
      accountType: "individual",
      institutionId: null,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    };

    state.accounts.push(record);
    this.setState(state);
    return { ok: true, account: sanitizeAccount(record, state.institutions) };
  }

  async createInstitutionalAccount(input: { name: string; email: string; password: string; institutionId: string }): Promise<CreateAccountResult> {
    const state = this.getState();
    const normalizedEmail = normalizeEmail(input.email);
    if (state.accounts.some((account) => account.email === normalizedEmail)) {
      return { ok: false, reason: "email_exists" };
    }

    const institution = state.institutions.find((candidate) => candidate.id === input.institutionId || candidate.slug === input.institutionId);
    if (!institution) {
      return { ok: false, reason: "invalid_institution" };
    }

    if (!institution.domains.includes(getEmailDomain(normalizedEmail))) {
      return { ok: false, reason: "domain_mismatch" };
    }

    const passwordSalt = randomBytes(16).toString("hex");
    const now = new Date().toISOString();
    const record: PublicAccountRecord = {
      id: randomBytes(12).toString("hex"),
      name: input.name.trim(),
      email: normalizedEmail,
      passwordHash: hashPassword(input.password, passwordSalt),
      passwordSalt,
      accountType: "institutional",
      institutionId: institution.id,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    };

    state.accounts.push(record);
    this.setState(state);
    return { ok: true, account: sanitizeAccount(record, state.institutions) };
  }

  async recordSuccessfulLogin(accountId: string): Promise<PublicSessionAccount | null> {
    const state = this.getState();
    const index = state.accounts.findIndex((account) => account.id === accountId);
    if (index === -1) return null;

    state.accounts[index] = {
      ...state.accounts[index],
      lastLoginAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.setState(state);
    return sanitizeAccount(state.accounts[index], state.institutions);
  }

  async createPartnershipRequest(input: {
    contactName: string;
    workEmail: string;
    institutionName: string;
    notes: string;
  }): Promise<CreatePartnershipRequestResult> {
    const state = this.getState();
    const normalizedEmail = normalizeEmail(input.workEmail);
    const normalizedInstitution = input.institutionName.trim().toLowerCase();
    const existing = state.partnershipRequests.find((request) => (
      request.status === "pending"
      && request.workEmail === normalizedEmail
      && request.institutionName.trim().toLowerCase() === normalizedInstitution
    ));
    if (existing) {
      return { ok: false, reason: "pending_exists" };
    }

    const now = new Date().toISOString();
    const request: InstitutionPartnershipRequestRecord = {
      id: randomBytes(12).toString("hex"),
      contactName: input.contactName.trim(),
      workEmail: normalizedEmail,
      institutionName: input.institutionName.trim(),
      notes: input.notes.trim(),
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };

    state.partnershipRequests.push(request);
    this.setState(state);
    return { ok: true, request };
  }
}

class PostgresPublicAuthStore implements IPublicAuthStore {
  private db;
  private ready: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.db = drizzle({ connection: createPostgresPoolConfig(connectionString) });
  }

  private async ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = Promise.all([
        this.db.execute(sql`
          create table if not exists public_auth_institutions (
            id text primary key,
            slug text not null unique,
            name text not null,
            domains jsonb not null,
            created_at timestamptz not null,
            updated_at timestamptz not null
          )
        `),
        this.db.execute(sql`
          create table if not exists public_auth_accounts (
            id text primary key,
            name text not null,
            email text not null unique,
            password_hash text not null,
            password_salt text not null,
            account_type text not null,
            institution_id text,
            created_at timestamptz not null,
            updated_at timestamptz not null,
            last_login_at timestamptz
          )
        `),
        this.db.execute(sql`
          create table if not exists public_auth_partnership_requests (
            id text primary key,
            contact_name text not null,
            work_email text not null,
            institution_name text not null,
            notes text not null,
            status text not null,
            created_at timestamptz not null,
            updated_at timestamptz not null
          )
        `),
      ]).then(async () => {
        for (const institution of DEFAULT_INSTITUTIONS) {
          await this.db.insert(institutionRows).values({
            id: institution.id,
            slug: institution.slug,
            name: institution.name,
            domains: institution.domains,
            createdAt: new Date(institution.createdAt),
            updatedAt: new Date(institution.updatedAt),
          }).onConflictDoNothing();
        }
      }).then(() => undefined);
    }

    await this.ready;
  }

  private mapInstitution(row: typeof institutionRows.$inferSelect): InstitutionRecord {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      domains: Array.isArray(row.domains) ? row.domains : [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapAccount(row: typeof accountRows.$inferSelect): PublicAccountRecord {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      passwordHash: row.passwordHash,
      passwordSalt: row.passwordSalt,
      accountType: row.accountType as PublicAccountType,
      institutionId: row.institutionId ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    };
  }

  async getAccountRecordByEmail(email: string): Promise<PublicAccountRecord | null> {
    await this.ensureReady();
    const rows = await this.db.select().from(accountRows).where(eq(accountRows.email, normalizeEmail(email))).limit(1);
    return rows[0] ? this.mapAccount(rows[0]) : null;
  }

  async getSessionAccountById(id: string): Promise<PublicSessionAccount | null> {
    await this.ensureReady();
    const [account, institutions] = await Promise.all([
      this.db.select().from(accountRows).where(eq(accountRows.id, id)).limit(1),
      this.db.select().from(institutionRows),
    ]);
    if (!account[0]) return null;
    return sanitizeAccount(this.mapAccount(account[0]), institutions.map((row) => this.mapInstitution(row)));
  }

  async listInstitutions(query = ""): Promise<InstitutionRecord[]> {
    await this.ensureReady();
    const rows = await this.db.select().from(institutionRows);
    const institutions = rows.map((row) => this.mapInstitution(row)).sort((left, right) => left.name.localeCompare(right.name));
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return institutions;
    return institutions.filter((institution) => (
      institution.name.toLowerCase().includes(normalizedQuery)
      || institution.slug.toLowerCase().includes(normalizedQuery)
      || institution.domains.some((domain) => domain.includes(normalizedQuery))
    ));
  }

  async createIndividualAccount(input: { name: string; email: string; password: string }): Promise<CreateAccountResult> {
    await this.ensureReady();
    const existing = await this.getAccountRecordByEmail(input.email);
    if (existing) {
      return { ok: false, reason: "email_exists" };
    }

    const now = new Date();
    const passwordSalt = randomBytes(16).toString("hex");
    const record: PublicAccountRecord = {
      id: randomBytes(12).toString("hex"),
      name: input.name.trim(),
      email: normalizeEmail(input.email),
      passwordHash: hashPassword(input.password, passwordSalt),
      passwordSalt,
      accountType: "individual",
      institutionId: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      lastLoginAt: now.toISOString(),
    };

    await this.db.insert(accountRows).values({
      id: record.id,
      name: record.name,
      email: record.email,
      passwordHash: record.passwordHash,
      passwordSalt: record.passwordSalt,
      accountType: record.accountType,
      institutionId: null,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });

    return {
      ok: true,
      account: sanitizeAccount(record, await this.listInstitutions()),
    };
  }

  async createInstitutionalAccount(input: { name: string; email: string; password: string; institutionId: string }): Promise<CreateAccountResult> {
    await this.ensureReady();
    const existing = await this.getAccountRecordByEmail(input.email);
    if (existing) {
      return { ok: false, reason: "email_exists" };
    }

    const institutions = await this.listInstitutions();
    const institution = institutions.find((candidate) => candidate.id === input.institutionId || candidate.slug === input.institutionId);
    if (!institution) {
      return { ok: false, reason: "invalid_institution" };
    }

    if (!institution.domains.includes(getEmailDomain(input.email))) {
      return { ok: false, reason: "domain_mismatch" };
    }

    const now = new Date();
    const passwordSalt = randomBytes(16).toString("hex");
    const record: PublicAccountRecord = {
      id: randomBytes(12).toString("hex"),
      name: input.name.trim(),
      email: normalizeEmail(input.email),
      passwordHash: hashPassword(input.password, passwordSalt),
      passwordSalt,
      accountType: "institutional",
      institutionId: institution.id,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      lastLoginAt: now.toISOString(),
    };

    await this.db.insert(accountRows).values({
      id: record.id,
      name: record.name,
      email: record.email,
      passwordHash: record.passwordHash,
      passwordSalt: record.passwordSalt,
      accountType: record.accountType,
      institutionId: record.institutionId,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });

    return {
      ok: true,
      account: sanitizeAccount(record, institutions),
    };
  }

  async recordSuccessfulLogin(accountId: string): Promise<PublicSessionAccount | null> {
    await this.ensureReady();
    const now = new Date();
    await this.db.update(accountRows)
      .set({ lastLoginAt: now, updatedAt: now })
      .where(eq(accountRows.id, accountId));
    return this.getSessionAccountById(accountId);
  }

  async createPartnershipRequest(input: {
    contactName: string;
    workEmail: string;
    institutionName: string;
    notes: string;
  }): Promise<CreatePartnershipRequestResult> {
    await this.ensureReady();
    const normalizedEmail = normalizeEmail(input.workEmail);
    const existing = await this.db.select().from(partnershipRows).where(eq(partnershipRows.workEmail, normalizedEmail));
    const normalizedInstitution = input.institutionName.trim().toLowerCase();
    const pending = existing.find((request) => (
      request.status === "pending"
      && request.institutionName.trim().toLowerCase() === normalizedInstitution
    ));
    if (pending) {
      return { ok: false, reason: "pending_exists" };
    }

    const now = new Date();
    const request: InstitutionPartnershipRequestRecord = {
      id: randomBytes(12).toString("hex"),
      contactName: input.contactName.trim(),
      workEmail: normalizedEmail,
      institutionName: input.institutionName.trim(),
      notes: input.notes.trim(),
      status: "pending",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    await this.db.insert(partnershipRows).values({
      id: request.id,
      contactName: request.contactName,
      workEmail: request.workEmail,
      institutionName: request.institutionName,
      notes: request.notes,
      status: request.status,
      createdAt: now,
      updatedAt: now,
    });

    return { ok: true, request };
  }
}

class ResilientPublicAuthStore implements IPublicAuthStore {
  private primary: IPublicAuthStore;
  private fallback: IPublicAuthStore;
  private usingFallback = false;

  constructor(primary: IPublicAuthStore, fallback: IPublicAuthStore) {
    this.primary = primary;
    this.fallback = fallback;
  }

  private shouldFallback(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return /Error connecting to database|fetch failed|ECONNRESET|ENOTFOUND|ETIMEDOUT|connection/i.test(message);
  }

  private async runWithFallback<T>(operation: (store: IPublicAuthStore) => Promise<T>): Promise<T> {
    if (this.usingFallback) {
      return operation(this.fallback);
    }

    try {
      return await operation(this.primary);
    } catch (error) {
      if (!this.shouldFallback(error)) throw error;
      this.usingFallback = true;
      console.warn(
        "[publicAuthStore] Database unavailable, falling back to local auth storage:",
        error instanceof Error ? error.message : String(error),
      );
      return operation(this.fallback);
    }
  }

  async getAccountRecordByEmail(email: string) {
    return this.runWithFallback((store) => store.getAccountRecordByEmail(email));
  }

  async getSessionAccountById(id: string) {
    return this.runWithFallback((store) => store.getSessionAccountById(id));
  }

  async listInstitutions(query?: string) {
    return this.runWithFallback((store) => store.listInstitutions(query));
  }

  async createIndividualAccount(input: { name: string; email: string; password: string }) {
    return this.runWithFallback((store) => store.createIndividualAccount(input));
  }

  async createInstitutionalAccount(input: { name: string; email: string; password: string; institutionId: string }) {
    return this.runWithFallback((store) => store.createInstitutionalAccount(input));
  }

  async recordSuccessfulLogin(accountId: string) {
    return this.runWithFallback((store) => store.recordSuccessfulLogin(accountId));
  }

  async createPartnershipRequest(input: {
    contactName: string;
    workEmail: string;
    institutionName: string;
    notes: string;
  }) {
    return this.runWithFallback((store) => store.createPartnershipRequest(input));
  }
}

function createPublicAuthStore(): IPublicAuthStore {
  const fallback = new FilePublicAuthStore();
  const connectionString = getUsableDatabaseUrl();
  if (!connectionString) return fallback;
  return new ResilientPublicAuthStore(new PostgresPublicAuthStore(connectionString), fallback);
}

export function normalizeInstitutionSearchQuery(value: string | undefined) {
  return value?.trim().slice(0, 80) ?? "";
}

export function buildInstitutionPartnershipSlug(value: string) {
  return slugifyInstitution(value);
}

export const publicAuthStore = createPublicAuthStore();
