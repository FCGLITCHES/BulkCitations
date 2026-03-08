/**
 * Vercel serverless entry: handles /api/* only.
 * Static SPA is served from dist/public via outputDirectory.
 */
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let appPromise = null;

export default async function handler(req, res) {
  try {
    if (!appPromise) {
      const serverPath = path.join(__dirname, '..', 'dist', 'index.js');
      const { createApp } = await import(pathToFileURL(serverPath).href);
      appPromise = createApp();
    }
    const { app } = await appPromise;
    app(req, res);
  } catch (err) {
    console.error('API handler error:', err);
    res.status(500).json({ message: 'Server error', error: process.env.NODE_ENV === 'development' ? err.message : undefined });
  }
}
