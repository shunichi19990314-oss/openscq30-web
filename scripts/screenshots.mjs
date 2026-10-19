/**
 * Renders the builds in headless Chromium and captures screenshots for the README.
 *
 * - the connect screen comes from the production build (`dist/`)
 * - the settings screen comes from the development-only preview harness (`dist-preview/`), because
 *   the production app can only reach that screen through a real Web Serial connection
 *
 * Usage: npm run screenshots   (builds both bundles first)
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".map": "application/json",
};

function serve(distPath, port, indexFile = "index.html") {
  const server = createServer(async (req, res) => {
    try {
      const path = normalize(req.url.split("?")[0]);
      const file = join(distPath, path === "/" ? indexFile : path);
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

const DIST = new URL("../dist/", import.meta.url).pathname;
const PREVIEW = new URL("../dist-preview/", import.meta.url).pathname;
const OUT = new URL("../docs/screenshots/", import.meta.url).pathname;

if (!existsSync(join(PREVIEW, "preview.html"))) {
  console.error("run `npm run build:preview` first (or use `npm run screenshots`)");
  process.exit(1);
}

const appServer = await serve(DIST, 4319);
const previewServer = await serve(PREVIEW, 4320, "preview.html");

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const errors = [];

async function shoot(url, name, { colorScheme = "dark", width = 1000, viewport } = {}) {
  const context = await browser.newContext({
    viewport: viewport ?? { width, height: 900 },
    deviceScaleFactor: 2,
    colorScheme,
    locale: "ja-JP",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${name}: ${message.text()}`);
  });
  await page.goto(url, { waitUntil: "networkidle" });
  if (url.includes("4320")) {
    await page.waitForSelector(".device-header", { timeout: 10000 });
    await page.waitForTimeout(800);
  }
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });
  console.log(`${name}.png`);
  await context.close();
}

await shoot("http://localhost:4319/", "connect-dark");
await shoot("http://localhost:4319/", "connect-light", { colorScheme: "light" });
await shoot("http://localhost:4320/", "device-dark");
await shoot("http://localhost:4320/", "device-light", { colorScheme: "light" });
await shoot("http://localhost:4320/", "device-mobile", { width: 420 });

/* the log drawer, with some traffic in it */
{
  const context = await browser.newContext({
    viewport: { width: 1000, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
    locale: "ja-JP",
  });
  const page = await context.newPage();
  await page.goto("http://localhost:4320/", { waitUntil: "networkidle" });
  await page.waitForSelector(".device-header");
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /スライダー/ }).click();
  await page.getByRole("button", { name: /通信ログ/ }).click();
  await page.locator('[role="switch"]').first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}device-log.png`, fullPage: false });
  console.log("device-log.png");
  await context.close();
}

await browser.close();
appServer.close();
previewServer.close();

if (errors.length > 0) {
  console.error(`${errors.length} console error(s):`);
  for (const error of errors) console.error(`  ! ${error}`);
  process.exit(1);
}
console.log("no console errors");
