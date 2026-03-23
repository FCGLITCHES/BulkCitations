import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import {
  appendJsonlFile,
  readJsonlFile,
  resolveDataFile,
} from './persistence.js';
import { createPostgresPoolConfig, getUsableDatabaseUrl } from './databaseUrl.js';

export type AnalyticsEventType =
  | 'page_view'
  | 'converter_started'
  | 'converter_completed'
  | 'converter_failed';

export type AnalyticsMetadataValue = string | number | boolean | null;
type AnalyticsEngine = AnalyticsSummary['engines'][number]['engine'];

export interface SiteAnalyticsEvent {
  id: string;
  visitorId: string;
  eventType: AnalyticsEventType;
  path: string;
  countryCode: string;
  createdAt: string;
  metadata?: Record<string, AnalyticsMetadataValue>;
}

export interface AnalyticsSummary {
  generatedAt: string;
  windowDays: number;
  windowStart: string;
  users: {
    active: number;
    new: number;
    returning: number;
  };
  traffic: {
    views: number;
  };
  sessions: {
    total: number;
  };
  converter: {
    starts: number;
    completed: number;
    failed: number;
    startRate: number | null;
    completionRate: number | null;
    averageCitationsPerStart: number | null;
    averageDurationMs: number | null;
  };
  quality: {
    clean: number;
    review: number;
    actionNeeded: number;
    warnings: number;
    styleDetectionFailed: number;
  };
  engines: Array<{
    engine: 'v1' | 'v2' | 'unknown';
    starts: number;
    completed: number;
    failed: number;
  }>;
  countries: Array<{
    code: string;
    name: string;
    activeUsers: number;
    newUsers: number;
    views: number;
    converterStarts: number;
    completed: number;
    failed: number;
  }>;
  routes: Array<{
    routeName: string;
    path: string;
    views: number;
    converterStarts: number;
    completed: number;
    failed: number;
  }>;
  referrers: Array<{
    host: string;
    visitors: number;
    views: number;
    converterStarts: number;
  }>;
  devices: Array<{
    deviceType: string;
    users: number;
    views: number;
    converterStarts: number;
    completed: number;
  }>;
  browsers: Array<{
    browser: string;
    users: number;
    views: number;
    converterStarts: number;
  }>;
  operatingSystems: Array<{
    operatingSystem: string;
    users: number;
    views: number;
    converterStarts: number;
  }>;
  languages: Array<{
    language: string;
    users: number;
    views: number;
  }>;
  hostnames: Array<{
    hostname: string;
    views: number;
    converterStarts: number;
  }>;
  countrySources: Array<{
    source: string;
    events: number;
  }>;
  surfaces: Array<{
    surface: string;
    views: number;
    converterStarts: number;
  }>;
  lifetime: {
    visitors: number;
    sessions: number;
    views: number;
    converterStarts: number;
    completed: number;
  };
}

interface IAnalyticsStore {
  trackEvent(event: SiteAnalyticsEvent): Promise<void>;
  loadEvents(): Promise<SiteAnalyticsEvent[]>;
}

const ANALYTICS_FILE = resolveDataFile('site-analytics.v1.jsonl');

const analyticsRows = pgTable('site_analytics_events', {
  id: text('id').primaryKey(),
  visitorId: text('visitor_id').notNull(),
  eventType: text('event_type').notNull(),
  path: text('path').notNull(),
  countryCode: text('country_code').notNull(),
  metadata: jsonb('metadata').$type<Record<string, AnalyticsMetadataValue> | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

function cloneEvent(event: SiteAnalyticsEvent): SiteAnalyticsEvent {
  return {
    ...event,
    metadata: event.metadata ? { ...event.metadata } : undefined,
  };
}

class FileAnalyticsStore implements IAnalyticsStore {
  private cachedEvents: SiteAnalyticsEvent[] | null = null;

  private readEvents(): SiteAnalyticsEvent[] {
    if (this.cachedEvents) {
      return this.cachedEvents.map((event) => cloneEvent(event));
    }

    const rows = readJsonlFile<SiteAnalyticsEvent>(ANALYTICS_FILE);
    this.cachedEvents = rows;
    return rows.map((event) => cloneEvent(event));
  }

  async trackEvent(event: SiteAnalyticsEvent): Promise<void> {
    appendJsonlFile(ANALYTICS_FILE, event);
    if (this.cachedEvents) {
      this.cachedEvents.push(cloneEvent(event));
    }
  }

  async loadEvents(): Promise<SiteAnalyticsEvent[]> {
    return this.readEvents();
  }
}

class PostgresAnalyticsStore implements IAnalyticsStore {
  private db;
  private ready: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.db = drizzle({ connection: createPostgresPoolConfig(connectionString) });
  }

  private async ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = this.db.execute(sql`
        create table if not exists site_analytics_events (
          id text primary key,
          visitor_id text not null,
          event_type text not null,
          path text not null,
          country_code text not null,
          metadata jsonb,
          created_at timestamptz not null
        )
      `).then(() => undefined);
    }
    await this.ready;
  }

  async trackEvent(event: SiteAnalyticsEvent): Promise<void> {
    await this.ensureReady();
    await this.db.insert(analyticsRows).values({
      id: event.id,
      visitorId: event.visitorId,
      eventType: event.eventType,
      path: event.path,
      countryCode: event.countryCode,
      metadata: event.metadata ?? null,
      createdAt: new Date(event.createdAt),
    }).onConflictDoNothing();
  }

  async loadEvents(): Promise<SiteAnalyticsEvent[]> {
    await this.ensureReady();
    const rows = await this.db.select().from(analyticsRows);
    return rows.map((row) => ({
      id: row.id,
      visitorId: row.visitorId,
      eventType: row.eventType as AnalyticsEventType,
      path: row.path,
      countryCode: row.countryCode,
      createdAt: row.createdAt.toISOString(),
      metadata: row.metadata ?? undefined,
    }));
  }
}

class ResilientAnalyticsStore implements IAnalyticsStore {
  private primary: IAnalyticsStore;
  private fallback: IAnalyticsStore;
  private usingFallback = false;

  constructor(primary: IAnalyticsStore, fallback: IAnalyticsStore) {
    this.primary = primary;
    this.fallback = fallback;
  }

  private shouldFallback(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /Error connecting to database|fetch failed|ECONNRESET|ENOTFOUND|ETIMEDOUT|connection/i.test(message);
  }

  private async runWithFallback<T>(operation: (store: IAnalyticsStore) => Promise<T>): Promise<T> {
    if (this.usingFallback) {
      return operation(this.fallback);
    }

    try {
      return await operation(this.primary);
    } catch (error) {
      if (!this.shouldFallback(error)) {
        throw error;
      }
      this.usingFallback = true;
      console.warn('[analyticsStore] Database unavailable, falling back to local analytics storage:', error instanceof Error ? error.message : String(error));
      return operation(this.fallback);
    }
  }

  async trackEvent(event: SiteAnalyticsEvent): Promise<void> {
    return this.runWithFallback((store) => store.trackEvent(event));
  }

  async loadEvents(): Promise<SiteAnalyticsEvent[]> {
    return this.runWithFallback((store) => store.loadEvents());
  }
}

function countryDisplayName(code: string): string {
  if (!code || code === 'unknown') return 'Unknown';
  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
    return displayNames.of(code) ?? code;
  } catch {
    return code;
  }
}

function roundMetric(value: number | null): number | null {
  if (value == null || Number.isNaN(value)) return null;
  return Number(value.toFixed(2));
}

function getMetadataString(
  metadata: Record<string, AnalyticsMetadataValue> | undefined,
  key: string,
  fallback = 'unknown',
): string {
  const value = metadata?.[key];
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function getMetadataNumber(
  metadata: Record<string, AnalyticsMetadataValue> | undefined,
  key: string,
): number | null {
  const value = metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeAnalyticsEngine(value: AnalyticsMetadataValue | undefined): AnalyticsEngine {
  if (value === 'v1' || value === 'v2') return value;
  return 'unknown';
}

function summarizeAnalytics(events: SiteAnalyticsEvent[], windowDays: number): AnalyticsSummary {
  const generatedAt = new Date().toISOString();
  const windowStartMs = Date.now() - (windowDays * 24 * 60 * 60 * 1000);
  const windowStart = new Date(windowStartMs).toISOString();
  const sortedEvents = [...events].sort((left, right) => (
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  ));

  const visitorProfiles = new Map<string, {
    firstSeenAtMs: number;
    firstCountryCode: string;
    lastSeenAtMs: number;
  }>();

  for (const event of sortedEvents) {
    const createdAtMs = new Date(event.createdAt).getTime();
    const existing = visitorProfiles.get(event.visitorId);
    if (!existing) {
      visitorProfiles.set(event.visitorId, {
        firstSeenAtMs: createdAtMs,
        firstCountryCode: event.countryCode,
        lastSeenAtMs: createdAtMs,
      });
      continue;
    }

    if (createdAtMs < existing.firstSeenAtMs) {
      existing.firstSeenAtMs = createdAtMs;
      existing.firstCountryCode = event.countryCode;
    }
    if (createdAtMs > existing.lastSeenAtMs) {
      existing.lastSeenAtMs = createdAtMs;
    }
  }

  const windowEvents = sortedEvents.filter((event) => new Date(event.createdAt).getTime() >= windowStartMs);
  const activeVisitors = new Set(windowEvents.map((event) => event.visitorId));
  const activeSessions = new Set(
    windowEvents
      .map((event) => getMetadataString(event.metadata, 'sessionId', 'unknown'))
      .filter((sessionId) => sessionId !== 'unknown'),
  );
  const newVisitors = new Set(
    [...activeVisitors].filter((visitorId) => (visitorProfiles.get(visitorId)?.firstSeenAtMs ?? 0) >= windowStartMs),
  );

  const countries = new Map<string, {
    activeUsers: Set<string>;
    newUsers: Set<string>;
    views: number;
    converterStarts: number;
    completed: number;
    failed: number;
  }>();
  const engines = new Map<'v1' | 'v2' | 'unknown', {
    starts: number;
    completed: number;
    failed: number;
  }>();
  const routes = new Map<string, {
    routeName: string;
    path: string;
    views: number;
    converterStarts: number;
    completed: number;
    failed: number;
  }>();
  const referrers = new Map<string, {
    visitors: Set<string>;
    views: number;
    converterStarts: number;
  }>();
  const devices = new Map<string, {
    users: Set<string>;
    views: number;
    converterStarts: number;
    completed: number;
  }>();
  const browsers = new Map<string, {
    users: Set<string>;
    views: number;
    converterStarts: number;
  }>();
  const operatingSystems = new Map<string, {
    users: Set<string>;
    views: number;
    converterStarts: number;
  }>();
  const languages = new Map<string, {
    users: Set<string>;
    views: number;
  }>();
  const hostnames = new Map<string, {
    views: number;
    converterStarts: number;
  }>();
  const countrySources = new Map<string, number>();
  const surfaces = new Map<string, {
    views: number;
    converterStarts: number;
  }>();

  let views = 0;
  let converterStarts = 0;
  let converterCompleted = 0;
  let converterFailed = 0;
  let totalCitationCount = 0;
  let citationCountSamples = 0;
  let totalDurationMs = 0;
  let durationSamples = 0;
  let qualityClean = 0;
  let qualityReview = 0;
  let qualityActionNeeded = 0;
  let qualityWarnings = 0;
  let qualityStyleDetectionFailed = 0;

  for (const event of windowEvents) {
    const countryCode = event.countryCode || 'unknown';
    const countryBucket = countries.get(countryCode) ?? {
      activeUsers: new Set<string>(),
      newUsers: new Set<string>(),
      views: 0,
      converterStarts: 0,
      completed: 0,
      failed: 0,
    };

    countryBucket.activeUsers.add(event.visitorId);
    countries.set(countryCode, countryBucket);

    const engine = normalizeAnalyticsEngine(event.metadata?.engineVersion);
    const engineBucket = engines.get(engine) ?? { starts: 0, completed: 0, failed: 0 };
    const routeName = getMetadataString(event.metadata, 'routeName', event.path || '/');
    const routeKey = `${routeName}:${event.path}`;
    const routeBucket = routes.get(routeKey) ?? {
      routeName,
      path: event.path,
      views: 0,
      converterStarts: 0,
      completed: 0,
      failed: 0,
    };
    const referrerHost = getMetadataString(event.metadata, 'referrerHost', 'direct');
    const referrerBucket = referrers.get(referrerHost) ?? {
      visitors: new Set<string>(),
      views: 0,
      converterStarts: 0,
    };
    const deviceType = getMetadataString(event.metadata, 'deviceType');
    const deviceBucket = devices.get(deviceType) ?? {
      users: new Set<string>(),
      views: 0,
      converterStarts: 0,
      completed: 0,
    };
    const browser = getMetadataString(event.metadata, 'browser');
    const browserBucket = browsers.get(browser) ?? {
      users: new Set<string>(),
      views: 0,
      converterStarts: 0,
    };
    const operatingSystem = getMetadataString(event.metadata, 'operatingSystem');
    const osBucket = operatingSystems.get(operatingSystem) ?? {
      users: new Set<string>(),
      views: 0,
      converterStarts: 0,
    };
    const language = getMetadataString(event.metadata, 'language');
    const languageBucket = languages.get(language) ?? {
      users: new Set<string>(),
      views: 0,
    };
    const hostname = getMetadataString(event.metadata, 'hostname');
    const hostnameBucket = hostnames.get(hostname) ?? {
      views: 0,
      converterStarts: 0,
    };
    const countrySource = getMetadataString(event.metadata, 'countryHeaderSource', 'none');
    countrySources.set(countrySource, (countrySources.get(countrySource) ?? 0) + 1);
    const surface = getMetadataString(event.metadata, 'surface', 'unknown');
    const surfaceBucket = surfaces.get(surface) ?? {
      views: 0,
      converterStarts: 0,
    };

    referrerBucket.visitors.add(event.visitorId);
    deviceBucket.users.add(event.visitorId);
    browserBucket.users.add(event.visitorId);
    osBucket.users.add(event.visitorId);
    languageBucket.users.add(event.visitorId);

    if (event.eventType === 'page_view') {
      views += 1;
      countryBucket.views += 1;
      routeBucket.views += 1;
      referrerBucket.views += 1;
      deviceBucket.views += 1;
      browserBucket.views += 1;
      osBucket.views += 1;
      languageBucket.views += 1;
      hostnameBucket.views += 1;
      surfaceBucket.views += 1;
    }

    if (event.eventType === 'converter_started') {
      converterStarts += 1;
      countryBucket.converterStarts += 1;
      engineBucket.starts += 1;
      routeBucket.converterStarts += 1;
      referrerBucket.converterStarts += 1;
      deviceBucket.converterStarts += 1;
      browserBucket.converterStarts += 1;
      osBucket.converterStarts += 1;
      hostnameBucket.converterStarts += 1;
      surfaceBucket.converterStarts += 1;
      const citationCount = typeof event.metadata?.citationCount === 'number'
        ? event.metadata.citationCount
        : null;
      if (citationCount != null && Number.isFinite(citationCount) && citationCount > 0) {
        totalCitationCount += citationCount;
        citationCountSamples += 1;
      }
    }

    if (event.eventType === 'converter_completed') {
      converterCompleted += 1;
      countryBucket.completed += 1;
      engineBucket.completed += 1;
      routeBucket.completed += 1;
      deviceBucket.completed += 1;
      const durationMs = getMetadataNumber(event.metadata, 'conversionDurationMs');
      if (durationMs != null && durationMs >= 0) {
        totalDurationMs += durationMs;
        durationSamples += 1;
      }
      qualityClean += Math.max(0, getMetadataNumber(event.metadata, 'cleanCount') ?? 0);
      qualityReview += Math.max(0, getMetadataNumber(event.metadata, 'reviewCount') ?? 0);
      qualityActionNeeded += Math.max(0, getMetadataNumber(event.metadata, 'actionNeededCount') ?? 0);
      qualityWarnings += Math.max(0, getMetadataNumber(event.metadata, 'warningCount') ?? 0);
      qualityStyleDetectionFailed += Math.max(0, getMetadataNumber(event.metadata, 'styleDetectionFailedCount') ?? 0);
    }

    if (event.eventType === 'converter_failed') {
      converterFailed += 1;
      countryBucket.failed += 1;
      engineBucket.failed += 1;
      routeBucket.failed += 1;
      const durationMs = getMetadataNumber(event.metadata, 'conversionDurationMs');
      if (durationMs != null && durationMs >= 0) {
        totalDurationMs += durationMs;
        durationSamples += 1;
      }
    }

    engines.set(engine, engineBucket);
    routes.set(routeKey, routeBucket);
    referrers.set(referrerHost, referrerBucket);
    devices.set(deviceType, deviceBucket);
    browsers.set(browser, browserBucket);
    operatingSystems.set(operatingSystem, osBucket);
    languages.set(language, languageBucket);
    hostnames.set(hostname, hostnameBucket);
    surfaces.set(surface, surfaceBucket);
  }

  for (const visitorId of newVisitors) {
    const countryCode = visitorProfiles.get(visitorId)?.firstCountryCode ?? 'unknown';
    const countryBucket = countries.get(countryCode) ?? {
      activeUsers: new Set<string>(),
      newUsers: new Set<string>(),
      views: 0,
      converterStarts: 0,
      completed: 0,
      failed: 0,
    };
    countryBucket.newUsers.add(visitorId);
    countries.set(countryCode, countryBucket);
  }

  const lifetimeAccumulator = sortedEvents.reduce((acc, event) => {
    const sessionId = getMetadataString(event.metadata, 'sessionId', 'unknown');
    if (sessionId !== 'unknown') {
      acc.sessions.add(sessionId);
    }
    if (event.eventType === 'page_view') acc.views += 1;
    if (event.eventType === 'converter_started') acc.converterStarts += 1;
    if (event.eventType === 'converter_completed') acc.completed += 1;
    return acc;
  }, {
    visitors: visitorProfiles.size,
    sessions: new Set<string>(),
    views: 0,
    converterStarts: 0,
    completed: 0,
  });

  const lifetime = {
    visitors: lifetimeAccumulator.visitors,
    sessions: lifetimeAccumulator.sessions.size,
    views: lifetimeAccumulator.views,
    converterStarts: lifetimeAccumulator.converterStarts,
    completed: lifetimeAccumulator.completed,
  };

  return {
    generatedAt,
    windowDays,
    windowStart,
    users: {
      active: activeVisitors.size,
      new: newVisitors.size,
      returning: Math.max(0, activeVisitors.size - newVisitors.size),
    },
    traffic: {
      views,
    },
    sessions: {
      total: activeSessions.size,
    },
    converter: {
      starts: converterStarts,
      completed: converterCompleted,
      failed: converterFailed,
      startRate: roundMetric(views > 0 ? converterStarts / views : null),
      completionRate: roundMetric(converterStarts > 0 ? converterCompleted / converterStarts : null),
      averageCitationsPerStart: roundMetric(citationCountSamples > 0 ? totalCitationCount / citationCountSamples : null),
      averageDurationMs: roundMetric(durationSamples > 0 ? totalDurationMs / durationSamples : null),
    },
    quality: {
      clean: qualityClean,
      review: qualityReview,
      actionNeeded: qualityActionNeeded,
      warnings: qualityWarnings,
      styleDetectionFailed: qualityStyleDetectionFailed,
    },
    engines: (['v2', 'v1', 'unknown'] as const).map((engine) => ({
      engine,
      starts: engines.get(engine)?.starts ?? 0,
      completed: engines.get(engine)?.completed ?? 0,
      failed: engines.get(engine)?.failed ?? 0,
    })),
    countries: [...countries.entries()]
      .map(([code, bucket]) => ({
        code,
        name: countryDisplayName(code),
        activeUsers: bucket.activeUsers.size,
        newUsers: bucket.newUsers.size,
        views: bucket.views,
        converterStarts: bucket.converterStarts,
        completed: bucket.completed,
        failed: bucket.failed,
      }))
      .sort((left, right) => {
        if (right.activeUsers !== left.activeUsers) return right.activeUsers - left.activeUsers;
        if (right.newUsers !== left.newUsers) return right.newUsers - left.newUsers;
        return right.views - left.views;
      }),
    routes: [...routes.values()]
      .sort((left, right) => {
        if (right.views !== left.views) return right.views - left.views;
        return right.converterStarts - left.converterStarts;
      })
      .slice(0, 12),
    referrers: [...referrers.entries()]
      .map(([host, bucket]) => ({
        host,
        visitors: bucket.visitors.size,
        views: bucket.views,
        converterStarts: bucket.converterStarts,
      }))
      .sort((left, right) => {
        if (right.views !== left.views) return right.views - left.views;
        return right.visitors - left.visitors;
      })
      .slice(0, 12),
    devices: [...devices.entries()]
      .map(([deviceType, bucket]) => ({
        deviceType,
        users: bucket.users.size,
        views: bucket.views,
        converterStarts: bucket.converterStarts,
        completed: bucket.completed,
      }))
      .sort((left, right) => right.users - left.users),
    browsers: [...browsers.entries()]
      .map(([browser, bucket]) => ({
        browser,
        users: bucket.users.size,
        views: bucket.views,
        converterStarts: bucket.converterStarts,
      }))
      .sort((left, right) => right.users - left.users)
      .slice(0, 10),
    operatingSystems: [...operatingSystems.entries()]
      .map(([operatingSystem, bucket]) => ({
        operatingSystem,
        users: bucket.users.size,
        views: bucket.views,
        converterStarts: bucket.converterStarts,
      }))
      .sort((left, right) => right.users - left.users)
      .slice(0, 10),
    languages: [...languages.entries()]
      .map(([language, bucket]) => ({
        language,
        users: bucket.users.size,
        views: bucket.views,
      }))
      .sort((left, right) => right.users - left.users)
      .slice(0, 10),
    hostnames: [...hostnames.entries()]
      .map(([hostname, bucket]) => ({
        hostname,
        views: bucket.views,
        converterStarts: bucket.converterStarts,
      }))
      .sort((left, right) => right.views - left.views)
      .slice(0, 10),
    countrySources: [...countrySources.entries()]
      .map(([source, events]) => ({
        source,
        events,
      }))
      .sort((left, right) => right.events - left.events),
    surfaces: [...surfaces.entries()]
      .map(([surface, bucket]) => ({
        surface,
        views: bucket.views,
        converterStarts: bucket.converterStarts,
      }))
      .sort((left, right) => right.views - left.views),
    lifetime,
  };
}

const databaseUrl = getUsableDatabaseUrl();
const fileAnalyticsStore = new FileAnalyticsStore();
const analyticsStore: IAnalyticsStore = databaseUrl
  ? new ResilientAnalyticsStore(new PostgresAnalyticsStore(databaseUrl), fileAnalyticsStore)
  : fileAnalyticsStore;

export async function trackAnalyticsEvent(event: SiteAnalyticsEvent): Promise<void> {
  await analyticsStore.trackEvent(event);
}

export async function getAnalyticsSummary(windowDays = 30): Promise<AnalyticsSummary> {
  const events = await analyticsStore.loadEvents();
  return summarizeAnalytics(events, windowDays);
}
