// Enterprise risk alerts: the company's own crisis-alerting system (Everbridge, Dataminr, Crisis24, Resilinc, Interos and
// the like) alerts at enterprise level (offices, sites, suppliers, travellers) and knows nothing about trials, patients,
// IMP shipments or depots. ClinRadar turns each alert into a signal with its category, hazard, country, window and place,
// then runs the same matching, merging and tiers as every other source. An alert that touches nothing of ours is counted,
// not matched; an alert at one of our facilities in a country nobody monitors is a coverage gap.
//
// An aggregator alone is a single source: it re-reports what others published. It corroborates an incident that another
// source already reported, and it never confirms an impact on a shipment (only the courier or the depot can).
// Fixed rules, no AI. Stored alerts come from POST /api/enterprise-alerts; the demo alerts from demo-data/enterprise-alerts.json.

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";

export const ENTERPRISE_SYSTEM = "Enterprise risk system";
export const MAX_ALERTS_PER_REQUEST = 100;
export const MAX_STORED_ALERTS = 2000;
const SEVERITIES = ["Minor", "Moderate", "Severe", "Extreme"];
// Vendor categories → ClinRadar categories. Anything else becomes "other" and is still counted.
const CATEGORY_RULES = [
  [/strike|labou?r|industrial action|walkout/i, "strike"],
  [/cyclone|typhoon|hurricane|earthquake|tsunami|flood|wildfire|volcan|landslide|natural disaster/i, "natural-hazard"],
  [/heat|cold|snow|ice|storm|winter|weather|rain|fog/i, "weather"],
  [/cyber|it outage|ransomware|system outage|platform/i, "outage"],
  [/power|utilit|water supply|telecom/i, "outage"],
  [/protest|demonstration|unrest|riot|civil/i, "unrest"],
  [/conflict|terror|security|border|curfew|military/i, "security"],
  [/airport|flight|airspace/i, "airport"],
  [/port|shipping|vessel/i, "port"],
  [/road|traffic|motorway|highway|bridge|tunnel/i, "road"],
];
export const enterpriseCategory = alert => CATEGORY_RULES.find(([pattern]) => pattern.test(String(alert.category ?? "")))?.[1] ?? "other";
const sameCity = (a, b) => String(a ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(",")[0].trim() === String(b ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(",")[0].trim();

// ---- reading and storing ----
const storedPath = dataDir => join(dataDir, "enterprise-alerts.json");
export async function readEnterpriseAlerts(root, dataDir) {
  const read = async file => {
    try { return JSON.parse(await readFile(file, "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  };
  const [demo, stored] = await Promise.all([read(join(root, "demo-data", "enterprise-alerts.json")), read(storedPath(dataDir))]);
  if (!demo && !stored) return null;
  // A stored alert with the same id replaces the demo one (a vendor update of the same alert).
  const byId = new Map();
  for (const alert of demo?.alerts ?? []) byId.set(alert.id, { ...alert, origin: "demo" });
  for (const alert of stored?.alerts ?? []) byId.set(alert.id, { ...alert, origin: "webhook" });
  return { system: demo?.system ?? stored?.system ?? ENTERPRISE_SYSTEM, note: demo?.note ?? null, alerts: [...byId.values()] };
}
export async function storeEnterpriseAlerts(dataDir, alerts) {
  await mkdir(dataDir, { recursive: true });
  let current = { alerts: [] };
  try { current = JSON.parse(await readFile(storedPath(dataDir), "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const byId = new Map((current.alerts ?? []).map(alert => [alert.id, alert]));
  for (const alert of alerts) byId.set(alert.id, alert);
  const all = [...byId.values()].sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt))).slice(-MAX_STORED_ALERTS);
  // Write to a temporary file first, so a crash never leaves half a file.
  const temp = storedPath(dataDir) + ".tmp";
  await writeFile(temp, JSON.stringify({ system: ENTERPRISE_SYSTEM, alerts: all }, null, 1), "utf8");
  await rename(temp, storedPath(dataDir));
  return all.length;
}

// ---- validation of an incoming webhook body: one alert, an array, or { alerts: [...] } ----
const isDay = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !Number.isNaN(Date.parse(value + "T00:00:00Z"));
const text = (value, max) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const optionalText = (value, max) => value === undefined || value === null || (typeof value === "string" && value.length <= max);
export function validateAlerts(body, { now = new Date().toISOString() } = {}) {
  const list = Array.isArray(body) ? body : Array.isArray(body?.alerts) ? body.alerts : body && typeof body === "object" ? [body] : null;
  if (!list || !list.length) return { errors: ["Send one alert, an array of alerts, or { \"alerts\": [...] }."] };
  if (list.length > MAX_ALERTS_PER_REQUEST) return { errors: [`At most ${MAX_ALERTS_PER_REQUEST} alerts per request.`] };
  const errors = [];
  const alerts = list.map((alert, index) => {
    const where = `alerts[${index}]`;
    const problems = [];
    if (!alert || typeof alert !== "object" || Array.isArray(alert)) return errors.push(`${where}: not an object.`), null;
    if (!text(alert.id, 80) || !/^[A-Za-z0-9._:-]+$/.test(alert.id)) problems.push("id: letters, digits, . _ : - only, at most 80 characters");
    if (!text(alert.title, 300)) problems.push("title: required, at most 300 characters");
    if (!text(alert.category, 60)) problems.push("category: required, at most 60 characters");
    if (alert.severity !== undefined && !SEVERITIES.includes(alert.severity)) problems.push(`severity: one of ${SEVERITIES.join(", ")}`);
    if (!optionalText(alert.summary, 2000)) problems.push("summary: at most 2,000 characters");
    if (!optionalText(alert.audience, 160)) problems.push("audience: at most 160 characters");
    if (alert.receivedAt !== undefined && Number.isNaN(Date.parse(alert.receivedAt))) problems.push("receivedAt: an ISO 8601 date and time");
    const location = alert.location;
    if (!location || typeof location !== "object" || !/^[A-Z]{2}$/.test(String(location.country))) problems.push("location.country: an ISO 3166-1 alpha-2 code, for example BE");
    else {
      if (!optionalText(location.city, 80) || !optionalText(location.area, 80)) problems.push("location.city and location.area: at most 80 characters");
      if (location.airport !== undefined && !/^[A-Z]{3}$/.test(String(location.airport))) problems.push("location.airport: an IATA code, for example BRU");
      if (location.port !== undefined && !/^[A-Z]{2}[A-Z0-9]{3}$/.test(String(location.port))) problems.push("location.port: a UN/LOCODE, for example BEANR");
      if (location.cities !== undefined && (!Array.isArray(location.cities) || location.cities.length > 20 || !location.cities.every(city => text(city, 80)))) problems.push("location.cities: up to 20 city names");
      if (!optionalText(location.provider, 120)) problems.push("location.provider: at most 120 characters");
    }
    const window = alert.window;
    if (!window || !isDay(window.from) || !isDay(window.to) || window.to < window.from) problems.push("window: { from, to } as YYYY-MM-DD, to not before from");
    if (problems.length) return errors.push(`${where} (${alert?.id ?? "no id"}): ${problems.join("; ")}.`), null;
    return {
      id: alert.id, system: text(alert.system, 120) ? alert.system : ENTERPRISE_SYSTEM, receivedAt: alert.receivedAt ? new Date(alert.receivedAt).toISOString() : now,
      severity: alert.severity ?? null, category: alert.category, title: alert.title.trim(), summary: alert.summary ?? "",
      location: Object.fromEntries(["country", "city", "area", "airport", "port", "cities", "provider"].filter(key => location[key] !== undefined && location[key] !== null).map(key => [key, location[key]])),
      window: { from: window.from, to: window.to }, audience: alert.audience ?? null, illustrative: alert.illustrative === true,
    };
  });
  return errors.length ? { errors } : { alerts };
}

// ---- alerts → signals ----
// Places in the alert become ClinRadar locations: an airport, one of our facilities in the named city, our trial sites in
// the named cities, a provider (a courier's systems), the country's roads for transport and unrest, or else an area that
// is reported but never matched to a route.
export function enterpriseSignal(alert, { facilities = [], sites = [] } = {}) {
  const location = alert.location ?? {};
  const category = enterpriseCategory(alert);
  const effect = alert.summary || alert.title;
  const locations = [];
  if (location.airport) locations.push({ kind: "airport", code: location.airport, effect });
  for (const facility of facilities.filter(item => item.country === location.country && location.city && sameCity(item.city, location.city))) locations.push({ kind: "facility", id: facility.id, effect });
  const named = location.cities ?? (location.city ? [location.city] : []);
  const siteIds = sites.filter(site => site.country === location.country && named.some(city => sameCity(site.city, city))).map(site => site.id);
  if (siteIds.length) locations.push({ kind: "sites", country: location.country, sites: siteIds, cities: named, effect,
    ...(category === "weather" ? { confirmWith: "the depot and the courier", confirm: "that the shipment's qualified packaging holds its temperature range in the forecast conditions" } : {}) });
  if (location.provider) locations.push({ kind: "provider", carrier: location.provider, effect });
  if (["strike", "unrest", "road"].includes(category) && !location.airport) locations.push({ kind: "road", country: location.country, effect });
  if (!locations.length) locations.push({ kind: "area", country: location.country, effect: `The alert names ${[location.city, location.area].filter(Boolean).join(", ") || "the country"}; it is reported, not compared with sites and routes.` });
  return {
    id: `SIG-ENT-${alert.id}`, type: "external", category, title: alert.title, country: location.country, authority: alert.system ?? ENTERPRISE_SYSTEM,
    enterprise: true, enterpriseId: alert.id, illustrative: Boolean(alert.illustrative), severity: alert.severity ?? null, audience: alert.audience ?? null,
    publishedAt: alert.receivedAt, detectedAt: alert.receivedAt, window: alert.window, summary: alert.summary ?? "", locations,
  };
}

// What became of each alert, once the signals are merged, matched and classified.
export function enterpriseSummary({ feed, signals, monitored, facilities = [], routes = {}, names = {}, hazardOf }) {
  if (!feed) return null;
  const lower = value => (/^[A-Z][a-z]/.test(value) && !/^(US|UK|EU|APAC)\b/.test(value) ? value[0].toLowerCase() + value.slice(1) : value);
  const alerts = feed.alerts.map(alert => {
    const country = alert.location?.country;
    const signalId = `SIG-ENT-${alert.id}`;
    const base = { id: alert.id, title: alert.title, receivedAt: alert.receivedAt, severity: alert.severity ?? null, category: alert.category, hazard: hazardOf({ category: enterpriseCategory(alert), authority: alert.system }),
      country, place: [alert.location?.city ?? alert.location?.area, names[country] ?? country].filter(Boolean).join(", "), window: alert.window, audience: alert.audience ?? null,
      illustrative: Boolean(alert.illustrative), origin: alert.origin ?? "demo" };
    if (!monitored.includes(country)) {
      const facility = facilities.find(item => item.country === country && (!alert.location?.city || sameCity(item.city, alert.location.city)));
      const onRoute = Object.entries(routes).filter(([, route]) => route.countries.includes(country)).map(([id]) => id);
      if (facility || onRoute.length) {
        const what = facility ? `the ${lower(facility.name.replace(/, [A-Z][a-z]+$/, ""))}` : `the route of ${onRoute.join(", ")}`;
        return { ...base, kind: "gap", signal: null, shipments: onRoute, facility: facility?.id ?? null,
          result: `touches ${what} in ${names[country] ?? country}, not monitored`,
          suggestion: `Touches ${what} in ${names[country] ?? country}, which nobody monitors for external risk. Suggest turning external risk on for ${names[country] ?? country} in Monitoring scope.` };
      }
      return { ...base, kind: "none", signal: null, shipments: [], result: "no study, site, route or facility affected", note: `${names[country] ?? country} is not monitored, and no study, site, route or facility of ours is there.` };
    }
    const signal = signals.find(item => (item.mergedIds ?? []).includes(signalId));
    if (!signal) return { ...base, kind: "none", signal: null, shipments: [], result: "no study, site, route or facility affected",
      note: alert.location?.provider ? `${alert.location.provider} is not one of our carriers.` : "No planned shipment, collection, site or facility of ours is there on those days." };
    const shipments = [...new Set(signal.matches.map(match => match.shipment))];
    return signal.id === signalId
      ? { ...base, kind: "new", signal: signal.id, shipments, tier: signal.tier, result: `new signal ${signal.id}` }
      : { ...base, kind: "merged", signal: signal.id, shipments, tier: signal.tier, result: `merged into ${signal.id}` };
  });
  const count = kind => alerts.filter(item => item.kind === kind).length;
  return {
    system: feed.system, note: feed.note ?? null, received: alerts.length, matched: count("new") + count("merged"), merged: count("merged"), newSignals: count("new"),
    notMatched: count("none"), gaps: count("gap"), alerts,
  };
}

// The same summary for one kind of hazard (the watch agents read only their own).
export function enterpriseFor(summary, hazard) {
  if (!summary || !hazard) return summary;
  const alerts = summary.alerts.filter(item => item.hazard === hazard);
  const count = kind => alerts.filter(item => item.kind === kind).length;
  return { ...summary, hazard, received: alerts.length, matched: count("new") + count("merged"), merged: count("merged"), newSignals: count("new"), notMatched: count("none"), gaps: count("gap"), alerts };
}
