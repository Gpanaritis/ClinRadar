// Records the live official feeds ClinRadar reads (UK FCDO travel advice and GDACS alerts) into
// demo-data/recorded-feeds.json, for every country it could monitor: the active-trial countries and every candidate it
// may recommend. The demo then works without internet; Run the check refreshes the copy in .regchain-cache/.
// Usage: node scripts/record-feeds.mjs

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchFeeds } from "../regchain-ai/feeds.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const network = JSON.parse(await readFile(join(root, "demo-data", "supply-network.json"), "utf8"));
const portfolio = JSON.parse(await readFile(join(root, "demo-data", "uk-labelling-portfolio.json"), "utf8"));
const codes = Object.keys(network.geography.fcdo);
const feeds = await fetchFeeds({ codes, geography: network.geography, today: portfolio.assessment_as_of.slice(0, 10) });
const failed = Object.entries(feeds.fcdo).filter(([, entry]) => !entry.ok);
await writeFile(join(root, "demo-data", "recorded-feeds.json"), JSON.stringify({ ...feeds, live: false, note: "A recorded copy of the official feeds, for checks without internet. Metadata only: alert status, update time and change note." }, null, 2) + "\n");
console.log(`Recorded FCDO advice for ${codes.length - failed.length} of ${codes.length} countries and ${feeds.gdacs.events.length} GDACS alerts${feeds.gdacs.ok ? "" : " (GDACS failed: " + feeds.gdacs.error + ")"}.`);
for (const [code, entry] of failed) console.log(`  ${code}: ${entry.error} (${entry.url})`);
