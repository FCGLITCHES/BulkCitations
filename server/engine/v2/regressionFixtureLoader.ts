import { loadGeneratedRegressionFixtures } from '../../store/generatedRegressionStore.js';
import type { RegressionFixture } from './regressionFixtures.js';
import { regressionFixtures } from './regressionFixtures.js';

export async function loadRegressionFixtures(): Promise<RegressionFixture[]> {
  const generated = await loadGeneratedRegressionFixtures();
  return [
    ...regressionFixtures,
    ...generated
      .filter((record) => !record.skipped && record.fixture)
      .map((record) => record.fixture as RegressionFixture),
  ];
}
