import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Builds the development-only preview harness (see src/preview/main.tsx) into `dist-preview/`.
 * The production build (`vite.config.ts`, used by Render and CI) never includes this entry.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist-preview",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: fileURLToPath(new URL("./preview.html", import.meta.url)),
    },
  },
} as never);
