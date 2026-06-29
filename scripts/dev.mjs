import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const shutdownTimeoutMs = Number(process.env.DEV_SUPERVISOR_SHUTDOWN_TIMEOUT_MS || 8_000);
const restartBaseDelayMs = Number(process.env.DEV_SUPERVISOR_RESTART_DELAY_MS || 1_000);
const rootEnvPath = join(root, ".env");
const devLockPath = join(root, ".dev-supervisor.lock");

const pnpmCommand = "pnpm";

let shuttingDown = false;

function parseDotEnvFile(filePath) {
  if (!existsSync(filePath)) return {};

  const parsed = {};
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/u);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([\w.-]+)\s*=\s*(.*)$/u);
    if (!match) continue;

    const [, key, rawValue] = match;
    const quote = rawValue[0];
    const unquoted =
      (quote === '"' || quote === "'") && rawValue.endsWith(quote)
        ? rawValue.slice(1, -1)
        : rawValue;
    parsed[key] = unquoted;
  }

  return parsed;
}

const rootEnv = {
  ...process.env,
  ...parseDotEnvFile(rootEnvPath),
};

const serverPort = Number(rootEnv.PORT || 3111);
const frontendPort = Number(rootEnv.FRONTEND_PORT || 2397);
const mlPort = parseTcpTarget(rootEnv.ML_SERVICE_URL || "http://localhost:8123", 8123)?.port ?? 8123;
const autoExitMs = Number(process.env.DEV_SUPERVISOR_AUTO_EXIT_MS || 0);

function buildChildEnv(overrides = {}) {
  return {
    ...process.env,
    ...rootEnv,
    ...overrides,
  };
}

function isLocalHost(host) {
  return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(String(host || "").toLowerCase());
}

function parseTcpTarget(urlValue, defaultPort) {
  if (!urlValue?.trim()) return null;

  try {
    const parsed = new URL(urlValue);
    const port = parsed.port ? Number(parsed.port) : defaultPort;
    return {
      host: parsed.hostname,
      port: Number.isFinite(port) ? port : defaultPort,
      isLocal: isLocalHost(parsed.hostname),
    };
  } catch {
    return null;
  }
}

async function canReachPort(host, port, timeoutMs = 750) {
  try {
    await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      const cleanup = () => socket.removeAllListeners();
      socket.setTimeout(timeoutMs);
      socket.once("connect", () => {
        cleanup();
        socket.end();
        resolve();
      });
      socket.once("timeout", () => {
        cleanup();
        socket.destroy();
        reject(new Error("timeout"));
      });
      socket.once("error", (error) => {
        cleanup();
        socket.destroy();
        reject(error);
      });
    });
    return true;
  } catch {
    return false;
  }
}

async function resolveServerEnvOverrides() {
  const overrides = {
    DOTENV_OVERRIDE: "false",
  };
  const configuredBackend = rootEnv.PERSISTENCE_BACKEND || "database";
  const databaseUrl = rootEnv.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/bulkreferences";
  const databaseTarget = parseTcpTarget(databaseUrl, 5432);
  const redisUrl = rootEnv.UPSTASH_REDIS_URL || rootEnv.REDIS_URL || "";
  const redisTarget = parseTcpTarget(redisUrl, 6379);

  const requiresDatabasePersistence =
    configuredBackend === "database"
    || (configuredBackend === "auto" && Boolean(databaseUrl.trim()));

  if (requiresDatabasePersistence && databaseTarget?.isLocal) {
    const databaseReachable = await canReachPort(databaseTarget.host, databaseTarget.port);
    if (!databaseReachable) {
      throw new Error(
        `[dev] local postgres is unavailable at ${databaseTarget.host}:${databaseTarget.port}; refusing to fall back to transient non-durable persistence. Start the Postgres container or fix DATABASE_URL before running pnpm dev.`,
      );
    }
  }

  if (redisTarget?.isLocal) {
    const redisReachable = await canReachPort(redisTarget.host, redisTarget.port);
    if (!redisReachable) {
      overrides.REDIS_URL = "";
      overrides.UPSTASH_REDIS_URL = "";
      process.stdout.write(
        `[dev] local redis is unavailable at ${redisTarget.host}:${redisTarget.port}; disabling Redis-backed queues for this session\n`,
      );
    }
  }

  return overrides;
}

function prefixWriter(name, stream) {
  let buffer = "";

  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) continue;
      process.stdout.write(`[${name}] ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (!buffer) return;
    process.stdout.write(`[${name}] ${buffer}\n`);
    buffer = "";
  });
}

function spawnCommand(command, args, name, env = process.env) {
  const runDirectly = !isWindows || /\.exe$/iu.test(command);
  const child = spawn(
    runDirectly ? command : process.env.ComSpec || "cmd.exe",
    runDirectly ? args : ["/d", "/s", "/c", buildWindowsCommand(command, args)],
    {
    cwd: root,
    env,
    shell: false,
    stdio: ["inherit", "pipe", "pipe"],
    windowsHide: true,
    },
  );

  if (child.stdout) prefixWriter(name, child.stdout);
  if (child.stderr) prefixWriter(name, child.stderr);

  child.on("error", (error) => {
    process.stdout.write(`[${name}] failed to start: ${error.message}\n`);
  });

  return child;
}

function buildWindowsCommand(command, args) {
  return [command, ...args].map(quoteWindowsArg).join(" ");
}

function quoteWindowsArg(value) {
  if (!/[\s"]/u.test(value)) return value;
  return `"${value.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/g, "$1$1")}"`;
}

function killProcessTree(pid) {
  if (!pid) return;

  if (isWindows) {
    const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
      cwd: root,
      env: process.env,
      shell: false,
      stdio: "ignore",
    });
    killer.on("error", () => {});
    return;
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}

async function waitForPortFree(port, host = "127.0.0.1", maxMs = 45_000, intervalMs = 250) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < maxMs) {
    if (!(await canReachPort(host, port))) {
      return;
    }
    await delay(intervalMs);
  }

  throw new Error(`Port ${host}:${port} is still in use`);
}

async function killPort(port) {
  await new Promise((resolve) => {
    const child = spawnCommand(
      pnpmCommand,
      ["exec", "kill-port", String(port)],
      `kill-port-${port}`,
      buildChildEnv(),
    );
    child.on("exit", () => resolve());
  });
}

async function ensureDevPortsFree(ports, { required = false } = {}) {
  const uniquePorts = [...new Set(ports.filter((port) => Number.isFinite(port) && port > 0))];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const busyPorts = [];
    for (const port of uniquePorts) {
      if (await canReachPort("127.0.0.1", port)) {
        busyPorts.push(port);
      }
    }

    if (busyPorts.length === 0) {
      return;
    }

    process.stdout.write(`[dev] freeing ports before startup: ${busyPorts.join(", ")}\n`);
    await Promise.all(busyPorts.map((port) => killPort(port)));
    await delay(750);

    let allFree = true;
    for (const port of busyPorts) {
      try {
        await waitForPortFree(port);
      } catch (error) {
        allFree = false;
        if (attempt === 2 && required) {
          throw error;
        }
      }
    }

    if (allFree) {
      return;
    }
  }

  if (required) {
    throw new Error(`Could not free required dev ports: ${uniquePorts.join(", ")}`);
  }
}

function readDevLockPid() {
  if (!existsSync(devLockPath)) return null;

  const raw = readFileSync(devLockPath, "utf8").trim();
  const pid = Number(raw);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireDevLock() {
  const existingPid = readDevLockPid();
  if (existingPid && isProcessRunning(existingPid)) {
    process.stderr.write(
      `[dev] Another dev supervisor is already running (pid ${existingPid}). Run pnpm dev:stop first.\n`,
    );
    process.exit(1);
  }

  writeFileSync(devLockPath, String(process.pid), "utf8");
}

function releaseDevLock() {
  try {
    unlinkSync(devLockPath);
  } catch {}
}

async function waitForPort(port, host = "127.0.0.1", maxMs = 120_000, intervalMs = 300) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < maxMs) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection({ host, port }, () => {
          socket.end();
          resolve();
        });
        socket.on("error", reject);
      });
      return;
    } catch {
      await delay(intervalMs);
    }
  }

  throw new Error(`Timed out waiting for ${host}:${port}`);
}

async function runSetupStep(name, command, args) {
  process.stdout.write(`[dev] ${name}\n`);

  await new Promise((resolve, reject) => {
    const child = spawnCommand(command, args, name, buildChildEnv());
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${name} exited with code ${code ?? "null"} signal ${signal ?? "null"}`));
    });
  });
}

class ManagedProcess {
  constructor(config) {
    this.config = config;
    this.child = null;
    this.restartCount = 0;
    this.startedAt = 0;
    this.restartTimer = null;
    this.startPromise = null;
  }

  async start() {
    if (shuttingDown) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = null;
    });

    return this.startPromise;
  }

  async startInternal() {
    if (this.config.requiredPort && this.restartCount > 0) {
      try {
        await ensureDevPortsFree([this.config.requiredPort]);
      } catch (error) {
        process.stdout.write(`[${this.config.name}] could not free port ${this.config.requiredPort}: ${error.message}\n`);
        this.scheduleRestart();
        return;
      }
    }

    if (this.config.waitForPort) {
      try {
        await waitForPort(this.config.waitForPort);
      } catch (error) {
        process.stdout.write(`[${this.config.name}] delayed start failed: ${error.message}\n`);
        this.scheduleRestart();
        return;
      }
    }

    if (shuttingDown) return;

    this.startedAt = Date.now();
    this.child = spawnCommand(
      this.config.command,
      this.config.args,
      this.config.name,
      this.config.env ?? buildChildEnv(),
    );

    this.child.on("exit", (code, signal) => {
      const runtimeMs = Date.now() - this.startedAt;
      this.child = null;

      if (shuttingDown) {
        process.stdout.write(`[${this.config.name}] exited during shutdown (${code ?? "null"}${signal ? ` / ${signal}` : ""})\n`);
        return;
      }

      process.stdout.write(`[${this.config.name}] exited unexpectedly (${code ?? "null"}${signal ? ` / ${signal}` : ""}) after ${runtimeMs}ms; restarting\n`);
      if (runtimeMs > 15_000) {
        this.restartCount = 0;
      }
      this.scheduleRestart();
    });
  }

  scheduleRestart() {
    if (shuttingDown || this.restartTimer) return;

    this.restartCount += 1;
    const delayMs = Math.min(restartBaseDelayMs * Math.max(this.restartCount, 1), 5_000);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.start();
    }, delayMs);
  }

  async stop() {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    const child = this.child;
    if (!child?.pid) return;

    try {
      child.kill("SIGINT");
    } catch {}

    const exited = await Promise.race([
      new Promise((resolve) => child.once("exit", () => resolve(true))),
      delay(shutdownTimeoutMs).then(() => false),
    ]);

    if (!exited) {
      killProcessTree(child.pid);
    }
  }
}

const processes = [
  new ManagedProcess({
    name: "server",
    command: pnpmCommand,
    args: ["--dir", "server", "run", "dev"],
  }),
  new ManagedProcess({
    name: "ml",
    command: pnpmCommand,
    args: ["run", "dev:ml"],
    requiredPort: mlPort,
  }),
  new ManagedProcess({
    name: "frontend",
    command: pnpmCommand,
    args: ["--dir", "frontend", "run", "dev"],
    waitForPort: serverPort,
    requiredPort: frontendPort,
  }),
];

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(`[dev] received ${signal}, shutting down\n`);
  await Promise.all(processes.map((managed) => managed.stop()));
  releaseDevLock();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

if (autoExitMs > 0) {
  setTimeout(() => {
    void shutdown(`auto-exit (${autoExitMs}ms)`);
  }, autoExitMs);
}

acquireDevLock();

await runSetupStep("dev-stop", pnpmCommand, ["run", "dev:stop"]);
await delay(750);
await ensureDevPortsFree([serverPort, frontendPort], { required: true });
await ensureDevPortsFree([mlPort]);
await runSetupStep("infra", process.execPath, ["scripts/infra-up.mjs"]);
await runSetupStep("ml-bootstrap", process.execPath, ["scripts/ensure-bootstrap-bundle.mjs"]);

const serverEnvOverrides = await resolveServerEnvOverrides();
processes.find((managed) => managed.config.name === "server").config.env = buildChildEnv(serverEnvOverrides);

for (const managed of processes) {
  if (managed.config.name === "frontend") continue;
  void managed.start();
}

void processes.find((managed) => managed.config.name === "frontend")?.start();

await new Promise(() => {});
