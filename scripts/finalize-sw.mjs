/**
 * Stamps a build id into dist/sw.js so each deploy gets its own cache name and old caches are
 * dropped on activate. The id is derived from the hashed asset file names.
 */

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const dist = new URL("../dist/", import.meta.url).pathname;
const assets = await readdir(join(dist, "assets")).catch(() => []);
const hash = createHash("sha1").update(assets.sort().join(",")).digest("hex").slice(0, 10);

const swPath = join(dist, "sw.js");
const source = await readFile(swPath, "utf8");
if (!source.includes("__BUILD_ID__")) {
  console.error("finalize-sw: no placeholder found in dist/sw.js");
  process.exit(1);
}
await writeFile(swPath, source.replace("__BUILD_ID__", hash));
console.log(`finalize-sw: cache id ${hash}`);
