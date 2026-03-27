import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("admin auth store", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NODE_ENV = "test";
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

    const created = createAdminAccessRequest({
      name: "Jane Archivist",
      username: "archivist_id_01",
      email: "jane@example.com",
      password: "super-secure-pass",
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error("Expected admin request to be created.");
    }

    expect(getApprovedAdminByIdentifier("jane@example.com")).toBeNull();

    const approved = approveAdminAccessRequest(created.approvalToken);
    expect(approved.ok).toBe(true);
    if (!approved.ok) {
      throw new Error("Expected admin request to be approved.");
    }

    const account = getApprovedAdminByIdentifier("archivist_id_01");
    expect(account?.email).toBe("jane@example.com");
    expect(account?.status).toBe("approved");
    expect(verifyAdminAccountPassword(account!, "super-secure-pass")).toBe(true);
    expect(verifyAdminAccountPassword(account!, "wrong-password")).toBe(false);
  });
});
