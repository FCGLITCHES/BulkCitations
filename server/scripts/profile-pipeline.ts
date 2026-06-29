interface PhaseProfile {
  phaseId: string;
  runs: number;
  averageMs: number;
  maxMs: number;
  budgetMs: number | null;
  withinBudget: boolean;
  worstFixtureId: string;
}

process.env.BULKREFERENCES_ISOLATED_RUNTIME ??= 'true';

async function main(): Promise<void> {
  const assertBudget = process.argv.includes('--assert-budget');
  const originalInfo = console.info;
  console.info = () => {};

  try {
    const [{ createPipelineDependencies }, { createPipelineContext, runConvertPipeline }, { REGRESSION_FIXTURES }] =
      await Promise.all([
        import('../src/pipeline/dependencies.js'),
        import('../src/pipeline/orchestrator.js'),
        import('../src/regression/fixtures.js'),
      ]);

    const phaseStats = new Map<string, { durations: number[]; budgetMs: number | null; maxFixtureId: string; maxMs: number }>();

    for (const fixture of REGRESSION_FIXTURES) {
      const ctx = createPipelineContext({
        outputStyle: fixture.input.outputStyle ?? 'apa7',
        ...(fixture.pipelineOptions ? { options: fixture.pipelineOptions } : {}),
      });
      const artifacts = await runConvertPipeline(fixture.input, ctx, createPipelineDependencies());

      for (const timing of artifacts.response.processingPath.stageTimings) {
        const current = phaseStats.get(timing.phaseId) ?? {
          durations: [],
          budgetMs: timing.budgetMs,
          maxFixtureId: fixture.id,
          maxMs: -1,
        };
        current.durations.push(timing.durationMs);
        current.budgetMs = timing.budgetMs;
        if (timing.durationMs > current.maxMs) {
          current.maxMs = timing.durationMs;
          current.maxFixtureId = fixture.id;
        }
        phaseStats.set(timing.phaseId, current);
      }
    }

    const profiles: PhaseProfile[] = [...phaseStats.entries()]
      .map(([phaseId, stat]) => {
        const averageMs = stat.durations.reduce((sum, value) => sum + value, 0) / stat.durations.length;
        return {
          phaseId,
          runs: stat.durations.length,
          averageMs: round(averageMs),
          maxMs: stat.maxMs,
          budgetMs: stat.budgetMs,
          withinBudget: stat.budgetMs == null ? true : stat.maxMs <= stat.budgetMs,
          worstFixtureId: stat.maxFixtureId,
        };
      })
      .sort((left, right) => right.maxMs - left.maxMs);

    const summary = {
      generatedAt: new Date().toISOString(),
      totalFixtures: REGRESSION_FIXTURES.length,
      phaseProfiles: profiles,
    };

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

    if (assertBudget && profiles.some((profile) => !profile.withinBudget)) {
      process.exitCode = 1;
    }
  } finally {
    console.info = originalInfo;
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

void main();
