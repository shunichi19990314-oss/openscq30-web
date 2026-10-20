/**
 * Verifies the published build behaves like a proper PWA in a real browser:
 *  - the service worker activates
 *  - after the first visit the app still loads with the network cut (offline fallback)
 *  - the manifest and icons are reachable
 *
 * Usage: npm run build && node scripts/pwa-check.mjs
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const DIST = new URL("../dist/", import.meta.url).pathname;
const PORT = 4321;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

const server = createServer(async (req, res) => {
  try {
    const path = normalize(req.url.split("?")[0]);
    const file = join(DIST, path === "/" ? "index.html" : path);
    const body = await readFile(file);
    const type = MIME[extname(file)] ?? "application/octet-stream";
    const cache =
      path === "/sw.js" || path === "/index.html" || path === "/"
        ? "no-cache"
        : path.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache";
    res.writeHead(200, { "content-type": type, "cache-control": cache });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((resolve) => server.listen(PORT, resolve));

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({ locale: "ja-JP" });
const page = await context.newPage();

const failures = [];
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`);
  if (!ok) failures.push(name);
};

await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });

// 1. manifest + icons reachable
const manifest = await page.evaluate(async () => {
  const link = document.querySelector('link[rel="manifest"]');
  const response = await fetch(link?.href ?? "/manifest.webmanifest");
  return response.json();
});
check("manifest loads", Boolean(manifest?.name));
const iconStatus = await page.evaluate(async () => {
  const statuses = [];
  for (const icon of ["/icons/icon-192-any.png", "/icons/icon-512-maskable.png"]) {
    const response = await fetch(icon);
    statuses.push(response.status);
  }
  return statuses;
});
check("icons reachable", iconStatus.every((status) => status === 200), iconStatus.join(","));

// 2. service worker activates
await page.waitForFunction(
  () => navigator.serviceWorker?.controller !== null || navigator.serviceWorker?.ready !== undefined,
  undefined,
  { timeout: 15000 },
);
await page.evaluate(() => navigator.serviceWorker.ready);
check("service worker active", true);

// 3. reload offline: the cached shell must still render
await page.evaluate(() => navigator.serviceWorker.ready);
await context.setOffline(true);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("text=OpenSCQ30 Web", { timeout: 10000 });
const offlineText = await page.textContent("body");
check("renders offline", (offlineText ?? "").includes("OpenSCQ30 Web"));
check(
  "offline shows the capability warning",
  (offlineText ?? "").includes("Web Serial"),
);

await context.setOffline(false);
await page.reload({ waitUntil: "networkidle" });
check("recovers online", ((await page.textContent("body")) ?? "").includes("イヤホンに接続する"));

await browser.close();
server.close();

if (failures.length > 0) {
  console.error(`PWA CHECK FAILED: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("PWA CHECK OK");
