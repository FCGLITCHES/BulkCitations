import express from 'express';
import { performance } from 'node:perf_hooks';
import { registerRoutes } from '../server/routes.js';

const count = Number.parseInt(process.argv[2] ?? '10', 10);
const attempts = Number.parseInt(process.argv[3] ?? '1', 10);

process.env.ENABLE_LLM_EXTRACTOR = '0';
process.env.ENABLE_GROBID_EXTRACTOR = '0';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'benchmark-admin';
process.env.ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET ?? 'benchmark-secret';

function buildCitations(total: number): string[] {
  return Array.from({ length: total }, (_, index) => (
    `Smith, J., Doe, A., & Lee, K. (${2020 + (index % 4)}). Example title ${index + 1}. Journal of Quality, ${10 + (index % 5)}(${1 + (index % 3)}), ${11 + index}-${19 + index}. https://doi.org/10.5555/route-${total}-${index + 1}`
  ));
}

async function main(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: false }));
  const server = await registerRoutes(app);

  try {
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not determine benchmark server address');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const references = buildCitations(count);
    const samples: Array<{
      attempt: number;
      converted: number;
      engineVersion?: string;
      ms: number;
      ok: boolean;
    }> = [];

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const started = performance.now();
      const response = await fetch(`${baseUrl}/api/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          references,
          inputStyle: 'auto',
          outputStyle: 'apa',
          engineVersion: 'v2',
          enrichWithAuthority: false,
        }),
      });
      const payload = await response.json() as {
        convertedReferences?: Array<unknown>;
        engineVersion?: string;
      };

      samples.push({
        attempt: attempt + 1,
        converted: payload.convertedReferences?.length ?? 0,
        engineVersion: payload.engineVersion,
        ms: Math.round((performance.now() - started) * 100) / 100,
        ok: response.ok,
      });
    }

    console.log(JSON.stringify({
      attempts,
      count,
      samples,
    }, null, 2));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => {
      process.exit(process.exitCode ?? 0);
    }, 250);
  });
