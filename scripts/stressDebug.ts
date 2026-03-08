/**
 * Phase 0 mini harness: sends only the DEBUG_IDS cases to the API one at a time,
 * writes stress-debug.json. Run with server in debug mode (DEBUG_STRESS=1) so server
 * logs contain exactly 15 trace blocks in sequence.
 * Usage: npm run stress:debug (with server running: DEBUG_STRESS=1 npm run dev)
 */

import fs from "fs";
import path from "path";
import { getCasesForDebug, DEBUG_IDS, API_BASE } from "./stressFinale1000";

type ApiReference = {
  convertedText: string;
  referenceType: string;
  parsedData: Record<string, unknown>;
  inputStyle: string;
};

type DebugEntry = {
  id: string;
  rawInput: string;
  detectedStyle: string;
  parsedIntermediate: Record<string, unknown>;
  finalOutput: {
    year?: string;
    title?: string;
    venue?: string;
    firstAuthor?: string;
    referenceType?: string;
    output: string;
  };
};

async function run() {
  console.log("Loading case list (same as stress:finale)...");
  const cases = await getCasesForDebug();
  const debugCases = cases.filter((c) => DEBUG_IDS.includes(c.id));
  console.log(`Filtered to ${debugCases.length} debug IDs: ${DEBUG_IDS.join(", ")}`);

  const entries: DebugEntry[] = [];

  for (let i = 0; i < debugCases.length; i++) {
    const tc = debugCases[i];
    const body = {
      references: [tc.raw],
      inputStyle: "auto",
      outputStyle: "apa",
      isPro: false,
      enrichWithAuthority: false,
    };
    const res = await fetch(`${API_BASE}/api/convert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`API failed for ${tc.id}: ${res.status} ${res.statusText}`);
    }
    const payload = (await res.json()) as { convertedReferences: ApiReference[] };
    const ref = payload.convertedReferences?.[0];
    if (!ref) {
      entries.push({
        id: tc.id,
        rawInput: tc.raw,
        detectedStyle: "",
        parsedIntermediate: {},
        finalOutput: { output: "" },
      });
      continue;
    }
    const parsed = (ref.parsedData || {}) as Record<string, unknown>;
    entries.push({
      id: tc.id,
      rawInput: tc.raw,
      detectedStyle: ref.inputStyle || "",
      parsedIntermediate: parsed,
      finalOutput: {
        year: parsed.year as string | undefined,
        title: parsed.title as string | undefined,
        venue: (parsed.conferenceTitle || parsed.journal || parsed.bookTitle) as string | undefined,
        firstAuthor: (Array.isArray(parsed.authors) ? parsed.authors[0] : undefined) as string | undefined,
        referenceType: ref.referenceType,
        output: ref.convertedText || "",
      },
    });
  }

  const outPath = path.resolve(process.cwd(), "stress-debug.json");
  fs.writeFileSync(outPath, JSON.stringify(entries, null, 2), "utf8");
  console.log(`Wrote ${entries.length} entries to ${outPath}`);
  console.log("Run server with DEBUG_STRESS=1 and this script; server logs will match by request order.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
