/**
 * Tries `docker compose up -d postgres redis` from the repo root.
 * On success, waits briefly then runs `pnpm run db:migrate` so tables (`usage`, etc.) exist.
 * Exits 0 if Docker is unavailable (dev can use remote DB/Redis).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const result = spawnSync("docker", ["compose", "up", "-d", "postgres", "redis"], {
  cwd: root,
  stdio: "inherit",
  shell: false,
  env: process.env,
});

if (result.status !== 0) {
  console.error(
    "\n[infra] Docker is not available (daemon not running or Docker Desktop not started).",
  );
  console.error(
    "[infra] Skipping local postgres/redis. Start Docker Desktop and run: pnpm run infra:up",
  );
  console.error(
    "[infra] Or keep using DATABASE_URL / REDIS_URL from .env if they point to remote services.\n",
  );
  process.exit(0);
}

await delay(2000);

console.log("\n[infra] Applying database migrations (DATABASE_URL from repo root .env)...\n");

const mig = spawnSync("pnpm", ["run", "db:migrate"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env: process.env,
});

if (mig.status !== 0) {
  console.error("\n[infra] db:migrate failed. Point DATABASE_URL at the Postgres you use.");
  console.error(
    "[infra] Local Docker: postgresql://postgres:postgres@localhost:5432/bulkreferences",
  );
  console.error("[infra] Fix .env, then run: pnpm run db:migrate\n");
  process.exit(mig.status ?? 1);
}

process.exit(0);
