import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

// Render static site: `npm run build` -> publish directory `dist`
//
// BASE_PATH is only needed when hosting under a sub path, e.g. GitHub Pages project sites:
//   BASE_PATH=/openscq30-web/ npm run build
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
} as never);
