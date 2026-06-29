import type { FastifyInstance } from 'fastify';
import { sql, gte, lte, and, isNotNull } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { jobs as jobsTable, users as usersTable, egressRollupsDaily as egressRollupsDailyTable } from '../db/schema.js';
import type { StoredJob } from '../runtime/store.js';
import type { ProcessedCitation } from '../engine/types/citation.js';
import {
  listCorrections,
  listJobs,
  listReports,
  listEgressDaily,
  runtimePersistenceBackend,
} from '../runtime/persistence.js';

export interface AnalyticsSummaryResponse {
  window: { days: number; from: string; to: string };
  pipeline: {
    totalJobs: number;
    jobsByStatus: Record<string, number>;
    totalCitations: number;
    citationsByStatus: Record<string, number>;
    avgRefsPerJob: number;
    avgJobDurationMs: number | null;
    queueDepth: number;
  };
  quality: {
    correctionRate: number;
    needsReviewCount: number;
    needsActionCount: number;
    highConfidenceRate: number;
  };
  providers: {
    crossref: { calls: number; cacheHitRate: number; avgResponseBytes: number };
    openalex: { calls: number; cacheHitRate: number; avgResponseBytes: number };
    openai: { calls: number; promptTokens: number; completionTokens: number };
    ml: { calls: number; avgBatchSize: number };
  };
  reports: {
    total: number;
    pending: number;
    accepted: number;
    rejected: number;
    duplicate: number;
    resolutionRatePercent: number;
    avgResolutionHours: number | null;
  };
  users: {
    total: number;
    newInWindow: number;
    activeInWindow: number;
    byPlan: Record<string, number>;
  };
  egress: {
    dailyBuckets: Array<{ date: string; bytes: number; citations: number }>;
    totalBytesInWindow: number;
    avgBytesPerCitation: number;
  };
  timeSeries: {
    jobs: Array<{ date: string; count: number }>;
    citations: Array<{ date: string; count: number }>;
    errors: Array<{ date: string; count: number }>;
  };
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addCount(acc: Record<string, number>, key: string, delta = 1): void {
  acc[key] = (acc[key] ?? 0) + delta;
}

function citationsFromJobs(jobs: StoredJob[]): ProcessedCitation[] {
  return jobs.flatMap((j) => j.result?.references ?? []);
}

function emptyProviders(): AnalyticsSummaryResponse['providers'] {
  return {
    crossref: { calls: 0, cacheHitRate: 0, avgResponseBytes: 0 },
    openalex: { calls: 0, cacheHitRate: 0, avgResponseBytes: 0 },
    openai: { calls: 0, promptTokens: 0, completionTokens: 0 },
    ml: { calls: 0, avgBatchSize: 0 },
  };
}

async function aggregateEgressProvidersForWindow(
  from: Date,
  to: Date,
): Promise<AnalyticsSummaryResponse['providers']> {
  const out = emptyProviders();
  const byProvider: Record<
    string,
    { calls: number; cacheHits: number; responseBytes: number }
  > = {};

  for (let t = new Date(from); t <= to; t.setDate(t.getDate() + 1)) {
    const period = dayKey(t);
    const rows = await listEgressDaily(period);
    for (const r of rows) {
      const p = r.provider.toLowerCase();
      if (!byProvider[p]) {
        byProvider[p] = { calls: 0, cacheHits: 0, responseBytes: 0 };
      }
      byProvider[p].calls += r.calls;
      byProvider[p].cacheHits += r.cacheHits;
      byProvider[p].responseBytes += r.responseBodyBytes;
    }
  }

  const fill = (name: 'crossref' | 'openalex', key: string) => {
    const b = byProvider[key];
    if (!b || b.calls === 0) return;
    out[name].calls = b.calls;
    out[name].cacheHitRate = b.cacheHits / b.calls;
    out[name].avgResponseBytes = Math.round(b.responseBytes / b.calls);
  };

  fill('crossref', 'crossref');
  fill('openalex', 'openalex');

  const openai = byProvider['openai'];
  if (openai && openai.calls > 0) {
    out.openai.calls = openai.calls;
    out.openai.promptTokens = Math.round(openai.responseBytes / 2);
    out.openai.completionTokens = Math.round(openai.responseBytes / 2);
  }

  const ml = byProvider['ml'] ?? byProvider['shadow'] ?? byProvider['grobid'];
  if (ml && ml.calls > 0) {
    out.ml.calls = ml.calls;
    out.ml.avgBatchSize = 1;
  }

  return out;
}

async function aggregateEgressFromDb(
  from: Date,
  to: Date,
): Promise<{ providers: AnalyticsSummaryResponse['providers']; dailyBuckets: AnalyticsSummaryResponse['egress']['dailyBuckets'] }> {
  const providers = emptyProviders();
  const dailyMap = new Map<string, { bytes: number; citations: number }>();

  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  const rows = await db
    .select({
      period: egressRollupsDailyTable.period,
      provider: egressRollupsDailyTable.provider,
      calls: egressRollupsDailyTable.calls,
      cacheHits: egressRollupsDailyTable.cacheHits,
      responseBodyBytes: egressRollupsDailyTable.responseBodyBytes,
    })
    .from(egressRollupsDailyTable)
    .where(
      and(
        gte(egressRollupsDailyTable.period, fromStr),
        lte(egressRollupsDailyTable.period, toStr),
      ),
    );

  const byProvider: Record<string, { calls: number; cacheHits: number; responseBytes: number }> = {};

  for (const r of rows) {
    const dateStr =
      typeof r.period === 'string' ? r.period : (r.period as Date).toISOString().slice(0, 10);
    const bytes = (r.responseBodyBytes ?? 0) + 0;
    const prev = dailyMap.get(dateStr) ?? { bytes: 0, citations: 0 };
    prev.bytes += bytes;
    prev.citations += r.calls ?? 0;
    dailyMap.set(dateStr, prev);

    const p = (r.provider ?? '').toLowerCase();
    if (!byProvider[p]) {
      byProvider[p] = { calls: 0, cacheHits: 0, responseBytes: 0 };
    }
    byProvider[p].calls += r.calls ?? 0;
    byProvider[p].cacheHits += r.cacheHits ?? 0;
    byProvider[p].responseBytes += r.responseBodyBytes ?? 0;
  }

  const setProv = (name: 'crossref' | 'openalex', key: string) => {
    const b = byProvider[key];
    if (!b || b.calls === 0) return;
    providers[name].calls = b.calls;
    providers[name].cacheHitRate = b.cacheHits / b.calls;
    providers[name].avgResponseBytes = Math.round(b.responseBytes / b.calls);
  };
  setProv('crossref', 'crossref');
  setProv('openalex', 'openalex');

  const oa = byProvider['openai'];
  if (oa && oa.calls > 0) {
    providers.openai.calls = oa.calls;
    providers.openai.promptTokens = Math.round(oa.responseBytes / 4);
    providers.openai.completionTokens = Math.round(oa.responseBytes / 4);
  }

  const ml = byProvider['ml'] ?? byProvider['shadow'];
  if (ml && ml.calls > 0) {
    providers.ml.calls = ml.calls;
    providers.ml.avgBatchSize = 1;
  }

  const dailyBuckets = [...dailyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, bytes: v.bytes, citations: v.citations }));

  return { providers, dailyBuckets };
}

function buildTimeSeriesFromJobs(
  windowJobs: StoredJob[],
  from: Date,
): AnalyticsSummaryResponse['timeSeries'] {
  const jobsByDay = new Map<string, number>();
  const citsByDay = new Map<string, number>();
  const errByDay = new Map<string, number>();

  for (const j of windowJobs) {
    const d = dayKey(new Date(j.createdAt));
    jobsByDay.set(d, (jobsByDay.get(d) ?? 0) + 1);
    const refs = j.result?.references ?? [];
    citsByDay.set(d, (citsByDay.get(d) ?? 0) + refs.length);
    const citeErrs = refs.filter((c) => c.status === 'error').length;
    const jobFail = j.status === 'failed' ? 1 : 0;
    errByDay.set(d, (errByDay.get(d) ?? 0) + citeErrs + jobFail);
  }

  const days: string[] = [];
  for (let t = new Date(from); t <= new Date(); t.setDate(t.getDate() + 1)) {
    days.push(dayKey(t));
  }

  const series = (m: Map<string, number>) =>
    days.map((date) => ({ date, count: m.get(date) ?? 0 }));

  return {
    jobs: series(jobsByDay),
    citations: series(citsByDay),
    errors: series(errByDay),
  };
}

export async function adminAnalyticsRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { days?: string } }>('/admin/analytics/summary', async (req, reply) => {
    const rawDays = Number.parseInt(String(req.query.days ?? '30'), 10);
    const days = Number.isFinite(rawDays) ? Math.min(Math.max(rawDays, 1), 90) : 30;
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);

    const allJobs = await listJobs();
    const windowJobs = allJobs.filter((j) => new Date(j.createdAt) >= from);

    const jobsByStatus: Record<string, number> = {};
    for (const j of windowJobs) {
      addCount(jobsByStatus, j.status);
    }

    const refs = citationsFromJobs(windowJobs);
    const citationsByStatus: Record<string, number> = {};
    for (const c of refs) {
      addCount(citationsByStatus, c.publicStatus);
      if (c.status === 'error') {
        addCount(citationsByStatus, 'error');
      }
    }

    const totalCitations = refs.length;
    const avgRefsPerJob =
      windowJobs.length > 0 ? Math.round((totalCitations / windowJobs.length) * 10) / 10 : 0;

    const durations = windowJobs
      .filter((j) => j.completedAt && j.createdAt)
      .map((j) => new Date(j.completedAt!).getTime() - new Date(j.createdAt).getTime());
    const avgJobDurationMs =
      durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

    const queueDepth = allJobs.filter((j) => j.status === 'pending' || j.status === 'processing')
      .length;

    const needsReviewCount = refs.filter((c) => c.publicStatus === 'needs_review').length;
    const needsActionCount = refs.filter((c) => c.publicStatus === 'needs_action').length;
    const highConf = refs.filter((c) => c.displayScore >= 85).length;

    const allCorrections = await listCorrections();
    const windowCorrections = allCorrections.filter((c) => new Date(c.createdAt) >= from);
    const correctionRate = totalCitations > 0 ? windowCorrections.length / totalCitations : 0;

    const allReports = await listReports();
    const windowReports = allReports.filter((r) => new Date(r.createdAt) >= from);
    const repByStatus: Record<string, number> = {};
    for (const r of windowReports) {
      addCount(repByStatus, r.status);
    }
    const nonPending = windowReports.filter((r) => r.status !== 'pending').length;
    const resolutionRatePercent =
      windowReports.length > 0 ? (nonPending / windowReports.length) * 100 : 0;

    let usersBlock: AnalyticsSummaryResponse['users'] = {
      total: 0,
      newInWindow: 0,
      activeInWindow: 0,
      byPlan: {},
    };

    if (runtimePersistenceBackend === 'database') {
      const totalRow = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(usersTable);
      const newRow = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(usersTable)
        .where(gte(usersTable.createdAt, from));

      const byTier = await db
        .select({
          tier: usersTable.tier,
          n: sql<number>`count(*)::int`,
        })
        .from(usersTable)
        .groupBy(usersTable.tier);

      const activeRow = await db
        .select({ n: sql<number>`count(distinct ${jobsTable.userId})::int` })
        .from(jobsTable)
        .where(and(gte(jobsTable.createdAt, from), isNotNull(jobsTable.userId)));

      const byPlan: Record<string, number> = {};
      for (const row of byTier) {
        const k = row.tier ?? 'free';
        byPlan[k] = row.n;
      }

      usersBlock = {
        total: totalRow[0]?.n ?? 0,
        newInWindow: newRow[0]?.n ?? 0,
        activeInWindow: activeRow[0]?.n ?? 0,
        byPlan,
      };
    }

    let egressBlock: AnalyticsSummaryResponse['egress'] = {
      dailyBuckets: [],
      totalBytesInWindow: 0,
      avgBytesPerCitation: 0,
    };

    let providers = emptyProviders();

    if (runtimePersistenceBackend === 'database') {
      try {
        const eg = await aggregateEgressFromDb(from, to);
        providers = eg.providers;
        const totalBytes = eg.dailyBuckets.reduce((s, b) => s + b.bytes, 0);
        const totalCit = eg.dailyBuckets.reduce((s, b) => s + b.citations, 0);
        egressBlock = {
          dailyBuckets: eg.dailyBuckets,
          totalBytesInWindow: totalBytes,
          avgBytesPerCitation: totalCit > 0 ? totalBytes / totalCit : 0,
        };
      } catch {
        providers = await aggregateEgressProvidersForWindow(from, to);
      }
    } else {
      providers = await aggregateEgressProvidersForWindow(from, to);
      const dailyBuckets: AnalyticsSummaryResponse['egress']['dailyBuckets'] = [];
      for (let t = new Date(from); t <= to; t.setDate(t.getDate() + 1)) {
        const period = dayKey(t);
        const rows = await listEgressDaily(period);
        let bytes = 0;
        let citations = 0;
        for (const r of rows) {
          bytes += r.responseBodyBytes + r.requestBodyBytes;
          citations += r.calls;
        }
        dailyBuckets.push({ date: period, bytes, citations });
      }
      const totalBytes = dailyBuckets.reduce((s, b) => s + b.bytes, 0);
      const totalCit = dailyBuckets.reduce((s, b) => s + b.citations, 0);
      egressBlock = {
        dailyBuckets,
        totalBytesInWindow: totalBytes,
        avgBytesPerCitation: totalCit > 0 ? totalBytes / totalCit : 0,
      };
    }

    const timeSeries = buildTimeSeriesFromJobs(windowJobs, from);

    const body: AnalyticsSummaryResponse = {
      window: {
        days,
        from: from.toISOString(),
        to: to.toISOString(),
      },
      pipeline: {
        totalJobs: windowJobs.length,
        jobsByStatus,
        totalCitations,
        citationsByStatus,
        avgRefsPerJob,
        avgJobDurationMs,
        queueDepth,
      },
      quality: {
        correctionRate,
        needsReviewCount,
        needsActionCount,
        highConfidenceRate: totalCitations > 0 ? highConf / totalCitations : 0,
      },
      providers,
      reports: {
        total: windowReports.length,
        pending: repByStatus.pending ?? 0,
        accepted: repByStatus.accepted ?? 0,
        rejected: repByStatus.rejected ?? 0,
        duplicate: repByStatus.duplicate ?? 0,
        resolutionRatePercent,
        avgResolutionHours: null,
      },
      users: usersBlock,
      egress: egressBlock,
      timeSeries,
    };

    return reply.status(200).send(body);
  });
}
