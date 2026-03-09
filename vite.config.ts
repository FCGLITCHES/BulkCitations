import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const isProd = process.env.NODE_ENV === "production";
const isReplit = process.env.REPL_ID !== undefined;

const plugins = [react()];
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
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
    dedupe: ["react", "react-dom", "scheduler"],
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
