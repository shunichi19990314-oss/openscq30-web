/**
 * Renders the production build in headless Chromium and captures screenshots for the README.
 *
 * Usage: node scripts/screenshots.mjs
 * Requires: `npm run build` and `npx playwright install chromium`.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const DIST = new URL("../dist/", import.meta.url).pathname;
const OUT = new URL("../docs/screenshots/", import.meta.url).pathname;
const PORT = 4319;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".map": "application/json",
};

const server = createServer(async (req, res) => {
  try {
    const path = normalize(req.url.split("?")[0]);
    const file = join(DIST, path === "/" ? "index.html" : path);
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

await new Promise((resolve) => server.listen(PORT, resolve));

const browser = await chromium.launch({ args: ["--no-sandbox"] });

async function shoot(name, { colorScheme = "dark", demo = false, fullPage = true, width = 1000 } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: 2,
    colorScheme,
    locale: "ja-JP",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
  if (demo) {
    await page.getByRole("button", { name: /デモ機器で試す/ }).click();
    await page.waitForSelector(".device-header", { timeout: 10000 });
    await page.waitForTimeout(900);
  }
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage });
  console.log(`${name}.png  (console errors: ${errors.length})`);
  for (const error of errors) console.log(`   ! ${error}`);
  await context.close();
  return errors;
}

const allErrors = [];
allErrors.push(...(await shoot("connect-dark")));
allErrors.push(...(await shoot("connect-light", { colorScheme: "light" })));
allErrors.push(...(await shoot("device-dark", { demo: true })));
allErrors.push(...(await shoot("device-light", { demo: true, colorScheme: "light" })));
allErrors.push(...(await shoot("device-mobile", { demo: true, width: 420 })));

// Log drawer + equalizer sliders open
{
  const context = await browser.newContext({
    viewport: { width: 1000, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
    locale: "ja-JP",
  });
  const page = await context.newPage();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /デモ機器で試す/ }).click();
  await page.waitForSelector(".device-header");
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: /スライダー/ }).click();
  await page.getByRole("button", { name: /通信ログ/ }).click();
  await page.waitForTimeout(500);
  // Make a change so the log has traffic.
  const firstSwitch = page.locator('[role="switch"]').first();
  await firstSwitch.click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}device-log.png`, fullPage: false });
  console.log("device-log.png");
  await context.close();
}

await browser.close();
server.close();
console.log(allErrors.length === 0 ? "no console errors" : `${allErrors.length} console error(s)`);
