import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import fs from "node:fs";
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
  approvalTokenHash: string | null;
  approvalTokenIssuedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type AdminAuthState = {
  accounts: AdminAccountRecord[];
};

const ADMIN_AUTH_FILE = resolveDataFile("admin-auth.json");

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

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
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

export function getAdminAccountById(id: string) {
  const state = readState();
  const record = state.accounts.find((account) => account.id === id);
  return record ? sanitizeRecord(record) : null;
}

export function getApprovedAdminByIdentifier(identifier: string) {
  const normalized = identifier.trim().toLowerCase();
  const state = readState();
  const record = state.accounts.find((account) => (
    account.status === "approved"
    && (account.email === normalized || account.username === normalized)
  ));
  return record ?? null;
}

export function verifyAdminAccountPassword(record: AdminAccountRecord, password: string) {
  const actual = Buffer.from(hashPassword(password, record.passwordSalt), "hex");
  const expected = Buffer.from(record.passwordHash, "hex");

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}

export function findAdminAccountByEmailOrUsername(email: string, username: string) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedUsername = normalizeUsername(username);
  const state = readState();

  return state.accounts.find((account) => (
    account.email === normalizedEmail || account.username === normalizedUsername
  )) ?? null;
}

export function createAdminAccessRequest(input: {
  name: string;
  username: string;
  email: string;
  password: string;
}) {
  const existing = findAdminAccountByEmailOrUsername(input.email, input.username);
  if (existing) {
    return {
      ok: false as const,
      reason: existing.status === "approved" ? "approved_exists" : "pending_exists",
    };
  }

  const now = new Date().toISOString();
  const approvalToken = randomBytes(32).toString("base64url");
  const passwordSalt = randomBytes(16).toString("hex");
  const record: AdminAccountRecord = {
    id: randomBytes(12).toString("hex"),
    name: input.name.trim(),
    username: normalizeUsername(input.username),
    email: normalizeEmail(input.email),
    passwordHash: hashPassword(input.password, passwordSalt),
    passwordSalt,
    status: "pending",
    approvalTokenHash: hashToken(approvalToken),
    approvalTokenIssuedAt: now,
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const state = readState();
  state.accounts.push(record);
  writeState(state);

  return {
    ok: true as const,
    account: sanitizeRecord(record),
    approvalToken,
  };
}

export function approveAdminAccessRequest(token: string) {
  const tokenHash = hashToken(token);
  const state = readState();
  const account = state.accounts.find((entry) => entry.approvalTokenHash === tokenHash);

  if (!account) {
    return { ok: false as const, reason: "invalid_token" };
  }

  if (account.status === "approved") {
    return {
      ok: true as const,
      alreadyApproved: true,
      account: sanitizeRecord(account),
    };
  }

  const now = new Date().toISOString();
  account.status = "approved";
  account.approvedAt = now;
  account.updatedAt = now;
  account.approvalTokenHash = null;
  account.approvalTokenIssuedAt = null;
  writeState(state);

  return {
    ok: true as const,
    alreadyApproved: false,
    account: sanitizeRecord(account),
  };
}
