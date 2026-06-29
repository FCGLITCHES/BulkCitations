import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const currentBundleDir = join(root, "ml-service", "models", "current");

function isTruthy(value) {
  return value === "1" || value === "true" || value === "yes";
}

function run(command, args) {
  return spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: command === "pnpm",
    env: {
      ...process.env,
      ML_ALLOW_BOOTSTRAP_BUNDLE: process.env.ML_ALLOW_BOOTSTRAP_BUNDLE ?? "1",
    },
  });
}

if (process.env.NODE_ENV === "production") {
  console.log("[ml-bootstrap] Skipping bootstrap bundle generation in production.");
  process.exit(0);
}

if (isTruthy((process.env.BR_SKIP_BOOTSTRAP_BUNDLE ?? "").toLowerCase())) {
  console.log("[ml-bootstrap] Skipping bootstrap bundle generation because BR_SKIP_BOOTSTRAP_BUNDLE is set.");
  process.exit(0);
}

if (existsSync(currentBundleDir)) {
  const validation = run("python", ["ml-service/tools/validate_bundle.py", currentBundleDir]);
  if (validation.status === 0) {
    console.log("[ml-bootstrap] Current ONNX bundle is already valid. No bootstrap generation needed.");
    process.exit(0);
  }
  console.warn("[ml-bootstrap] Current bundle is missing or invalid. Regenerating a development bootstrap bundle.");
} else {
  console.log("[ml-bootstrap] No current ONNX bundle found. Generating a development bootstrap bundle.");
}

const generate = run("pnpm", ["run", "training:bootstrap-bundle"]);
if (generate.status !== 0) {
  console.warn("[ml-bootstrap] Bootstrap bundle generation failed. Dev will continue on heuristics.");
  if (isTruthy((process.env.BR_STRICT_BOOTSTRAP_BUNDLE ?? "").toLowerCase())) {
    process.exit(generate.status ?? 1);
  }
  process.exit(0);
}

const promote = run("python", ["ml-service/tools/promote_bundle.py", "bootstrap-fixture-onnx-v1"]);
if (promote.status !== 0) {
  console.warn("[ml-bootstrap] Bootstrap bundle promotion failed. Dev will continue on heuristics.");
  if (isTruthy((process.env.BR_STRICT_BOOTSTRAP_BUNDLE ?? "").toLowerCase())) {
    process.exit(promote.status ?? 1);
  }
  process.exit(0);
}

console.log("[ml-bootstrap] Development bootstrap bundle is ready under ml-service/models/current.");
