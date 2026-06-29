import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STYLE_REGISTRY } from '../engine/styleRegistry.js';
import { hasVendoredCsl } from '../engine/phases/csl/engine.js';

/**
 * Surfaces "are we behind upstream citation styles?" to the admin dashboard. Compares the
 * pinned CSL commit (scripts/styles/csl.pinned.json) against upstream HEAD and reports
 * drift, the vendored state, and the styles we track. Cached so the dashboard is fast and
 * does not hammer GitHub; degrades gracefully when offline (drift = unknown). The detailed
 * per-style footprint delta lives in the weekly `csl:sync` PR — this is the at-a-glance flag.
 */

const here = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = resolve(here, '../../scripts/styles/csl.pinned.json');
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const GITHUB_TIMEOUT_MS = 8000;

interface PinnedManifest {
  stylesRepo: string;
  stylesCommit: string;
  localesRepo: string;
  localesCommit: string;
  locale: string;
}

export interface CslStyleSummary {
  engineStyle: string;
  edition: string;
  cslStyleId: string;
}

export interface CslCurrencyStatus {
  pinned: { stylesRepo: string; stylesCommit: string; localesRepo: string; localesCommit: string } | null;
  latest: { stylesCommit: string | null; localesCommit: string | null };
  drift: { styles: boolean | null; locales: boolean | null; any: boolean | null };
  upstreamReachable: boolean;
  vendored: boolean;
  lastCheckedAt: string;
  styles: CslStyleSummary[];
  note: string;
}

let cache: { at: number; status: CslCurrencyStatus } | null = null;

function readManifest(): PinnedManifest | null {
  if (!existsSync(MANIFEST_PATH)) return null;
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as PinnedManifest;
  } catch {
    return null;
  }
}

function styleSummaries(): CslStyleSummary[] {
  return Object.entries(STYLE_REGISTRY).map(([engineStyle, def]) => ({
    engineStyle,
    edition: def.edition,
    cslStyleId: def.cslStyleId,
  }));
}

async function fetchLatestCommit(repo: string): Promise<string | null> {
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'bulkreferences-csl-currency',
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const res = await fetch(`https://api.github.com/repos/${repo}/commits/master`, {
      headers,
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { sha?: string };
    return body.sha ?? null;
  } catch {
    return null;
  }
}

export async function getCslCurrencyStatus(opts: { forceRefresh?: boolean } = {}): Promise<CslCurrencyStatus> {
  if (!opts.forceRefresh && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.status;
  }

  const manifest = readManifest();
  const vendored = hasVendoredCsl();
  const styles = styleSummaries();

  if (!manifest) {
    const status: CslCurrencyStatus = {
      pinned: null,
      latest: { stylesCommit: null, localesCommit: null },
      drift: { styles: null, locales: null, any: null },
      upstreamReachable: false,
      vendored,
      lastCheckedAt: new Date().toISOString(),
      styles,
      note: 'CSL pin manifest not found in this deployment — drift cannot be computed.',
    };
    cache = { at: Date.now(), status };
    return status;
  }

  const [latestStyles, latestLocales] = await Promise.all([
    fetchLatestCommit(manifest.stylesRepo),
    fetchLatestCommit(manifest.localesRepo),
  ]);
  const upstreamReachable = latestStyles != null && latestLocales != null;
  const stylesDrift = latestStyles == null ? null : latestStyles !== manifest.stylesCommit;
  const localesDrift = latestLocales == null ? null : latestLocales !== manifest.localesCommit;
  const anyDrift = stylesDrift == null && localesDrift == null ? null : Boolean(stylesDrift || localesDrift);

  const status: CslCurrencyStatus = {
    pinned: {
      stylesRepo: manifest.stylesRepo,
      stylesCommit: manifest.stylesCommit,
      localesRepo: manifest.localesRepo,
      localesCommit: manifest.localesCommit,
    },
    latest: { stylesCommit: latestStyles, localesCommit: latestLocales },
    drift: { styles: stylesDrift, locales: localesDrift, any: anyDrift },
    upstreamReachable,
    vendored,
    lastCheckedAt: new Date().toISOString(),
    styles,
    note: !upstreamReachable
      ? 'Upstream CSL could not be reached — showing the pinned baseline only.'
      : anyDrift
        ? 'Behind upstream CSL. Run `npm run csl:sync` (or wait for the weekly CSL Sync workflow) to open a pin-bump PR and review the rendering/footprint diff.'
        : 'Up to date with upstream CSL.',
  };
  cache = { at: Date.now(), status };
  return status;
}

/** Test seam: drop the cache so the next call recomputes. */
export function resetCslCurrencyCache(): void {
  cache = null;
}
