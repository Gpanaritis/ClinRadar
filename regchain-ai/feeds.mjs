// SupplyShield's live official feeds, read only for the countries it monitors.
//
// - UK Foreign, Commonwealth & Development Office (FCDO) travel advice, through the GOV.UK content API: the machine-readable
//   alert status (for example "avoid all travel to parts"), the last update and its change note. Contains public sector
//   information licensed under the Open Government Licence v3.0.
// - GDACS, the Global Disaster Alert and Coordination System (European Commission Joint Research Centre and UN OCHA):
//   orange and red alerts for cyclones, floods, earthquakes, volcanoes, wildfires and droughts.
//
// Only metadata is kept: no article text. A recorded copy (demo-data/recorded-feeds.json, made by scripts/record-feeds.mjs)
// keeps the demo working without internet; a live check writes .regchain-cache/feeds.json, which wins when it is newer.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { cacheDir } from "./sources.mjs";

const AGENT = "SupplyShield-prototype/0.1 (official feed check)";
export const FCDO_ATTRIBUTION = "UK FCDO travel advice via the GOV.UK content API · Open Government Licence v3.0";
export const GDACS_ATTRIBUTION = "GDACS · European Commission Joint Research Centre and UN OCHA";
export const ALERT_WORDS = {
  avoid_all_travel_to_whole_country: "advises against all travel to the whole country",
  avoid_all_but_essential_travel_to_whole_country: "advises against all but essential travel to the whole country",
  avoid_all_travel_to_parts: "advises against all travel to parts of the country",
  avoid_all_but_essential_travel_to_parts: "advises against all but essential travel to parts of the country",
};
const GDACS_TYPES = { TC: "Tropical cyclone", FL: "Flood", EQ: "Earthquake", VO: "Volcano", WF: "Wildfire", DR: "Drought" };

async function getJson(url, timeoutMs) {
  const response = await fetch(url, { headers: { "user-agent": AGENT, accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// A few requests at a time, so a check of sixty countries stays polite and quick.
async function pool(items, size, task) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  }));
  return results;
}

export async function fetchFcdo(codes, slugs, { timeoutMs = 15000 } = {}) {
  const wanted = [...new Set(codes)].filter(code => slugs[code]);
  const entries = await pool(wanted, 6, async code => {
    const slug = slugs[code];
    const url = `https://www.gov.uk/foreign-travel-advice/${slug}`;
    try {
      const item = await getJson(`https://www.gov.uk/api/content/foreign-travel-advice/${slug}`, timeoutMs);
      const details = item.details ?? {};
      return [code, { ok: true, url, title: item.title, updatedAt: item.public_updated_at ?? null, reviewedAt: details.reviewed_at ?? null,
        alertStatus: Array.isArray(details.alert_status) ? details.alert_status.filter(status => ALERT_WORDS[status]) : [],
        change: String(details.change_description ?? "").replace(/\s+/g, " ").trim().slice(0, 300) }];
    } catch (error) {
      return [code, { ok: false, url, error: error.message }];
    }
  });
  return Object.fromEntries(entries);
}

export async function fetchGdacs({ from, to, timeoutMs = 20000, iso3 = {} } = {}) {
  const url = `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF&fromDate=${from}&toDate=${to}&alertlevel=Orange;Red`;
  try {
    const body = await getJson(url, timeoutMs);
    const events = (body.features ?? []).map(feature => {
      const p = feature.properties ?? {};
      const affected = (p.affectedcountries ?? []).map(entry => iso3[entry.iso3] ?? null).filter(Boolean);
      const own = iso3[p.iso3];
      return {
        id: `GDACS-${p.eventtype}-${p.eventid}-${p.episodeid}`, type: p.eventtype, typeName: GDACS_TYPES[p.eventtype] ?? p.eventtype, alert: p.alertlevel,
        name: p.eventname || p.name || "", countries: [...new Set([...(own ? [own] : []), ...affected])], from: String(p.fromdate ?? "").slice(0, 10),
        to: String(p.todate ?? "").slice(0, 10), url: p.url?.report ?? "https://www.gdacs.org/", modifiedAt: p.datemodified ?? null,
      };
    });
    return { ok: true, url, events };
  } catch (error) {
    return { ok: false, url, error: error.message, events: [] };
  }
}

// Every feed for these countries, as one record.
export async function fetchFeeds({ codes, geography, today, fetchedAt = new Date().toISOString() }) {
  const day = 86400000;
  const from = new Date(Date.parse(today) - 14 * day).toISOString().slice(0, 10);
  const to = new Date(Date.parse(today) + 1 * day).toISOString().slice(0, 10);
  const [fcdo, gdacs] = await Promise.all([fetchFcdo(codes, geography.fcdo), fetchGdacs({ from, to, iso3: geography.iso3 })]);
  return { fetchedAt, live: true, attribution: { fcdo: FCDO_ATTRIBUTION, gdacs: GDACS_ATTRIBUTION }, fcdo, gdacs };
}

// The newest copy: the last live check if there is one, otherwise the recorded copy in the repository.
export async function readFeeds(root) {
  const read = async file => { try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; } };
  const [cached, recorded] = await Promise.all([read(join(cacheDir(root), "feeds.json")), read(join(root, "demo-data", "recorded-feeds.json"))]);
  if (cached && (!recorded || cached.fetchedAt > recorded.fetchedAt)) return cached;
  return recorded ? { ...recorded, live: false } : null;
}

// A live check merges with what was there: a country that did not answer keeps its last good record.
export async function saveFeeds(root, feeds) {
  const before = await readFeeds(root);
  const fcdo = { ...(before?.fcdo ?? {}) };
  for (const [code, entry] of Object.entries(feeds.fcdo ?? {})) if (entry.ok || !fcdo[code]?.ok) fcdo[code] = entry;
  const gdacs = feeds.gdacs?.ok ? feeds.gdacs : (before?.gdacs ?? feeds.gdacs);
  const merged = { ...feeds, fcdo, gdacs };
  const dir = cacheDir(root);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "feeds.json"), JSON.stringify(merged, null, 2));
  return merged;
}
