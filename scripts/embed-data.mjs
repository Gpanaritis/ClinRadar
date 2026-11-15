// Copies the data files into RegChain-AI-Dashboard.html, so the page shows the full
// portfolio and the Spain scenario even when it is opened as a file, without the local server.
// It also embeds SupplyShield's assessment as the server would give it to a new workspace (the monitoring scope, the
// signals matched to the shipments and the route checks), computed with an empty database and the recorded feeds.
// The local server still reads the data files on every request, and the page asks it for SupplyShield's live state.
// Usage: node scripts/embed-data.mjs          (update the copies in the page)
//        node scripts/embed-data.mjs --check  (fail if the copies in the page are out of date)

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

// SupplyShield's assessment for a new workspace: a temporary database and cache, so nothing on this computer changes it.
async function supplyShieldJson() {
  const temp = await mkdtemp(join(tmpdir(), "supplyshield-embed-"));
  const saved = { data: process.env.REGCHAIN_DATA_DIR, cache: process.env.REGCHAIN_CACHE_DIR };
  process.env.REGCHAIN_DATA_DIR = join(temp, "data");
  process.env.REGCHAIN_CACHE_DIR = join(temp, "cache");
  try {
    const { loadData, supplyShieldPayload } = await import("../regchain-ai/rules.mjs");
    const { closeDatabase } = await import("../regchain-ai/db.mjs");
    const payload = supplyShieldPayload(await loadData(root));
    closeDatabase(root);
    return JSON.stringify({ ...payload, log: [], embedded: true });
  } finally {
    for (const [key, value] of [["REGCHAIN_DATA_DIR", saved.data], ["REGCHAIN_CACHE_DIR", saved.cache]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
}

const check = process.argv.includes("--check");
let html = await readFile(pagePath, "utf8");
let stale = 0;
const sources = [...await Promise.all(DATA_FILES.map(async ({ id, file }) => ({ id, file, json: await readFile(join(root, file), "utf8") }))),
  { id: "supplyshield-state", file: "SupplyShield assessment (computed)", json: await supplyShieldJson() }];
for (const { id, file, json } of sources) {
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
