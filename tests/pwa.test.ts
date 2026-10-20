/**
 * Publish-readiness checks for the installable/offline bits. These read the repository files (the
 * built bundle is covered by scripts/smoke.mjs).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url).pathname;
const read = (relative: string): string => readFileSync(join(root, relative), "utf8");

describe("manifest", () => {
  const manifest = JSON.parse(read("public/manifest.webmanifest"));

  it("is installable: name, display, theme and png icons", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toMatch(/^#/);
    expect(manifest.background_color).toMatch(/^#/);
    expect(manifest.start_url).toBe("/");

    const pngs = manifest.icons.filter(
      (icon: { type: string }) => icon.type === "image/png",
    );
    const sizes = new Set(pngs.map((icon: { sizes: string }) => icon.sizes));
    expect(sizes.has("192x192")).toBe(true);
    expect(sizes.has("512x512")).toBe(true);
    const purposes = new Set(pngs.map((icon: { purpose: string }) => icon.purpose));
    expect(purposes.has("any")).toBe(true);
    expect(purposes.has("maskable")).toBe(true);

    for (const icon of pngs) {
      expect(existsSync(join(root, "public", icon.src.replace(/^\//, ""))), icon.src).toBe(true);
    }
  });
});

describe("service worker", () => {
  const sw = read("public/sw.js");

  it("caches navigations with an offline fallback", () => {
    expect(sw).toContain('request.mode === "navigate"');
    expect(sw).toContain("caches.open");
    expect(sw).toContain('cache.match("index.html")');
  });

  it("carries a build id placeholder that the build replaces", () => {
    expect(sw).toContain("__BUILD_ID__");
    const finalize = read("scripts/finalize-sw.mjs");
    expect(finalize).toContain("__BUILD_ID__");
    expect(read("package.json")).toContain("finalize-sw.mjs");
  });

  it("is registered only in production builds", () => {
    const main = read("src/main.tsx");
    expect(main).toContain("import.meta.env.PROD");
    expect(main).toContain('register(`${import.meta.env.BASE_URL}sw.js`');
  });
});

describe("document metadata", () => {
  const html = read("index.html");

  it("has theme colours, social cards and a noscript fallback", () => {
    expect(html).toContain('name="theme-color"');
    expect(html).toContain('name="description"');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('name="twitter:card"');
    expect(html).toContain("<noscript>");
    expect(html).toContain('rel="manifest"');
  });

  it("declares the deployment cache policy", () => {
    const yaml = read("render.yaml");
    expect(yaml).toContain("/sw.js");
    expect(yaml).toContain("no-cache");
    expect(yaml).toContain("immutable");
  });
});
