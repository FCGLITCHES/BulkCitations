import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("public auth store", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "";
    const workerId = process.env.VITEST_POOL_ID ?? process.pid.toString();
    const dataDir = path.resolve(process.cwd(), "tmp", "vitest-data", workerId);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("creates an individual account and verifies the password hash", async () => {
    const {
      publicAuthStore,
      verifyPublicAccountPassword,
    } = await import("./publicAuthStore.js");

    const created = await publicAuthStore.createIndividualAccount({
      name: "Jane Researcher",
      email: "jane@example.com",
      password: "super-secure-pass",
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error("Expected individual account creation to succeed.");
    }

    const accountRecord = await publicAuthStore.getAccountRecordByEmail("jane@example.com");
    expect(accountRecord?.accountType).toBe("individual");
    expect(verifyPublicAccountPassword(accountRecord!, "super-secure-pass")).toBe(true);
    expect(verifyPublicAccountPassword(accountRecord!, "wrong-password")).toBe(false);
  });

  it("requires a matching institution domain for institutional accounts", async () => {
    const { publicAuthStore } = await import("./publicAuthStore.js");
    const institutions = await publicAuthStore.listInstitutions("mit");
    expect(institutions.length).toBeGreaterThan(0);

    const institution = institutions[0]!;
    const mismatch = await publicAuthStore.createInstitutionalAccount({
      name: "Alex Librarian",
      email: "alex@example.com",
      password: "super-secure-pass",
      institutionId: institution.id,
    });
    expect(mismatch).toEqual({ ok: false, reason: "domain_mismatch" });

    const created = await publicAuthStore.createInstitutionalAccount({
      name: "Alex Librarian",
      email: `alex@${institution.domains[0]}`,
      password: "super-secure-pass",
      institutionId: institution.id,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error("Expected institutional account creation to succeed.");
    }

    expect(created.account.accountType).toBe("institutional");
    expect(created.account.institution?.id).toBe(institution.id);
  });
});
