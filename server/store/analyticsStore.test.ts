import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveDataFile } from './persistence.js';

describe('analyticsStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T12:00:00Z'));
    const analyticsPath = resolveDataFile('site-analytics.v1.jsonl');
    fs.rmSync(analyticsPath, { force: true });
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('summarizes new users, converter attempts, and countries', async () => {
    const { trackAnalyticsEvent, getAnalyticsSummary } = await import('./analyticsStore.js');

    await trackAnalyticsEvent({
      id: 'evt-1',
      visitorId: 'visitor_001',
      eventType: 'page_view',
      path: '/',
      countryCode: 'US',
      createdAt: '2026-03-20T10:00:00.000Z',
      metadata: {
        surface: 'home',
        sessionId: 'session_001',
        routeName: 'home',
        referrerHost: 'google.com',
        deviceType: 'desktop',
        browser: 'chrome',
        operatingSystem: 'windows',
        language: 'en-US',
        hostname: 'bulkreferences.com',
        countryHeaderSource: 'vercel',
      },
    });
    await trackAnalyticsEvent({
      id: 'evt-2',
      visitorId: 'visitor_001',
      eventType: 'converter_started',
      path: '/',
      countryCode: 'US',
      createdAt: '2026-03-20T10:00:02.000Z',
      metadata: {
        engineVersion: 'v2',
        citationCount: 12,
        sessionId: 'session_001',
        routeName: 'home',
        referrerHost: 'google.com',
        deviceType: 'desktop',
        browser: 'chrome',
        operatingSystem: 'windows',
        language: 'en-US',
        hostname: 'bulkreferences.com',
        countryHeaderSource: 'vercel',
        surface: 'home',
      },
    });
    await trackAnalyticsEvent({
      id: 'evt-3',
      visitorId: 'visitor_001',
      eventType: 'converter_completed',
      path: '/',
      countryCode: 'US',
      createdAt: '2026-03-20T10:00:05.000Z',
      metadata: {
        engineVersion: 'v2',
        citationCount: 12,
        conversionDurationMs: 3000,
        cleanCount: 10,
        reviewCount: 2,
        actionNeededCount: 0,
        warningCount: 1,
        styleDetectionFailedCount: 0,
        sessionId: 'session_001',
        routeName: 'home',
        referrerHost: 'google.com',
        deviceType: 'desktop',
        browser: 'chrome',
        operatingSystem: 'windows',
        language: 'en-US',
        hostname: 'bulkreferences.com',
        countryHeaderSource: 'vercel',
        surface: 'home',
      },
    });
    await trackAnalyticsEvent({
      id: 'evt-4',
      visitorId: 'visitor_002',
      eventType: 'page_view',
      path: '/',
      countryCode: 'GB',
      createdAt: '2026-03-22T09:00:00.000Z',
      metadata: {
        surface: 'faq',
        sessionId: 'session_002',
        routeName: 'faq',
        referrerHost: 'direct',
        deviceType: 'mobile',
        browser: 'safari',
        operatingSystem: 'ios',
        language: 'en-GB',
        hostname: 'bulkreferences.com',
        countryHeaderSource: 'cloudflare',
      },
    });

    const summary = await getAnalyticsSummary(30);

    expect(summary.users.active).toBe(2);
    expect(summary.users.new).toBe(2);
    expect(summary.traffic.views).toBe(2);
    expect(summary.converter.starts).toBe(1);
    expect(summary.converter.completed).toBe(1);
    expect(summary.converter.completionRate).toBe(1);
    expect(summary.converter.averageCitationsPerStart).toBe(12);
    expect(summary.converter.averageDurationMs).toBe(3000);
    expect(summary.sessions.total).toBe(2);
    expect(summary.quality.clean).toBe(10);
    expect(summary.quality.review).toBe(2);
    expect(summary.quality.warnings).toBe(1);
    expect(summary.countries[0]).toEqual(expect.objectContaining({
      code: 'US',
      activeUsers: 1,
      newUsers: 1,
      converterStarts: 1,
      completed: 1,
    }));
    expect(summary.routes[0]).toEqual(expect.objectContaining({
      routeName: 'home',
      views: 1,
      converterStarts: 1,
    }));
    expect(summary.referrers[0]).toEqual(expect.objectContaining({
      host: 'google.com',
      views: 1,
      converterStarts: 1,
    }));
    expect(summary.devices[0]).toEqual(expect.objectContaining({
      deviceType: 'desktop',
      users: 1,
    }));
    expect(summary.countrySources).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'vercel', events: 3 }),
      expect.objectContaining({ source: 'cloudflare', events: 1 }),
    ]));
    expect(summary.engines.find((engine) => engine.engine === 'v2')).toEqual(expect.objectContaining({
      starts: 1,
      completed: 1,
    }));
  });
});
