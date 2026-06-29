import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { resolveBenchmarkPaths } from "./paths.js";
import type { BenchmarkMode, BenchmarkStyle } from "./types.js";

const require = createRequire(import.meta.url);
let cachedCSL: any = null;
const cachedStyles = new Map<string, string>();
const cachedEngines = new Map<
  string,
  {
    engine: any;
    items: Map<string, Record<string, unknown> & { id: string }>;
  }
>();

const STYLE_FILE_MAP: Record<BenchmarkStyle, string> = {
  apa7: "apa.csl",
  "harvard-ctr": "harvard-cite-them-right.csl",
  "chicago-notes-bib": "chicago-notes-bibliography.csl",
  vancouver: "elsevier-vancouver.csl",
  ieee: "ieee.csl",
  mla9: "modern-language-association.csl",
};

export function renderBenchmarkCslItem(
  item: Record<string, unknown> & { id: string },
  style: BenchmarkStyle,
  mode: BenchmarkMode = "full",
): string {
  const { engine, items } = getCachedEngine(style, mode);
  items.set(item.id, item);
  engine.updateItems([item.id]);
  const bibliography = engine.makeBibliography();
  const formatted = bibliography?.[1]?.[0];
  if (!formatted) {
    throw new Error(`Failed to render CSL item ${item.id} with style ${style}.`);
  }
  return decodeHtmlEntities(formatted.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function requireCiteproc(): any {
  if (cachedCSL) return cachedCSL;
  cachedCSL = require("citeproc");
  return cachedCSL;
}

function getCachedEngine(
  style: BenchmarkStyle,
  mode: BenchmarkMode,
): {
  engine: any;
  items: Map<string, Record<string, unknown> & { id: string }>;
} {
  const cacheKey = `${mode}:${style}`;
  const cached = cachedEngines.get(cacheKey);
  if (cached) return cached;

  const CSL = requireCiteproc();
  const items = new Map<string, Record<string, unknown> & { id: string }>();
  const localeXml = loadLocaleXml(mode);
  const styleXml = loadStyleXml(style, mode);
  const sys = {
    retrieveLocale: () => localeXml,
    retrieveItem: (id: string) => items.get(id) ?? null,
  };
  const created = {
    engine: new CSL.Engine(sys, styleXml),
    items,
  };
  cachedEngines.set(cacheKey, created);
  return created;
}

function loadStyleXml(style: BenchmarkStyle, mode: BenchmarkMode): string {
  const paths = resolveBenchmarkPaths(mode);
  const filename = STYLE_FILE_MAP[style];
  const cacheKey = path.join(paths.stylesDir, filename);
  const cached = cachedStyles.get(cacheKey);
  if (cached) return cached;

  const xml = readFileSync(cacheKey, "utf8");
  cachedStyles.set(cacheKey, xml);
  return xml;
}

function loadLocaleXml(mode: BenchmarkMode): string {
  const paths = resolveBenchmarkPaths(mode);
  const cacheKey = path.join(paths.stylesDir, "locales-en-US.xml");
  const cached = cachedStyles.get(cacheKey);
  if (cached) return cached;
  const xml = readFileSync(cacheKey, "utf8");
  cachedStyles.set(cacheKey, xml);
  return xml;
}

function decodeHtmlEntities(value: string): string {
  let decoded = value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

  decoded = decoded.replace(/&#(\d+);/g, (_, code: string) =>
    String.fromCodePoint(Number.parseInt(code, 10)),
  );
  decoded = decoded.replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
    String.fromCodePoint(Number.parseInt(code, 16)),
  );

  return decoded;
}
