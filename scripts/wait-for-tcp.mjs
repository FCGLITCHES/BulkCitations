/**
 * Block until a process is accepting TCP on host:port (avoids Vite proxy ECONNREFUSED
 * when `concurrently` starts the API and frontend at the same time).
 *
 * Usage: node scripts/wait-for-tcp.mjs [port]
 * Env: PORT (default 3111), WAIT_TCP_HOST, WAIT_TCP_MAX_MS, WAIT_TCP_INTERVAL_MS
 */
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const port = Number(process.argv[2] || process.env.PORT || 3111);
const host = process.env.WAIT_TCP_HOST || "127.0.0.1";
const maxMs = Number(process.env.WAIT_TCP_MAX_MS || 120_000);
const intervalMs = Number(process.env.WAIT_TCP_INTERVAL_MS || 300);

const start = Date.now();

function tryOnce() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host }, () => {
      socket.end();
      resolve();
    });
    socket.on("error", reject);
  });
}

while (Date.now() - start < maxMs) {
  try {
    await tryOnce();
    process.exit(0);
  } catch {
    await delay(intervalMs);
  }
}

console.error(
  `[wait-for-tcp] Timed out after ${maxMs}ms waiting for ${host}:${port} (is the API server starting?)`,
);
process.exit(1);
