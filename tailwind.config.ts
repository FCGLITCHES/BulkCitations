import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Söhne", "ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "Inter", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        serif: ["ui-serif", "Georgia", "Cambria", "Times New Roman", "Times", "serif"],
        mono: ["Fira Code", "Fira Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "Liberation Mono", "Courier New", "monospace"],
        headline: ["Noto Serif", "serif"],
        body: ["Inter", "sans-serif"],
        label: ["Inter", "sans-serif"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        background: "#f8f9fb",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "#000a1e",
          foreground: "#ffffff",
        },
        secondary: {
          DEFAULT: "#43664d",
          foreground: "#ffffff",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "#ba1a1a",
          foreground: "#ffffff",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        "surface-container-lowest": "#ffffff",
        "on-primary-fixed": "#001b3d",
        "on-tertiary-container": "#ff3953",
        "secondary-fixed": "#c5eccc",
        "on-secondary-container": "#486a51",
        "error": "#ba1a1a",
        "inverse-on-surface": "#eff1f3",
        "surface": "#f8f9fb",
        "on-tertiary-fixed-variant": "#920022",
        "error-container": "#ffdad6",
        "on-primary-fixed-variant": "#2d476f",
        "on-primary": "#ffffff",
        "on-primary-container": "#708ab5",
        "on-surface": "#191c1e",
        "on-background": "#191c1e",
        "surface-container-low": "#f2f4f6",
        "tertiary-fixed": "#ffdad9",
        "surface-container": "#eceef0",
        "primary-fixed-dim": "#aec7f6",
        "primary-container": "#002147",
        "outline": "#74777f",
        "surface-container-highest": "#e0e3e5",
        "on-tertiary-fixed": "#40000a",
        "inverse-surface": "#2d3133",
        "surface-tint": "#465f88",
        "surface-variant": "#e0e3e5",
        "surface-bright": "#f8f9fb",
        "on-error": "#ffffff",
        "surface-container-high": "#e6e8ea",
        "secondary-fixed-dim": "#aad0b1",
        "on-surface-variant": "#44474e",
        "on-secondary-fixed": "#00210e",
        "secondary-container": "#c2e9c9",
        "on-error-container": "#93000a",
        "tertiary-container": "#4b000d",
        "on-secondary-fixed-variant": "#2c4e36",
        "tertiary-fixed-dim": "#ffb3b3",
        "inverse-primary": "#aec7f6",
        "outline-variant": "#c4c6cf",
        "on-tertiary": "#ffffff",
        "on-secondary": "#ffffff",
        "tertiary": "#200003",
        "surface-dim": "#d8dadc",
        "primary-fixed": "#d6e3ff",
        "brand-green": "#10b981",
        "brand-amber": "#f59e0b",
        "brand-red": "#ef4444"
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
