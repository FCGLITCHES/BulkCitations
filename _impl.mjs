import fs from "fs";
import path from "path";
const root = "D:/Coding/Bulkreferences/server/src/training";
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, "truthHash.ts"), `import { createHash } from "node:crypto";

export function normalizeRawTextForTruth(raw: string): string {
  return raw.trim().replace(/\\s+/g, " ");
}

export function hashInputForTruth(raw: string): string {
  return createHash("sha256").update(normalizeRawTextForTruth(raw), "utf8").digest("hex");
}
`);
console.log("truthHash ok");
