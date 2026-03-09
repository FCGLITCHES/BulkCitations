import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === "production";
const isReplit = process.env.REPL_ID !== undefined;

export default defineConfig(async () => {
  const plugins: PluginOption[] = [react()];

  if (!isProd) {
    try {
      // @ts-expect-error optional Replit dev plugin
      const runtimeErrorOverlay = (await import("@replit/vite-plugin-runtime-error-modal")).default;
      plugins.push(runtimeErrorOverlay());
    } catch {
      // Optional: only available in Replit/dev
    }
    if (isReplit) {
      try {
        // @ts-expect-error optional Replit plugin
        const { cartographer } = await import("@replit/vite-plugin-cartographer");
        plugins.push(cartographer());
      } catch {
        // Optional: only in Replit
      }
    }
  }

  return {
    plugins,
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "client", "src"),
        "@shared": path.resolve(__dirname, "shared"),
        "@assets": path.resolve(__dirname, "attached_assets"),
      },
      dedupe: ["react", "react-dom", "scheduler"],
    },
    root: path.resolve(__dirname, "client"),
    build: {
      outDir: path.resolve(__dirname, "dist", "public"),
      emptyOutDir: true,
    },
    server: {
      fs: {
        strict: true,
        deny: ["**/.*"],
        allow: [path.resolve(__dirname, "shared"), path.resolve(__dirname, "attached_assets")],
      },
    },
  };
});
