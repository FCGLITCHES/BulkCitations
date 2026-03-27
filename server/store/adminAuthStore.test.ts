import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("admin auth store", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NODE_ENV = "test";
    process.env.ADMIN_SESSION_SECRET = "test-admin-secret";
    const workerId = process.env.VITEST_POOL_ID ?? process.pid.toString();
    const dataDir = path.resolve(process.cwd(), "tmp", "vitest-data", workerId);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("creates a pending admin request and approves it", async () => {
    const {
      createAdminAccessRequest,
      approveAdminAccessRequest,
      getApprovedAdminByIdentifier,
      verifyAdminAccountPassword,
    } = await import("./adminAuthStore.js");

    const created = await createAdminAccessRequest({
      name: "Jane Archivist",
      username: "archivist_id_01",
      email: "jane@example.com",
      password: "super-secure-pass",
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error("Expected admin request to be created.");
    }

    await expect(getApprovedAdminByIdentifier("jane@example.com")).resolves.toBeNull();

    const approved = await approveAdminAccessRequest(created.approvalToken);
    expect(approved.ok).toBe(true);
    if (!approved.ok) {
      throw new Error("Expected admin request to be approved.");
    }

    const account = await getApprovedAdminByIdentifier("archivist_id_01");
    expect(account?.email).toBe("jane@example.com");
    expect(account?.status).toBe("approved");
    expect(verifyAdminAccountPassword(account!, "super-secure-pass")).toBe(true);
    expect(verifyAdminAccountPassword(account!, "wrong-password")).toBe(false);
  });

  it("keeps approval links valid across module reloads and treats reuse as already approved", async () => {
    const firstModule = await import("./adminAuthStore.js");
    const created = await firstModule.createAdminAccessRequest({
      name: "Jordan Admin",
      username: "jordan.admin",
      email: "jordan@example.com",
      password: "another-secure-pass",
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error("Expected admin request to be created.");
    }

    vi.resetModules();
    const reloadedModule = await import("./adminAuthStore.js");

    const approved = await reloadedModule.approveAdminAccessRequest(created.approvalToken);
    expect(approved.ok).toBe(true);
    if (!approved.ok) {
      throw new Error("Expected admin request to be approved after reload.");
    }
    expect(approved.alreadyApproved).toBe(false);

    const approvedAgain = await reloadedModule.approveAdminAccessRequest(created.approvalToken);
    expect(approvedAgain.ok).toBe(true);
    if (!approvedAgain.ok) {
      throw new Error("Expected reused approval token to resolve cleanly.");
    }
    expect(approvedAgain.alreadyApproved).toBe(true);
  });
});
