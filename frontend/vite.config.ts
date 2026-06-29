import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });
const backendPort = process.env.PORT ?? "3111";
const backendTarget = process.env.VITE_API_PROXY_TARGET ?? `http://localhost:${backendPort}`;

/** Long conversions can exceed default proxy/socket timeouts and surface as ECONNRESET. */
const longRunningProxy = {
  target: backendTarget,
  changeOrigin: true,
  timeout: 900_000,
  proxyTimeout: 900_000,
} as const;

export default defineConfig({
  plugins: [react()],
  envDir: path.resolve(__dirname, ".."),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist", "public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.split(path.sep).join("/");
          if (!normalizedId.includes("node_modules/")) {
            return undefined;
          }

          const segments = normalizedId.split("node_modules/");
          const packagePath = segments.at(-1);
          if (!packagePath) {
            return undefined;
          }

          const packageSegments = packagePath.split("/");
          const packageName = packageSegments[0]?.startsWith("@")
            ? `${packageSegments[0]}/${packageSegments[1] ?? "unknown"}`
            : packageSegments[0] ?? "";

          if (["react", "react-dom", "scheduler", "wouter", "use-sync-external-store"].includes(packageName)) {
            return "vendor-react-core";
          }

          if (packageName.startsWith("@clerk/")) {
            return "vendor-clerk";
          }

          if (packageName.startsWith("@workos-inc/")) {
            return "vendor-workos";
          }

          if (
            packageName === "recharts"
            || packageName.startsWith("d3-")
            || packageName === "victory-vendor"
            || packageName === "react-smooth"
            || packageName === "recharts-scale"
          ) {
            return "vendor-charts";
          }

          if (
            packageName === "framer-motion"
            || packageName === "motion-dom"
            || packageName === "motion-utils"
          ) {
            return "vendor-motion";
          }

          if (
            packageName === "react-hook-form"
            || packageName.startsWith("@hookform/")
            || packageName === "zod"
          ) {
            return "vendor-forms";
          }

          if (
            packageName.startsWith("@radix-ui/")
            || packageName.startsWith("@floating-ui/")
          ) {
            return "vendor-radix";
          }

          if (
            packageName === "jspdf"
          ) {
            return "vendor-jspdf";
          }

          if (packageName === "html2canvas") {
            return "vendor-html2canvas";
          }

          if (packageName === "canvg") {
            return "vendor-canvg";
          }

          if (
            packageName === "core-js"
            || packageName === "pako"
            || packageName === "fflate"
            || packageName === "fast-png"
            || packageName === "iobuffer"
            || packageName === "rgbcolor"
            || packageName === "stackblur-canvas"
            || packageName === "svg-pathdata"
          ) {
            return "vendor-export-support";
          }

          return undefined;
        },
      },
    },
  },
  server: {
    port: Number(process.env.FRONTEND_PORT || 2397),
    strictPort: true,
    proxy: {
      "/api/contact": {
        target: backendTarget,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("error", () => {});
        },
      },
      "/api/waitlist": {
        target: backendTarget,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("error", () => {});
        },
      },
      "/api/analytics": {
        target: backendTarget,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("error", () => {});
        },
      },
      "/api/engine": {
        ...longRunningProxy,
        configure(proxy) {
          proxy.on("error", () => {
            // Avoid crashing Vite on transient backend resets during dev.
          });
        },
      },
      "/v1": {
        ...longRunningProxy,
        configure(proxy) {
          proxy.on("error", () => {
            // Avoid crashing Vite on transient backend resets during dev.
          });
        },
      },
      "/api/auth": {
        target: backendTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "/v1"),
        configure(proxy) {
          proxy.on("error", () => {});
        },
      },
      "/internal": {
        ...longRunningProxy,
        configure(proxy) {
          proxy.on("error", () => {
            // Avoid crashing Vite on transient backend resets during dev.
          });
        },
      },
      "/user_management": {
        target: backendTarget,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("error", () => {});
        },
      },
      "/health": {
        target: backendTarget,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("error", () => {
            // Avoid crashing Vite on transient backend resets during dev.
          });
        },
      },
      // Legacy admin UI paths (/api/admin/*) → Fastify `/internal/admin/*`
      "/api/admin": {
        target: backendTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/admin/, "/internal/admin"),
        configure(proxy) {
          proxy.on("error", () => {});
        },
      },
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
      allow: [path.resolve(__dirname), path.resolve(__dirname, "shared"), path.resolve(__dirname, "attached_assets")],
    },
  },
});
