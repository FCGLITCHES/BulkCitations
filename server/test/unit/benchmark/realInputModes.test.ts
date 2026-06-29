import { describe, expect, it } from "vitest";

import {
  applyNumberedMultiline,
  applyOcrArtifacts,
  applyPdfCopyArtifacts,
} from "../../../src/benchmark/realInputModes.js";

const REF =
  "Shannon, C. E. (1948). A Mathematical Theory of Communication. Bell System Technical Journal, 27(3), 379-423.";

/** Reflow a PDF-paste string back the way the engine should: join hyphenated breaks, then collapse newlines. */
function reflow(value: string): string {
  return value.replace(/-\n/g, "").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
}

describe("real input-mode transforms", () => {
  it("is deterministic for a given key", () => {
    expect(applyPdfCopyArtifacts(REF, "rec:apa7")).toBe(applyPdfCopyArtifacts(REF, "rec:apa7"));
    expect(applyOcrArtifacts(REF, "rec:apa7")).toBe(applyOcrArtifacts(REF, "rec:apa7"));
    expect(applyNumberedMultiline(REF, "rec:apa7", 3)).toBe(
      applyNumberedMultiline(REF, "rec:apa7", 3),
    );
  });

  it("varies by key", () => {
    expect(applyPdfCopyArtifacts(REF, "a")).not.toBe(applyPdfCopyArtifacts(REF, "b"));
  });

  it("pdf copy introduces line breaks and stays content-recoverable", () => {
    const out = applyPdfCopyArtifacts(REF, "rec:apa7");
    expect(out).toContain("\n");
    // De-hyphenating + reflowing should recover the original (no field content lost).
    expect(reflow(out)).toBe(REF.replace(/\s+/g, " ").trim());
  });

  it("ocr degrades some characters but not the whole string", () => {
    const out = applyOcrArtifacts(REF, "rec:apa7");
    expect(out).not.toBe(REF);
    // Length stays close (single-char substitutions, not wholesale rewrite).
    expect(Math.abs(out.length - REF.length)).toBeLessThan(REF.length * 0.2);
    // Majority of the string is untouched (low substitution rate).
    let common = 0;
    for (let i = 0; i < Math.min(out.length, REF.length); i += 1) {
      if (out[i] === REF[i]) common += 1;
    }
    expect(common).toBeGreaterThan(REF.length * 0.6);
  });

  it("numbered multiline prefixes an enumerator", () => {
    const out = applyNumberedMultiline(REF, "rec:apa7", 4);
    expect(/^(?:5\.|\[5\])\s/.test(out)).toBe(true);
    // Same content-recoverability after stripping the marker + reflow.
    const body = out.replace(/^(?:\d+\.|\[\d+\])\s/, "");
    expect(reflow(body)).toBe(REF.replace(/\s+/g, " ").trim());
  });
});
