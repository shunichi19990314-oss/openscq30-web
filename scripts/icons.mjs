/**
 * Generates the PWA icons (PNG) from public/favicon.svg, including maskable variants.
 *
 * Usage: node scripts/icons.mjs   (needs `npx playwright install chromium`)
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const svg = await readFile(new URL("../public/favicon.svg", import.meta.url));
const svgDataUrl = `data:image/svg+xml;base64,${svg.toString("base64")}`;
const outDir = new URL("../public/icons/", import.meta.url).pathname;
await mkdir(outDir, { recursive: true });

const TARGETS = [
  { size: 192, purpose: "any" },
  { size: 512, purpose: "any" },
  { size: 192, purpose: "maskable" },
  { size: 512, purpose: "maskable" },
];

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage();

for (const { size, purpose } of TARGETS) {
  const dataUrl = await page.evaluate(
    async ({ svgDataUrl, size, purpose }) => {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = svgDataUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#0e1116";
      ctx.fillRect(0, 0, size, size);
      // Maskable icons keep the glyph inside the safe zone (80%).
      const scale = purpose === "maskable" ? 0.72 : 0.92;
      const side = size * scale;
      const offset = (size - side) / 2;
      ctx.drawImage(image, offset, offset, side, side);
      return canvas.toDataURL("image/png");
    },
    { svgDataUrl, size, purpose },
  );
  const base64 = dataUrl.split(",")[1];
  const file = `${outDir}icon-${size}-${purpose}.png`;
  await writeFile(file, Buffer.from(base64, "base64"));
  console.log(`wrote ${file}`);
}

await browser.close();
