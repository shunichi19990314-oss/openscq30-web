import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Render static site: `npm run build` -> publish directory `dist`
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
} as never);
