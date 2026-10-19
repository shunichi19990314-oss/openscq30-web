/**
 * Smoke test for the production bundle in jsdom.
 *
 * Verifies that the built app renders the connect screen, that the capability checks report the
 * environment honestly, and that clicking the connect button fails gracefully when Web Serial is
 * unavailable. It also asserts that no demo/simulator code or strings leaked into the production
 * bundle (the simulator is test-only).
 */

import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";

const dist = "dist";
const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
const assetDir = path.join(dist, "assets");
const jsFile = fs.readdirSync(assetDir).find((file) => file.endsWith(".js"));

/* ---- 0. the production bundle must not contain the removed demo feature ---- */
const bundleSource = fs.readFileSync(path.join(assetDir, jsFile), "utf8");
for (const forbidden of [
  "デモ機器で試す",
  "connect-demo-device",
  "demo-mode-hint",
  "FakeA3959Device",
  "simulate-tws",
]) {
  if (bundleSource.includes(forbidden)) {
    console.error(`SMOKE TEST FAILED: production bundle contains "${forbidden}"`);
    process.exit(1);
  }
}
console.log("bundle is free of demo/simulator strings");

/* ---- 1. render the connect screen ---- */
const dom = new JSDOM(html, {
  url: "https://example.onrender.com/",
  runScripts: "outside-only",
  pretendToBeVisual: true,
});
const { window } = dom;

const skip = new Set(["window", "self", "globalThis", "navigator", "top", "parent", "frames"]);
globalThis.window = window;
for (const key of Object.getOwnPropertyNames(window)) {
  if (skip.has(key)) continue;
  if (key in globalThis) continue;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(window, key);
    if (descriptor && "value" in descriptor) globalThis[key] = descriptor.value;
  } catch {
    // some window properties throw on access; not needed here
  }
}
globalThis.document = window.document;
globalThis.navigator = window.navigator;
globalThis.localStorage = window.localStorage;
globalThis.MutationObserver = window.MutationObserver;
globalThis.requestAnimationFrame =
  window.requestAnimationFrame?.bind(window) ?? ((cb) => setTimeout(() => cb(Date.now()), 16));
globalThis.cancelAnimationFrame =
  window.cancelAnimationFrame?.bind(window) ?? ((id) => clearTimeout(id));

await import(path.resolve(assetDir, jsFile));
await new Promise((resolve) => setTimeout(resolve, 300));

const rootText = () => window.document.getElementById("root")?.textContent ?? "";
const buttons = () =>
  [...window.document.querySelectorAll("button")].map((button) => button.textContent ?? "");

let text = rootText();
const checks = [
  ["app title", text.includes("OpenSCQ30 Web")],
  ["device model", text.includes("A3959")],
  ["connect CTA", text.includes("イヤホンに接続する")],
  ["browser warning", text.includes("Web Serial")],
  ["no demo button", !text.includes("デモ機器で試す")],
];
for (const [name, ok] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
console.log("buttons:", JSON.stringify(buttons()));

if (checks.some(([, ok]) => !ok)) {
  console.error("SMOKE TEST FAILED: connect screen incomplete");
  process.exit(1);
}

/* ---- 2. the disclosures open ---- */
const summaries = [...window.document.querySelectorAll("summary")];
for (const summary of summaries) summary.click();
await new Promise((resolve) => setTimeout(resolve, 100));
text = rootText();
console.log("disclosures open:", text.includes("接続方法") && text.includes("詳細設定"));

/* ---- 3. clicking connect without Web Serial fails gracefully ---- */
const connectButton = [...window.document.querySelectorAll("button")].find((button) =>
  (button.textContent ?? "").includes("イヤホンに接続する"),
);
if (connectButton && !connectButton.disabled) {
  connectButton.click();
  await new Promise((resolve) => setTimeout(resolve, 200));
  text = rootText();
  const graceful = text.includes("接続できませんでした") || connectButton.disabled;
  console.log(`${graceful ? "ok  " : "FAIL"} connect fails gracefully without Web Serial`);
  if (!graceful) process.exit(1);
} else {
  // jsdom has no navigator.serial, so the button must be disabled: that is the graceful path.
  console.log("ok   connect CTA disabled without Web Serial");
}

console.log("SMOKE TEST OK");
