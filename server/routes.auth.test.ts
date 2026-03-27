import fs from "node:fs";
import path from "node:path";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

function extractCookie(response: Response) {
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

describe("public auth routes", () => {
  let registerRoutes: typeof import("./routes.js").registerRoutes;
  let server: Awaited<ReturnType<typeof import("./routes.js").registerRoutes>>;
  let baseUrl = "";

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APP_SESSION_SECRET = "test-public-session-secret";
    process.env.DATABASE_URL = "";

    ({ registerRoutes } = await import("./routes.js"));

    const app = express();
    app.use(express.json());
    server = await registerRoutes(app);

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          throw new Error("Could not determine test server address");
        }
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  beforeEach(() => {
    const workerId = process.env.VITEST_POOL_ID ?? process.pid.toString();
    const dataDir = path.resolve(process.cwd(), "tmp", "vitest-data", workerId);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });

  it("registers an individual account and exposes the active session", async () => {
    const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Jane Researcher",
        email: "jane@example.com",
        password: "super-secure-pass",
      }),
    });

    expect(registerResponse.status).toBe(201);
    const cookie = extractCookie(registerResponse);
    expect(cookie).toContain("bulkreferences_session=");

    const sessionResponse = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: cookie },
    });
    expect(sessionResponse.ok).toBe(true);

    const sessionPayload = await sessionResponse.json() as {
      authenticated: boolean;
      account?: { email?: string; accountType?: string };
    };
    expect(sessionPayload.authenticated).toBe(true);
    expect(sessionPayload.account?.email).toBe("jane@example.com");
    expect(sessionPayload.account?.accountType).toBe("individual");
  });

  it("supports institutional discovery, registration, and login", async () => {
    const institutionsResponse = await fetch(`${baseUrl}/api/auth/institutions?q=mit`);
    expect(institutionsResponse.ok).toBe(true);
    const institutionsPayload = await institutionsResponse.json() as {
      institutions: Array<{ id: string; name: string; domains: string[] }>;
    };
    expect(institutionsPayload.institutions.length).toBeGreaterThan(0);

    const institution = institutionsPayload.institutions[0]!;
    const email = `alex@${institution.domains[0]}`;

    const registerResponse = await fetch(`${baseUrl}/api/auth/institutional/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Alex Librarian",
        email,
        password: "super-secure-pass",
        institutionId: institution.id,
      }),
    });

    expect(registerResponse.status).toBe(201);
    const registerPayload = await registerResponse.json() as {
      account?: { accountType?: string; institution?: { id?: string } | null };
    };
    expect(registerPayload.account?.accountType).toBe("institutional");
    expect(registerPayload.account?.institution?.id).toBe(institution.id);

    const loginResponse = await fetch(`${baseUrl}/api/auth/institutional/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "super-secure-pass",
        institutionId: institution.id,
      }),
    });

    expect(loginResponse.ok).toBe(true);
    const loginPayload = await loginResponse.json() as {
      account?: { email?: string; institution?: { id?: string } | null };
    };
    expect(loginPayload.account?.email).toBe(email);
    expect(loginPayload.account?.institution?.id).toBe(institution.id);
  });

  it("saves institutional partnership requests and rejects exact duplicates", async () => {
    const firstResponse = await fetch(`${baseUrl}/api/auth/institutions/request-partnership`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactName: "Jordan Systems Librarian",
        workEmail: "jordan@newcampus.edu",
        institutionName: "New Campus University",
        notes: "Need access for the library services team.",
      }),
    });

    expect(firstResponse.status).toBe(201);

    const duplicateResponse = await fetch(`${baseUrl}/api/auth/institutions/request-partnership`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactName: "Jordan Systems Librarian",
        workEmail: "jordan@newcampus.edu",
        institutionName: "New Campus University",
        notes: "Following up from procurement.",
      }),
    });

    expect(duplicateResponse.status).toBe(409);
  });
});
