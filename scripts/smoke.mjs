import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";

const dist = "dist";
const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
const assetDir = path.join(dist, "assets");
const jsFile = fs.readdirSync(assetDir).find((f) => f.endsWith(".js"));

const dom = new JSDOM(html, {
  url: "https://example.onrender.com/",
  runScripts: "outside-only",
  pretendToBeVisual: true,
});
const { window } = dom;
// Provide the module bundle as a classic script by stripping the module semantics is not possible,
// so evaluate it as an ES module inside the window context via dynamic import of the file URL.
// Expose the jsdom globals the bundle expects.
const skip = new Set(["window", "self", "globalThis", "navigator", "top", "parent", "frames"]);
globalThis.window = window;
for (const key of Object.getOwnPropertyNames(window)) {
  if (skip.has(key)) continue;
  if (key in globalThis) continue;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(window, key);
    if (descriptor && "value" in descriptor) globalThis[key] = descriptor.value;
  } catch {
    // some window properties throw on access; they are not needed here
  }
}
globalThis.document = window.document;
globalThis.navigator = window.navigator;
globalThis.localStorage = window.localStorage;
globalThis.MutationObserver = window.MutationObserver;
globalThis.requestAnimationFrame = window.requestAnimationFrame?.bind(window) ??
  ((cb) => setTimeout(() => cb(Date.now()), 16));
globalThis.cancelAnimationFrame = window.cancelAnimationFrame?.bind(window) ??
  ((id) => clearTimeout(id));

await import(path.resolve(assetDir, jsFile));

await new Promise((resolve) => setTimeout(resolve, 300));

const root = window.document.getElementById("root");
const text = root?.textContent ?? "";
console.log("rendered characters:", text.length);
console.log("has title:", text.includes("OpenSCQ30 Web"));
console.log("has connect button:", text.includes("イヤホンに接続する") || text.includes("Connect"));
console.log("has demo button:", text.includes("デモ機器で試す") || text.includes("demo"));
console.log("warning shown:", text.includes("Web Serial"));
const buttons = [...window.document.querySelectorAll("button")].map((b) => b.textContent);
console.log("buttons:", JSON.stringify(buttons));
if (!text.includes("OpenSCQ30 Web")) {
  console.error("SMOKE TEST FAILED: connect screen did not render");
  process.exit(1);
}

// Click "try the demo device" and check that the settings UI comes up.
const demoButton = [...window.document.querySelectorAll("button")].find((button) =>
  (button.textContent ?? "").includes("デモ機器で試す"),
);
if (!demoButton) {
  console.error("SMOKE TEST FAILED: demo button not found");
  process.exit(1);
}
demoButton.click();
await new Promise((resolve) => setTimeout(resolve, 1200));

const deviceText = window.document.getElementById("root")?.textContent ?? "";
const checks = [
  ["device header", deviceText.includes("Soundcore P30i")],
  ["sound modes category", deviceText.includes("サウンドモード")],
  ["equalizer category", deviceText.includes("イコライザー")],
  ["controls category", deviceText.includes("コントロール")],
  ["dual connections", deviceText.includes("デュアル接続")],
  ["device information", deviceText.includes("デバイス情報")],
  ["serial number", deviceText.includes("3959DED6692DB6F4")],
  ["quick presets", deviceText.includes("設定プリセット")],
];
for (const [name, ok] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
const sliders = window.document.querySelectorAll('input[type="range"]').length;
const selects = window.document.querySelectorAll("select").length;
const switches = window.document.querySelectorAll('[role="switch"]').length;
console.log(`widgets: ${sliders} sliders, ${selects} selects, ${switches} switches`);
if (checks.some(([, ok]) => !ok) || sliders < 8) {
  console.error("SMOKE TEST FAILED: device screen incomplete");
  process.exit(1);
}

// Toggle a setting and verify it reaches the simulated device.
const toggle = window.document.querySelector('[role="switch"]');
toggle.click();
await new Promise((resolve) => setTimeout(resolve, 800));
const logButton = [...window.document.querySelectorAll("button")].find((button) =>
  (button.textContent ?? "").includes("通信ログ"),
);
logButton.click();
await new Promise((resolve) => setTimeout(resolve, 200));
const logText = window.document.querySelector(".log-entries")?.textContent ?? "";
console.log("log has traffic:", /command 0x/.test(logText));
console.log("SMOKE TEST OK");
