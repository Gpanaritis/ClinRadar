// Copies the data files into RegChain-AI-Dashboard.html, so the page shows the full
// portfolio and the Spain scenario even when it is opened as a file, without the local server.
// The local server still reads the data files on every request, so it always shows the latest data.
// Usage: node scripts/embed-data.mjs          (update the copies in the page)
//        node scripts/embed-data.mjs --check  (fail if the copies in the page are out of date)

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pagePath = join(root, "RegChain-AI-Dashboard.html");
export const DATA_FILES = [
  { id: "portfolio-data", file: "demo-data/uk-labelling-portfolio.json" },
  { id: "spain-data", file: "demo-data/spain-scenario.json" },
  { id: "specifications-data", file: "demo-data/country-specifications.json" },
  { id: "israel-data", file: "demo-data/israel-scenario.json" },
];

const tagPattern = id => new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)</script>`);

export function embed(html, id, json) {
  const tag = `<script id="${id}" type="application/json">${JSON.stringify(JSON.parse(json)).replace(/</g, "\\u003c")}</script>`;
  const pattern = tagPattern(id);
  if (pattern.test(html)) return html.replace(pattern, () => tag);
  return html.replace('<script id="dashboard-data">', () => `${tag}\r\n<script id="dashboard-data">`);
}

const check = process.argv.includes("--check");
let html = await readFile(pagePath, "utf8");
let stale = 0;
for (const { id, file } of DATA_FILES) {
  const json = await readFile(join(root, file), "utf8");
  const embedded = html.match(tagPattern(id))?.[1];
  const same = embedded !== undefined && JSON.stringify(JSON.parse(embedded)) === JSON.stringify(JSON.parse(json));
  if (check) {
    console.log(`${same ? "ok  " : "OUT OF DATE"} ${id} ← ${file}`);
    if (!same) stale++;
  } else {
    html = embed(html, id, json);
    console.log(`${same ? "unchanged" : "updated"} ${id} ← ${file}`);
  }
}
if (check && stale) {
  console.error("Run: node scripts/embed-data.mjs");
  process.exit(1);
}
if (!check) await writeFile(pagePath, html);
