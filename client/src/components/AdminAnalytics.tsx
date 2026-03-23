import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { AdminSectionTabs } from "@/components/AdminSectionTabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { adminFetch } from "@/lib/admin-api";

type AnalyticsSummary = {
  generatedAt: string;
  windowDays: number;
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
    engine: "v1" | "v2" | "unknown";
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
};

function formatPercent(value: number | null) {
  return value == null ? "--" : `${Math.round(value * 100)}%`;
}

function formatMs(value: number | null) {
  if (value == null) return "--";
  return `${Math.round(value)} ms`;
}

export default function AdminAnalytics() {
  const { data: analyticsSummary, isLoading } = useQuery<AnalyticsSummary>({
    queryKey: ["/api/admin/analytics/summary", "30d"],
    queryFn: async () => adminFetch<AnalyticsSummary>("/api/admin/analytics/summary?days=30"),
  });

  const users = analyticsSummary?.users ?? { active: 0, new: 0, returning: 0 };
  const traffic = analyticsSummary?.traffic ?? { views: 0 };
  const converter = analyticsSummary?.converter ?? {
    starts: 0,
    completed: 0,
    failed: 0,
    startRate: null,
    completionRate: null,
    averageCitationsPerStart: null,
    averageDurationMs: null,
  };
  const quality = analyticsSummary?.quality ?? {
    clean: 0,
    review: 0,
    actionNeeded: 0,
    warnings: 0,
    styleDetectionFailed: 0,
  };
  const engines = analyticsSummary?.engines ?? [];
  const countries = analyticsSummary?.countries ?? [];
  const routes = analyticsSummary?.routes ?? [];
  const referrers = analyticsSummary?.referrers ?? [];
  const devices = analyticsSummary?.devices ?? [];
  const browsers = analyticsSummary?.browsers ?? [];
  const operatingSystems = analyticsSummary?.operatingSystems ?? [];
  const languages = analyticsSummary?.languages ?? [];
  const hostnames = analyticsSummary?.hostnames ?? [];
  const countrySources = analyticsSummary?.countrySources ?? [];
  const surfaces = analyticsSummary?.surfaces ?? [];
  const lifetime = analyticsSummary?.lifetime ?? {
    visitors: 0,
    sessions: 0,
    views: 0,
    converterStarts: 0,
    completed: 0,
  };
  const topCountry = countries[0];
  const v2Usage = engines.find((engine) => engine.engine === "v2");
  const v1Usage = engines.find((engine) => engine.engine === "v1");

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="mx-auto w-full max-w-[1600px] px-4 py-8 space-y-8 xl:px-6">
        <div className="flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-2">
              <ChevronRight className="h-4 w-4 rotate-180" />
              Back to Home
            </Button>
          </Link>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
              <p className="mt-1 text-muted-foreground">
                Anonymous traffic, conversion, engine, and country trends for the site.
              </p>
            </div>
            <AdminSectionTabs />
          </div>

          {analyticsSummary && (
            <p className="text-xs text-muted-foreground">
              Generated {new Date(analyticsSummary.generatedAt).toLocaleString()}
            </p>
          )}
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              Loading analytics...
            </CardContent>
          </Card>
        ) : analyticsSummary ? (
          <>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.9fr)]">
              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Site Snapshot</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Last {analyticsSummary.windowDays} days. Anonymous usage only, no raw citation text.
                  </p>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-4">
                  <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">New users</p>
                    <p className="mt-2 text-3xl font-semibold tracking-tight">{users.new}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {users.returning} returning of {users.active} active
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Views</p>
                    <p className="mt-2 text-3xl font-semibold tracking-tight">{traffic.views}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {lifetime.views} all-time views
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Tried converter</p>
                    <p className="mt-2 text-3xl font-semibold tracking-tight">{converter.starts}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatPercent(converter.startRate)} of views
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Completed</p>
                    <p className="mt-2 text-3xl font-semibold tracking-tight">{converter.completed}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatPercent(converter.completionRate)} success, avg {converter.averageCitationsPerStart?.toFixed(1) ?? "--"} citations
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Top Countries</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {topCountry ? `${topCountry.name} is currently the largest traffic source.` : "Country data will appear once production traffic is being tracked behind your host proxy."}
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">V2 starts {v2Usage?.starts ?? 0}</Badge>
                    <Badge variant="outline">V1 starts {v1Usage?.starts ?? 0}</Badge>
                    <Badge variant="outline">Failures {converter.failed}</Badge>
                  </div>
                  <div className="space-y-3">
                    {countries.slice(0, 5).map((country) => (
                      <div key={country.code} className="flex items-center justify-between gap-4 rounded-xl border border-border/60 px-3 py-2">
                        <div>
                          <p className="font-medium text-foreground">{country.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {country.newUsers} new users, {country.converterStarts} converter starts
                          </p>
                        </div>
                        <div className="text-right text-sm">
                          <p className="font-semibold">{country.activeUsers} users</p>
                          <p className="text-muted-foreground">{country.views} views</p>
                        </div>
                      </div>
                    ))}
                    {countries.length === 0 && (
                      <p className="text-sm text-muted-foreground">No tracked country traffic yet for this window.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Lifetime visitors</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{lifetime.visitors}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Lifetime views</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{lifetime.views}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Lifetime sessions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{lifetime.sessions}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Lifetime converter starts</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{lifetime.converterStarts}</div>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Conversion Quality</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Output health from completed conversions and average runtime of recent jobs.
                  </p>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
                  <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Clean</p>
                    <p className="mt-2 text-2xl font-semibold">{quality.clean}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Review</p>
                    <p className="mt-2 text-2xl font-semibold">{quality.review}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Action needed</p>
                    <p className="mt-2 text-2xl font-semibold">{quality.actionNeeded}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Warnings</p>
                    <p className="mt-2 text-2xl font-semibold">{quality.warnings}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Style detect fails</p>
                    <p className="mt-2 text-2xl font-semibold">{quality.styleDetectionFailed}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Avg duration</p>
                    <p className="mt-2 text-2xl font-semibold">{formatMs(converter.averageDurationMs)}</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Tracking Coverage</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Where country and traffic metadata are coming from in production.
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {countrySources.map((entry) => (
                      <Badge key={entry.source} variant="outline">
                        {entry.source} {entry.events}
                      </Badge>
                    ))}
                    {countrySources.length === 0 && (
                      <p className="text-sm text-muted-foreground">No country header sources recorded yet.</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    {hostnames.slice(0, 5).map((entry) => (
                      <div key={entry.hostname} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-sm">
                        <span className="font-medium">{entry.hostname}</span>
                        <span className="text-muted-foreground">{entry.views} views</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Top Routes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {routes.slice(0, 8).map((route) => (
                    <div key={`${route.routeName}:${route.path}`} className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-2">
                      <div>
                        <p className="font-medium text-foreground">{route.routeName}</p>
                        <p className="text-xs text-muted-foreground">{route.path}</p>
                      </div>
                      <div className="text-right text-sm">
                        <p className="font-semibold">{route.views} views</p>
                        <p className="text-muted-foreground">{route.converterStarts} starts</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Referrers</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {referrers.slice(0, 8).map((referrer) => (
                    <div key={referrer.host} className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-2">
                      <div>
                        <p className="font-medium text-foreground">{referrer.host}</p>
                        <p className="text-xs text-muted-foreground">{referrer.visitors} visitors</p>
                      </div>
                      <div className="text-right text-sm">
                        <p className="font-semibold">{referrer.views} views</p>
                        <p className="text-muted-foreground">{referrer.converterStarts} starts</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Devices And Browsers</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    {devices.map((device) => (
                      <div key={device.deviceType} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-sm">
                        <span className="font-medium capitalize">{device.deviceType}</span>
                        <span className="text-muted-foreground">{device.users} users</span>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    {browsers.slice(0, 6).map((browser) => (
                      <div key={browser.browser} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-sm">
                        <span className="font-medium capitalize">{browser.browser}</span>
                        <span className="text-muted-foreground">{browser.users} users</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">OS, Language, Surface</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    {operatingSystems.slice(0, 6).map((entry) => (
                      <div key={entry.operatingSystem} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-sm">
                        <span className="font-medium capitalize">{entry.operatingSystem}</span>
                        <span className="text-muted-foreground">{entry.users}</span>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    {languages.slice(0, 6).map((entry) => (
                      <div key={entry.language} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-sm">
                        <span className="font-medium lowercase">{entry.language}</span>
                        <span className="text-muted-foreground">{entry.users}</span>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    {surfaces.slice(0, 6).map((entry) => (
                      <div key={entry.surface} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-sm">
                        <span className="font-medium">{entry.surface}</span>
                        <span className="text-muted-foreground">{entry.views}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        ) : (
          <Card>
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              Analytics could not be loaded.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
