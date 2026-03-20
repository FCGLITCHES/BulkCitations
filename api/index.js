/**
 * Vercel serverless entry: handles /api/* only.
 * Static SPA is served from dist/public via outputDirectory.
 *
 * Use a static import so Vercel traces the built server bundle into the
 * serverless function package. The old dynamic path import worked locally
 * but could leave `dist/index.js` out of the production function bundle.
 */
import { createApp } from '../dist/index.js';

let appPromise = null;

export default async function handler(req, res) {
  try {
    if (!appPromise) {
      appPromise = createApp();
    }
    const { app } = await appPromise;
    app(req, res);
  } catch (err) {
    console.error('API handler error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ message: 'Server error', error: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : String(err)) : undefined });
  }
}
