import "dotenv/config";
import express from 'express';
import { registerRoutes } from './routes';
import { setupVite, serveStatic, log } from './vite';

function isVercelRuntime() {
  const vercel = process.env.VERCEL?.toLowerCase();
  return vercel === "1" || vercel === "true";
}

/** Build and return the Express app (and optional server for listen). Used by Vercel serverless. */
export async function createApp(): Promise<{ app: express.Express; server: Awaited<ReturnType<typeof registerRoutes>> }> {
  const app = express();
  const isProduction = process.env.NODE_ENV === "production";

  app.disable("x-powered-by");
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use((_req, res, next) => {
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

    if (isProduction) {
      res.setHeader(
        "Content-Security-Policy",
        [
          "default-src 'self'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'none'",
          "img-src 'self' data: blob: https:",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "font-src 'self' data:",
          "connect-src 'self'",
          "object-src 'none'",
          "worker-src 'self' blob:",
          "manifest-src 'self'",
          "upgrade-insecure-requests",
        ].join("; "),
      );
    }

    next();
  });

  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    const originalJson = res.json;
    res.json = function (body: unknown) {
      return originalJson.call(this, body);
    };
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (path.startsWith('/api')) {
        log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
      }
    });
    next();
  });

  const server = await registerRoutes(app);

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = (err as { status?: number; statusCode?: number }).status ?? (err as { statusCode?: number }).statusCode ?? 500;
    const message = (err as Error).message ?? 'Internal Server Error';
    res.status(status).json({ message });
  });

  const isDev = app.get('env') === 'development' || process.env.NODE_ENV !== 'production';
  if (isDev) {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  return { app, server };
}

/** Run server when not on Vercel (e.g. `npm run start`). */
async function main() {
  const { server } = await createApp();
  const port = Number(process.env.PORT) || 5000;
  server.listen({ port, host: '0.0.0.0' }, () => {
    log(`serving on port ${port}`);
  });
}

if (!isVercelRuntime()) {
  main();
}
