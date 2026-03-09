import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === "production";
const isReplit = process.env.REPL_ID !== undefined;

const plugins: PluginOption[] = [react()];
if (!isProd) {
  try {
    const runtimeErrorOverlay = await import("@replit/vite-plugin-runtime-error-modal").then((m) => m.default);
    plugins.push(runtimeErrorOverlay());
  } catch {
    // Optional: only for Replit dev
  }
  if (isReplit) {
    try {
      const { cartographer } = await import("@replit/vite-plugin-cartographer");
      plugins.push(cartographer());
    } catch {
      // Optional: only for Replit dev
    }
  }
}

export default defineConfig({
  plugins,
  resolve: {
    alias: {},
    dedupe: ["react", "react-dom", "scheduler"],
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
