// Copy non-TypeScript runtime assets into dist/, mirroring the src/ tree.
//
// `tsc` only emits .js — static assets loaded at runtime via `new URL('./x.txt', import.meta.url)`
// (e.g. the OCR dictionaries in src/engine/ingestion/) are NOT copied by the compiler, so a
// compiled build would silently fail to load them and degrade to a no-op. This post-build step
// copies every such asset so production behaves like dev. Cross-platform (Windows + Linux/Render).
import { readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)); // server/
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');
const ASSET_EXTS = ['.txt'];

let copied = 0;
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!ASSET_EXTS.some((ext) => entry.name.endsWith(ext))) continue;
    const rel = relative(SRC, full);
    const dest = join(DIST, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(full, dest);
    copied += 1;
    console.log(`  copied ${rel}`);
  }
}

try {
  walk(SRC);
  console.log(`copy-assets: ${copied} asset(s) -> dist/`);
} catch (err) {
  console.error('copy-assets failed:', err.message);
  process.exit(1);
}
