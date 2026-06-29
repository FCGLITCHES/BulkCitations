// One-off: run the engine over the real-input eval corpus and dump per-ref predictions
// to JSON, so an external scorer (the GROBID head-to-head) can score BOTH systems with
// one identical matcher on identical input strings. Read-only; deletable.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

process.env.BULKREFERENCES_ISOLATED_RUNTIME = "true";

const { createPipelineDependencies } = await import("../src/pipeline/dependencies.js");
const { createPipelineContext, runConvertPipeline } = await import("../src/pipeline/orchestrator.js");

const rows = readFileSync(
  "../datasets/engine-v2/gold/real-input/real-input-gold-v1.jsonl",
  "utf8",
).trim().split("\n").map((line) => JSON.parse(line));

const deps = createPipelineDependencies();
const out: unknown[] = [];

for (const row of rows) {
  const ctx = createPipelineContext({ outputStyle: "apa7" });
  let predicted: Record<string, unknown> | null = null;
  try {
    const res = await runConvertPipeline(
      { sourceType: "text", content: row.input, outputStyle: "apa7" } as never,
      ctx,
      deps,
    );
    const fields = (res.response.references[0] as { fields?: Record<string, unknown> } | undefined)?.fields ?? {};
    predicted = {};
    for (const k of Object.keys(fields)) {
      const f = fields[k] as unknown;
      predicted[k] = f && typeof f === "object" && !Array.isArray(f) && "value" in (f as object)
        ? (f as Record<string, unknown>).value
        : f;
    }
  } catch {
    predicted = null;
  }
  out.push({
    input: row.input,
    input_profile: row.input_profile,
    expected_fields: row.expected_fields,
    predicted,
  });
}

mkdirSync("D:/Coding/Bulkreferences/tmp", { recursive: true });
writeFileSync("D:/Coding/Bulkreferences/tmp/real-input-ours.json", JSON.stringify(out), "utf8");
process.stdout.write(`dumped ${out.length} predictions to tmp/real-input-ours.json\n`);
process.exit(0);
