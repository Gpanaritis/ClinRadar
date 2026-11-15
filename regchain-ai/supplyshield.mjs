// ClinRadar: external risk and country regulatory intelligence for global clinical supply.
//
// The monitoring scope comes only from the company's authorised active-trial portfolio (the CTMS snapshot), read with
// the status policy in config/supplyshield.yaml. Countries with an operationally active trial are monitored
// automatically (CORE_ACTIVE). Other countries are only ever RECOMMENDED, with the evidence for each recommendation,
// and stay off until a person turns monitoring on (MANUALLY_ENABLED). Registered countries that are not active are
// EXCLUDED, and an unknown or contradictory status is shown for confirmation, never guessed. External events are matched
// to the company's own shipments, facilities, routes, deadlines and operating constraints, and each match is classified:
//
//   observed event        a verified item in a monitored country that touches nothing of ours in place and time
//   potential exposure    it touches a shipment, facility or route on the day, but no authorised system has confirmed an impact
//   confirmed disruption  an authorised system (courier, depot, supplier) has confirmed the impact, with a timestamp
//   not affected          it touched one of ours, and an authorised system confirmed normal operation
//
// Evidence strength and business priority are separate from that exposure state. No probabilities, ever.
// Nothing here uses AI and nothing here changes anything: these are the fixed rules the agents and the page rely on.

import { ALERT_WORDS, FCDO_ATTRIBUTION, GDACS_ATTRIBUTION } from "./feeds.mjs";

export const TIER_NAMES = { observed: "Observed event", potential: "Potential exposure", confirmed: "Confirmed disruption", clear: "Not affected after check" };
const TIER_ORDER = { confirmed: 3, potential: 2, clear: 1, observed: 0 };
export const MONITORING_KINDS = { external: "External risk", regulatory: "Regulatory and customs" };
// Who may turn monitoring on or off for a recommended country: Clinical Supply owns external risk, the Regulatory SME
// owns regulatory and customs monitoring.
export const MONITORING_ROLES = { external: "viewer", regulatory: "reviewer" };
export const EVIDENCE_NAMES = { OFFICIAL_CONFIRMED: "Official source", TRUSTED_CORROBORATED: "Two or more trusted sources", SINGLE_SOURCE: "Single source",
  UNVERIFIED_SIGNAL: "Unverified signal", CONFLICTING_EVIDENCE: "Conflicting evidence", UNKNOWN: "Unknown" };
const PRIORITY_ORDER = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };
export const STATUS_WORDS = {
  RECRUITING: "recruiting", ENROLLING_BY_INVITATION: "enrolling by invitation", ACTIVE_NOT_RECRUITING: "active, not recruiting", TREATMENT_ONGOING: "treatment ongoing",
  FOLLOW_UP_ONGOING: "follow-up ongoing", ONGOING: "ongoing", NOT_YET_RECRUITING: "not yet recruiting", SUSPENDED: "suspended", ON_HOLD: "on hold", COMPLETED: "completed",
  TERMINATED: "terminated", WITHDRAWN: "withdrawn", CANCELLED: "cancelled", ARCHIVED: "archived", ACTIVE: "active", NOT_STARTED: "approved, no site activated", CLOSED: "closed", UNKNOWN: "unknown",
};
const DEFAULT_ACTIVE = ["RECRUITING", "ENROLLING_BY_INVITATION", "ACTIVE_NOT_RECRUITING", "TREATMENT_ONGOING", "FOLLOW_UP_ONGOING"];
const INACTIVE = ["COMPLETED", "TERMINATED", "WITHDRAWN", "CANCELLED", "ARCHIVED"];
// Which monitored category each kind of signal belongs to (config: monitored_categories).
const CATEGORY_OF = { strike: "transport", airport: "transport", road: "transport", "official-advice": "geopolitical", "natural-hazard": "natural_disasters",
  weather: "weather", tracking: "cyber_outage", supplier: "supplier", outage: "cyber_outage" };
// The watch team: four agents, each sweeping every monitored country for one kind of hazard. Every signal carries the
// kind it belongs to (`hazard`), so each agent reads only its own.
export const HAZARDS = {
  weather: { agent: "weather", name: "Weather & natural hazards", kind: "external",
    covers: "GDACS alerts (floods, cyclones, earthquakes, wildfires, volcanic ash) and official weather warnings on our lanes and facilities",
    feeds: ["GDACS global disaster alerts"] },
  transport: { agent: "transport", name: "Strikes & transport", kind: "external",
    covers: "Labour action, airport, port and road notices, carrier and depot operations, courier tracking outages",
    feeds: ["Airport, port and transport-authority notices", "Courier and depot systems"] },
  security: { agent: "security", name: "Security & travel advice", kind: "external",
    covers: "UK FCDO travel advice, conflict, unrest and border closures",
    feeds: ["UK FCDO travel advice"] },
  regulatory: { agent: "regulatory", name: "Regulatory & customs", kind: "regulatory",
    covers: "Regulatory sources and changes, import permits and approvals",
    feeds: ["Country Specifications", "UK legislation and MHRA guidance", "EU rules (CTR 536/2014, EudraLex Vol. 10, TARIC)", "Import approvals in the eTMF"] },
};
const HAZARD_OF_CATEGORY = { "natural-hazard": "weather", weather: "weather", strike: "transport", airport: "transport", port: "transport", road: "transport",
  tracking: "transport", outage: "transport", supplier: "transport", "official-advice": "security", security: "security", conflict: "security", unrest: "security",
  border: "security", regulatory: "regulatory", customs: "regulatory", permit: "regulatory" };
// The kind of hazard a signal belongs to, from its category, or else its source.
export function hazardOf(signal) {
  if (signal.type === "regulatory") return "regulatory";
  if (HAZARD_OF_CATEGORY[signal.category]) return HAZARD_OF_CATEGORY[signal.category];
  const source = `${signal.authority ?? ""} ${signal.source ?? ""}`;
  if (/GDACS|weather|meteorolog/i.test(source)) return "weather";
  if (/FCDO|foreign|travel advice/i.test(source)) return "security";
  if (/regulat|ministry of health|customs|MHRA|AEMPS/i.test(source)) return "regulatory";
  return "transport";
}
const HORIZON_DAYS = 130;
const DAY = 86400000;
const DISRUPTED = ["cancelled", "closed", "held", "suspended", "reduced"];
const NORMAL = ["operating", "normal", "on time", "confirmed"];

// ---- dates (business days are Monday to Friday) ----
const addDays = (day, days) => new Date(Date.parse(day + "T00:00:00Z") + days * DAY).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / DAY);
const weekday = day => new Date(day + "T00:00:00Z").getUTCDay();
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function businessDaysAfter(day, count) {
  let date = day;
  for (let left = count; left > 0;) { date = addDays(date, 1); if (![0, 6].includes(weekday(date))) left--; }
  return date;
}
const shortDay = day => new Date(day + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const plainDay = day => new Date(day + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const inWindow = (day, window) => Boolean(window) && day >= window.from && day <= window.to;
const overlaps = (from, to, window) => Boolean(window) && from <= window.to && to >= window.from;
const destinationCode = view => (view.countryId === "uk" ? "GB" : String(view.countryId).toUpperCase());
const list = items => items.length <= 1 ? items.join("") : items.slice(0, -1).join(", ") + " and " + items.at(-1);
// "Bulk freight forwarder" → "bulk freight forwarder", but "EMEA specialty courier" and "German site supply" keep their capitals.
const lowerFirst = value => (/^[A-Z][a-z]/.test(value) && !/^(German|Spanish|Israeli|Greek|Cypriot|Australian|Japanese|US|UK|EU)\b/.test(value) ? value[0].toLowerCase() + value.slice(1) : value);
const laneName = lane => lane.name ?? String(lane.purpose ?? lane.id ?? "this route").split(";")[0].split(",")[0];

// ---- the status policy (config/supplyshield.yaml) ----
export function scopePolicy(config = {}) {
  const scope = config.company_scope ?? {};
  const rec = config.country_recommendations ?? {};
  const active = (Array.isArray(scope.active_statuses) && scope.active_statuses.length ? scope.active_statuses : DEFAULT_ACTIVE).map(item => String(item).toUpperCase());
  return {
    active,
    includeNotYetRecruiting: scope.include_not_yet_recruiting === true,
    includeSuspended: scope.include_suspended === true,
    includeCompleted: scope.include_completed === true,
    supranational: scope.apply_relevant_supranational_rules !== false,
    suggest: {
      land: rec.suggest_land_neighbors !== false, sea: rec.suggest_maritime_or_air_neighbors !== false, transit: rec.suggest_documented_transit_countries !== false,
      alternative: rec.suggest_documented_transit_countries !== false, facility: rec.suggest_supplier_and_depot_countries !== false, hub: rec.suggest_shared_logistics_hubs !== false,
      advice: rec.suggest_time_bounded_geopolitical_exposure !== false, conditional: true,
    },
    // Recommended countries are never switched on automatically, whatever a configuration file says.
    autoEnableRequested: rec.auto_enable_recommendations === true,
    categories: config.monitored_categories ?? {},
    governance: config.governance ?? {},
    cadence: config.monitoring ?? {},
  };
}
function studyClass(status, policy) {
  const value = String(status ?? "").toUpperCase();
  if (policy.active.includes(value)) return "active";
  if (value === "NOT_YET_RECRUITING") return policy.includeNotYetRecruiting ? "active" : "conditional";
  if (["SUSPENDED", "ON_HOLD"].includes(value)) return policy.includeSuspended ? "active" : "conditional";
  if (INACTIVE.includes(value)) return value === "COMPLETED" && policy.includeCompleted ? "active" : "inactive";
  return "unknown";
}

// ---- the active-trial portfolio ----
function studyTitles({ portfolio, spain, israel, ctms }) {
  const titles = Object.fromEntries((portfolio?.studies ?? []).map(study => [study.id, study.title]));
  if (spain?.trial) titles[spain.trial.id] = spain.trial.title;
  if (israel?.trial) titles[israel.trial.id] = israel.trial.title;
  for (const study of ctms?.studies ?? []) if (study.title) titles[study.id] ??= study.title;
  return titles;
}
function sitesByCountry({ portfolio, spain, israel }) {
  const sites = {};
  const add = (code, study, patients) => { (sites[code] ??= []).push({ study, patients: patients ?? 0 }); };
  for (const site of portfolio?.sites ?? []) add(site.country_code, site.study_id, site.patients_on_treatment);
  for (const site of spain?.trial?.sites ?? []) add("ES", spain.trial.id, 0);
  for (const site of israel?.trial?.sites ?? []) add(site.country, israel.trial.id, site.patients);
  return sites;
}

// Monitoring choices for recommended countries: "BE|external" → { enabled, by, role, at, reason }; "BE|review" → dismissal.
const choiceOf = (choices, code, kind) => choices?.[`${code}|${kind}`] ?? null;

export const NO_PORTFOLIO_ANSWER = "I cannot identify your active-trial countries without the authorized CTMS/study-country export. I will not substitute a global list of clinical trial countries or monitor all countries by default. Please connect the portfolio or supply an approved CSV/API response.";

export function buildScope({ network, portfolio, spain, israel, views = [], choices = {}, connected = true, feeds = null, today, config = {}, catalogue = {}, specs = {} }) {
  const ctms = network?.ctms;
  const policy = scopePolicy(config);
  const names = { ...catalogue, ...(network?.geography?.names ?? {}) };
  const regions = network?.geography?.regions ?? {};
  const nameOf = code => names[code] ?? code;
  const policySummary = {
    activeStatuses: policy.active, excludedByDefault: [!policy.includeNotYetRecruiting && "NOT_YET_RECRUITING", !policy.includeSuspended && "SUSPENDED", !policy.includeSuspended && "ON_HOLD", !policy.includeCompleted && "COMPLETED", "TERMINATED", "WITHDRAWN", "CANCELLED", "ARCHIVED"].filter(Boolean),
    autoEnableRecommendations: false, autoEnableRequested: policy.autoEnableRequested, supranational: policy.supranational,
    categories: Object.entries(policy.categories).filter(([, on]) => on === true).map(([name]) => name),
    optionalOff: Object.entries(policy.categories).filter(([, on]) => on === false).map(([name]) => name),
    governance: policy.governance, cadence: policy.cadence, suggest: policy.suggest,
  };
  if (!ctms || !connected) {
    return {
      status: "undetermined",
      message: "ClinRadar cannot identify the active-trial countries without the authorised CTMS or study-country export, so it monitors nothing. It will not substitute a global list of clinical-trial countries or monitor every country by default.",
      agentAnswer: NO_PORTFOLIO_ANSWER,
      source: ctms ? { system: ctms.system, snapshotAt: null, definition: ctms.definition } : null,
      studies: { total: 0, active: 0, excluded: [] }, countries: [], notInScope: [], recommendations: [], reviewWarnings: [], supranational: [], bordersUnknown: [],
      coverage: { countries: 0, full: 0, partial: 0, gaps: [] }, monitored: { external: [], regulatory: [] }, config: policySummary,
    };
  }
  const titles = studyTitles({ portfolio, spain, israel, ctms });
  const sites = sitesByCountry({ portfolio, spain, israel });
  const horizon = addDays(today, HORIZON_DAYS);
  const planned = views.filter(view => view.dispatch >= today && view.dispatch <= horizon);
  const shipmentsTo = code => planned.filter(view => destinationCode(view) === code);
  const active = new Map();
  const excludedEntries = new Map();
  const reviewWarnings = [];
  const conditional = new Map();
  const excludedStudies = [];
  let activeStudies = 0;
  for (const study of ctms.studies) {
    const kind = studyClass(study.status, policy);
    const title = titles[study.id] ?? study.id;
    if (kind === "active") activeStudies++;
    if (kind === "unknown") {
      for (const code of Object.keys(study.countries)) reviewWarnings.push({ code, name: nameOf(code), study: study.id, title, status: String(study.status ?? "UNKNOWN"), note: "The study's status is unknown or not in the status policy: confirm it with the study owner." });
      continue;
    }
    if (kind !== "active") excludedStudies.push({ id: study.id, title, status: String(study.status).toUpperCase(), statusWords: STATUS_WORDS[String(study.status).toUpperCase()] ?? String(study.status), kind });
    for (const [code, entry] of Object.entries(study.countries)) {
      const status = String(entry.status ?? "UNKNOWN").toUpperCase();
      const record = { study: study.id, title, studyStatus: String(study.status).toUpperCase(), status, statusWords: STATUS_WORDS[status] ?? status, note: entry.note ?? "" };
      if (status === "UNKNOWN") { reviewWarnings.push({ code, name: nameOf(code), ...record }); continue; }
      if (kind === "active" && status === "ACTIVE") (active.get(code) ?? active.set(code, []).get(code)).push({ id: study.id, status: record.studyStatus });
      else if (kind === "conditional" && status === "ACTIVE" && (Number(entry.inventoryOnSite) > 0 || shipmentsTo(code).length)) (conditional.get(code) ?? conditional.set(code, []).get(code)).push({ ...record, inventory: Number(entry.inventoryOnSite) || 0, shipments: shipmentsTo(code).map(view => view.id) });
      else (excludedEntries.get(code) ?? excludedEntries.set(code, []).get(code)).push(record);
    }
  }
  const eu = network?.geography?.supranational?.EU;
  const countries = [...active.entries()].map(([code, studies]) => {
    const studyIds = studies.map(item => item.id);
    const here = (sites[code] ?? []).filter(site => studyIds.includes(site.study));
    const fcdo = feeds?.fcdo?.[code];
    const external = code === "GB" ? (feeds?.gdacs?.ok ? "partial" : "degraded") : !fcdo ? "none" : !fcdo.ok ? "degraded" : feeds?.live ? "live" : "recorded";
    const countryId = code === "GB" ? "uk" : code.toLowerCase();
    const regulatory = specs[countryId] ? "specification" : "gap";
    const gaps = [
      code === "GB" ? "UK FCDO travel advice does not cover the UK itself: natural hazards come from GDACS only." : "",
      external === "degraded" ? "The UK FCDO advice could not be read at the last check: the last good record is used." : "",
      external === "none" ? "No travel-advice source for this country." : "",
      regulatory === "gap" ? "No Country Specification and no national regulator source registered: regulatory and customs coverage is a gap." : "",
    ].filter(Boolean);
    return {
      code, name: nameOf(code), region: regions[code] ?? "Other", group: "CORE_ACTIVE",
      studies: studies.map(item => ({ id: item.id, title: titles[item.id] ?? item.id, status: item.status })),
      statuses: [...new Set(studies.map(item => item.status))],
      sites: here.length, patients: here.reduce((sum, site) => sum + site.patients, 0), shipments: shipmentsTo(code).map(view => view.id),
      supranational: policy.supranational && eu?.members.includes(code) ? ["EU"] : [],
      coverage: { external, regulatory, gaps },
      monitoring: Object.fromEntries(Object.keys(MONITORING_KINDS).map(kind => [kind, { on: true, by: "Active-trial portfolio", locked: true }])),
    };
  }).sort((a, b) => a.region.localeCompare(b.region) || b.studies.length - a.studies.length || a.name.localeCompare(b.name));
  const inScope = new Set(active.keys());
  const flagged = new Set(reviewWarnings.map(item => item.code));
  const notInScope = [...excludedEntries.entries()].filter(([code]) => !inScope.has(code) && !flagged.has(code))
    .map(([code, entries]) => ({ code, name: nameOf(code), region: regions[code] ?? "Other", scopeClass: "EXCLUDED", entries }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Candidates and the evidence for each. Only documented links and geography count: no list of countries judged hostile.
  const candidates = new Map();
  const reason = (code, item) => {
    if (inScope.has(code) || !code || !policy.suggest[item.kind]) return;
    const entry = candidates.get(code) ?? candidates.set(code, { code, reasons: [], related: new Set() }).get(code);
    if (item.with) entry.related.add(item.with);
    if (!entry.reasons.some(existing => existing.kind === item.kind && existing.text === item.text)) entry.reasons.push(item);
  };
  for (const [code, entries] of conditional) for (const entry of entries) {
    reason(code, { kind: "conditional", label: `${(STATUS_WORDS[entry.studyStatus] ?? entry.studyStatus).replace(/^./, letter => letter.toUpperCase())} study with product on site`, text: `${entry.study} (${entry.title}) is ${STATUS_WORDS[entry.studyStatus] ?? entry.studyStatus.toLowerCase()}, so its countries are not monitored automatically. ${entry.note || (entry.inventory ? `${entry.inventory} kits are still at the site.` : "")}${entry.shipments.length ? ` ${entry.shipments.length} shipments are still planned.` : ""}`.trim(), objects: entry.shipments });
  }
  const facilities = Object.fromEntries((network.facilities ?? []).map(item => [item.id, item]));
  const airports = network.airports ?? {};
  for (const facility of network.facilities ?? []) {
    const leaving = planned.filter(view => view.originFacility === facility.id);
    const detail = facility.kind === "depot" ? (leaving.length ? `${leaving.length} planned shipment${leaving.length === 1 ? "" : "s"} leave from it in the next four months.` : facility.role) : facility.role;
    const where = facility.name.includes(facility.city) ? "" : ` (${facility.city})`;
    reason(facility.country, { kind: "facility", label: "Facility dependency", text: `Hosts the ${lowerFirst(facility.name)}${where}. ${detail}`, objects: leaving.map(view => view.id) });
  }
  for (const lane of network.lanes ?? []) {
    const moving = planned.filter(view => view.lane === lane.id).map(view => view.id);
    const hubCountry = lane.via ? airports[lane.via]?.country : null;
    for (const code of lane.countries) if (code !== hubCountry) reason(code, { kind: "transit", label: "Documented transit route", text: `${laneName(lane)} (${lowerFirst(lane.carrier)}, ${lane.mode})`, objects: moving });
    if (hubCountry) reason(hubCountry, { kind: "hub", label: "Shared logistics hub", text: `${airports[lane.via].name} is the transfer hub for ${lowerFirst(laneName(lane))} (${lowerFirst(lane.carrier)}, ${lane.purpose.split(";").slice(1).join(";").trim() || "scheduled"}).`, objects: moving });
  }
  for (const alternative of network.departure_alternatives ?? []) {
    const lane = (network.lanes ?? []).find(item => item.id === alternative.lane);
    const airport = airports[alternative.airport];
    if (airport && !alternative.booked) reason(airport.country, { kind: "alternative", label: "Documented alternative route", text: `The ${alternative.carrier} can fly ${lowerFirst(laneName(lane ?? {}))} from ${airport.name} (${alternative.days.join(", ")}), a recovery route if the booked departure fails.`, objects: [] });
  }
  const land = network.geography?.land ?? {};
  const sea = network.geography?.sea ?? {};
  const bordersUnknown = [];
  for (const country of countries) {
    if (land[country.code] === undefined) bordersUnknown.push({ code: country.code, name: country.name, text: `Border relation unknown: there are no adjacency data for ${country.name}, so no land neighbours are suggested.` });
    const what = `${country.sites} site${country.sites === 1 ? "" : "s"}${country.shipments.length ? `, ${country.shipments.length} planned shipment${country.shipments.length === 1 ? "" : "s"}` : ""}`;
    for (const code of land[country.code] ?? []) reason(code, { kind: "land", label: "Land border", text: `${country.name} (${what})`, with: country.code });
    for (const code of sea[country.code] ?? []) reason(code, { kind: "sea", label: "Sea neighbour", text: `${country.name} (${what})`, with: country.code });
  }
  // One line per kind of evidence: every route through the country together, every neighbour together.
  for (const entry of candidates.values()) {
    const merged = [];
    for (const item of entry.reasons) {
      const same = ["transit", "land", "sea"].includes(item.kind) ? merged.find(other => other.kind === item.kind) : null;
      if (same) { same.parts.push(item.text); same.objects = [...new Set([...(same.objects ?? []), ...(item.objects ?? [])])]; }
      else merged.push({ ...item, parts: [item.text] });
    }
    entry.reasons = merged.map(({ parts, with: _with, ...item }) => {
      if (item.kind === "land") return { ...item, text: `Shares a land border with ${list(parts)}.` };
      if (item.kind === "sea") return { ...item, text: `Across the sea from ${list(parts)}. A sea neighbour, not a land border.` };
      if (item.kind === "transit") return parts.length > 1 ? { ...item, label: "Documented transit routes", text: `${parts.length} documented routes pass through ${nameOf(entry.code)}: ${list(parts.map(lowerFirst))}.` }
        : { ...item, text: `${parts[0]} passes through ${nameOf(entry.code)}.` };
      return item;
    });
  }
  // Current official advice, for candidates only: evidence of a cross-border or security risk, with its date and source.
  for (const [code, entry] of candidates) {
    const advice = feeds?.fcdo?.[code];
    if (policy.suggest.advice && advice?.ok && advice.alertStatus?.length) {
      entry.reasons.push({ kind: "advice", label: "Current official advice", text: `The UK FCDO ${advice.alertStatus.map(status => ALERT_WORDS[status]).join(", and ")} (in force at the last check; last changed ${plainDay(String(advice.updatedAt).slice(0, 10))}).`,
        evidence: { source: FCDO_ATTRIBUTION, url: advice.url, at: advice.updatedAt, fetchedAt: feeds.fetchedAt, live: Boolean(feeds.live) } });
    }
  }
  const SUPPLY = ["facility", "transit", "hub", "alternative"];
  const GROUP_ORDER = { supply: 0, conditional: 1, advice: 2, proximity: 3 };
  const recommendations = [...candidates.values()].map(entry => {
    const group = entry.reasons.some(item => SUPPLY.includes(item.kind)) ? "supply" : entry.reasons.some(item => item.kind === "conditional") ? "conditional" : entry.reasons.some(item => item.kind === "advice") ? "advice" : "proximity";
    const reg = [...(excludedEntries.get(entry.code) ?? []), ...reviewWarnings.filter(item => item.code === entry.code)];
    const monitoring = Object.fromEntries(Object.keys(MONITORING_KINDS).map(kind => {
      const choice = choiceOf(choices, entry.code, kind);
      return [kind, choice?.enabled ? { on: true, by: choice.by, role: choice.role, at: choice.at, reason: choice.reason ?? "" } : { on: false, ...(choice ? { by: choice.by, at: choice.at, reason: choice.reason ?? "" } : {}) }];
    }));
    const review = choiceOf(choices, entry.code, "review");
    return {
      code: entry.code, name: nameOf(entry.code), region: regions[entry.code] ?? "Other", group, reasons: entry.reasons,
      scopeClass: monitoring.external.on || monitoring.regulatory.on ? "MANUALLY_ENABLED" : "RECOMMENDED",
      relatedActive: [...entry.related],
      registered: reg.length ? reg.map(item => `${item.study}: ${item.statusWords ?? item.status}`).join("; ") : null,
      objects: [...new Set(entry.reasons.flatMap(item => item.objects ?? []))],
      monitoring,
      review: review?.dismissed ? { state: "dismissed", by: review.by, at: review.at, reason: review.reason ?? "" } : { state: "open" },
    };
  }).sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || b.objects.length - a.objects.length || b.reasons.length - a.reasons.length || a.name.localeCompare(b.name));
  const monitored = Object.fromEntries(Object.keys(MONITORING_KINDS).map(kind => [kind, [...inScope, ...recommendations.filter(item => item.monitoring[kind].on).map(item => item.code)]]));
  // Coverage: what each monitored country is watched with, and what is missing.
  const noRoute = views.filter(view => view.dispatch >= today && !view.lane).map(view => view.id);
  const gaps = [
    ...countries.flatMap(country => country.coverage.gaps.map(text => ({ code: country.code, name: country.name, text }))),
    ...recommendations.filter(item => item.monitoring.regulatory.on && !specs[item.code.toLowerCase()]).map(item => ({ code: item.code, name: item.name, text: "Regulatory and customs monitoring is on, but no Country Specification or regulator source is registered yet." })),
    ...(noRoute.length ? [{ code: null, name: "Shipments", text: `${noRoute.length} planned shipments have no route on record: ${noRoute.join(", ")}. Their external risk is not assessed.` }] : []),
  ];
  const supranational = policy.supranational && eu ? [{ id: "EU", name: eu.name, appliesTo: countries.filter(country => country.supranational.includes("EU")).map(country => country.code), rules: eu.rules,
    note: `EU rules (${eu.rules}) are assessed for the ${countries.filter(country => country.supranational.includes("EU")).length} active-trial EU countries. No other EU country is switched on because of them.` }] : [];
  const conditionalStudies = excludedStudies.filter(item => item.kind === "conditional");
  // Say what each left-out study means for its countries.
  for (const study of excludedStudies) {
    const codes = Object.keys(ctms.studies.find(item => item.id === study.id)?.countries ?? {});
    const covered = codes.filter(code => inScope.has(code));
    study.countries = codes;
    study.note = covered.length === codes.length ? `Not counted; ${list(covered.map(nameOf))} ${covered.length === 1 ? "is" : "are"} monitored through other active studies.`
      : study.kind === "conditional" ? `Not counted by default; ${list(codes.filter(code => !inScope.has(code)).map(nameOf))} can be turned on from the recommendations.`
      : `Not counted; ${list(codes.filter(code => !inScope.has(code)).map(nameOf))} ${codes.filter(code => !inScope.has(code)).length === 1 ? "is" : "are"} not monitored.`;
  }
  return {
    status: "determined",
    message: `${countries.length} countries have an operationally active trial and are monitored automatically. ${recommendations.length} more are recommended, each with its evidence, and stay off until someone turns them on.${reviewWarnings.length ? ` ${reviewWarnings.length} status${reviewWarnings.length === 1 ? " needs" : "es need"} confirmation.` : ""}`,
    source: { system: ctms.system, snapshotAt: ctms.snapshot_at, definition: ctms.definition },
    studies: { total: ctms.studies.length, active: activeStudies, excluded: excludedStudies, conditional: conditionalStudies.length },
    countries, notInScope, recommendations, monitored, reviewWarnings, supranational, bordersUnknown,
    coverage: { countries: countries.length, full: countries.filter(country => !country.coverage.gaps.length).length, partial: countries.filter(country => country.coverage.gaps.length).length, gaps },
    facilities: Object.values(facilities).map(item => ({ id: item.id, name: item.name, kind: item.kind, country: item.country, city: item.city })),
    config: policySummary,
  };
}

// ---- routes ----
// The legs of one planned shipment, from the depot to the site, with the day each leg happens. `overrides` describe an
// option being tested: a new dispatch date, or a different departure airport (`via`).
export function routeFor(network, view, overrides = {}) {
  const code = destinationCode(view);
  const lanes = network?.lanes ?? [];
  const lane = lanes.find(item => item.to.includes(code) && item.carrier === view.carrier) ?? lanes.find(item => item.to.includes(code));
  if (!lane) return null;
  const facility = (network.facilities ?? []).find(item => item.id === lane.from);
  const airports = network.airports ?? {};
  const dispatch = overrides.dispatch ?? view.dispatch;
  const transit = view.transitBusinessDays ?? lane.transitBusinessDays;
  const delivery = overrides.dispatch || !view.delivery ? businessDaysAfter(dispatch, transit) : view.delivery;
  const legs = [{ kind: "collection", facility: facility.id, name: facility.name, country: facility.country, date: dispatch }];
  const problems = [];
  let departure = lane.departure;
  if (lane.mode === "air") {
    if (overrides.via && overrides.via !== lane.departure) {
      const alternative = (network.departure_alternatives ?? []).find(item => item.lane === lane.id && item.airport === overrides.via);
      if (!alternative) problems.push(`the ${lane.carrier} has no qualified departure from ${overrides.via} on this route.`);
      else departure = overrides.via;
    }
    const roadCountries = [...new Set([facility.country, airports[departure]?.country].filter(Boolean))];
    const flight = businessDaysAfter(dispatch, 1);
    const option = (network.departure_alternatives ?? []).find(item => item.lane === lane.id && item.airport === departure);
    if (option && !option.days.includes(WEEKDAY_NAMES[weekday(flight)])) problems.push(`no ${lane.carrier} departure from ${departure} on ${shortDay(flight)}; it flies ${option.days.join(", ")}.`);
    legs.push({ kind: "road", countries: roadCountries, from: dispatch, to: dispatch, toNode: departure, label: `Road from the ${facility.name} to ${airports[departure]?.name ?? departure}` });
    legs.push({ kind: "air", departure, hub: lane.via ?? null, arrival: lane.arrival, date: flight, countries: [...new Set([airports[departure]?.country, lane.via ? airports[lane.via]?.country : null, airports[lane.arrival]?.country].filter(Boolean))],
      label: `Flight ${departure} → ${lane.via ? lane.via + " → " : ""}${lane.arrival}` });
    legs.push({ kind: "customs", airport: lane.arrival, country: airports[lane.arrival]?.country ?? code, date: businessDaysAfter(dispatch, 2), label: `Import clearance at ${airports[lane.arrival]?.name ?? lane.arrival}` });
  } else {
    legs.push({ kind: "road", countries: lane.countries, from: dispatch, to: delivery, label: `Road, ${lane.countries.join(" → ")}` });
  }
  legs.push({ kind: "delivery", country: code, site: view.siteId, date: delivery, label: `Delivery to ${view.site}` });
  const countries = [...new Set(legs.flatMap(leg => leg.countries ?? [leg.country]).filter(Boolean))];
  const nodes = [facility.name, ...(lane.mode === "air" ? [departure, ...(lane.via ? [lane.via] : []), lane.arrival] : lane.countries), view.site];
  return { lane: lane.id, carrier: lane.carrier, mode: lane.mode, facility: facility.id, departure, arrival: lane.arrival ?? null, dispatch, delivery, legs, countries, nodes, problems };
}

// ---- signals ----
// Live official-feed items for the countries ClinRadar monitors for external risk.
function feedSignals(feeds, monitored, names, today) {
  if (!feeds) return [];
  const signals = [];
  const recent = addDays(today, -30);
  for (const code of monitored) {
    const advice = feeds.fcdo?.[code];
    if (!advice?.ok) continue;
    const updated = String(advice.updatedAt ?? "").slice(0, 10);
    const alerts = advice.alertStatus ?? [];
    if (!alerts.length && !(updated >= recent)) continue;
    const whole = alerts.some(status => status.endsWith("whole_country"));
    signals.push({
      id: `FCDO-${code}-${updated}`, type: "external", category: "official-advice", live: true, illustrative: false, evidence: "OFFICIAL_CONFIRMED",
      title: alerts.length ? `UK FCDO travel advice for ${names[code] ?? code}: ${alerts.map(status => ALERT_WORDS[status]).join(", and ")}` : `UK FCDO travel advice for ${names[code] ?? code} updated`,
      country: code, authority: "UK Foreign, Commonwealth & Development Office", source: FCDO_ATTRIBUTION, url: advice.url, publishedAt: advice.updatedAt, detectedAt: feeds.fetchedAt,
      window: null, standing: true, summary: advice.change || "No change note.",
      locations: alerts.length ? [{ kind: whole ? "country" : "area", country: code, effect: whole ? "Applies to the whole country." : "Applies to named parts of the country. Matching needs the advised areas mapped against sites and routes." }] : [],
    });
  }
  for (const event of feeds.gdacs?.events ?? []) {
    const touched = event.countries.filter(code => monitored.includes(code));
    if (!touched.length) continue;
    signals.push({
      id: event.id, type: "external", category: "natural-hazard", hazardType: event.type, live: true, illustrative: false, evidence: "OFFICIAL_CONFIRMED",
      title: `${event.typeName}, ${event.alert.toLowerCase()} alert: ${event.name}`, country: touched[0], countries: touched,
      authority: "Global Disaster Alert and Coordination System", source: GDACS_ATTRIBUTION, url: event.url, publishedAt: event.modifiedAt, detectedAt: feeds.fetchedAt,
      window: { from: event.from, to: event.to }, summary: `${event.typeName} alert for ${list(touched.map(code => names[code] ?? code))}${event.countries.length > touched.length ? ` and ${event.countries.length - touched.length} other countries` : ""}.`,
      locations: [{ kind: event.type === "DR" ? "slow-onset" : "country-wide", countries: touched, effect: event.type === "DR" ? "A drought has no direct effect on transport." : "The location within the country is not yet compared with sites and routes." }],
    });
  }
  return signals;
}

// Two reports of one event become one signal with two sources: the same incident key, or the same kind of event in the
// same country, on overlapping days, at the same place.
function mergeDuplicates(signals) {
  const out = [];
  const placeOf = signal => (signal.locations ?? []).map(location => location.code ?? location.id ?? location.country).find(Boolean) ?? signal.country;
  for (const signal of signals) {
    const source = { authority: signal.authority, url: signal.url ?? null, publishedAt: signal.publishedAt ?? null, illustrative: Boolean(signal.illustrative), id: signal.id };
    const twin = out.find(item => (signal.incident && item.incident === signal.incident) || (!signal.live && !item.live && item.category === signal.category && item.country === signal.country
      && item.window && signal.window && overlaps(signal.window.from, signal.window.to, item.window) && placeOf(item) === placeOf(signal)));
    if (twin) { twin.sources.push(source); twin.mergedIds.push(signal.id); continue; }
    out.push({ ...signal, sources: [source], mergedIds: [signal.id] });
  }
  return out.map(signal => ({ ...signal, evidence: signal.evidence ?? (signal.sources.length > 1 ? "TRUSTED_CORROBORATED" : "SINGLE_SOURCE") }));
}

export function collectSignals({ recorded, feeds, scope, names, today, policy = scopePolicy() }) {
  const monitored = scope.monitored?.external ?? [];
  const allowed = signal => {
    const category = signal.category === "natural-hazard" && signal.hazardType === "DR" ? "weather" : CATEGORY_OF[signal.category] ?? signal.category;
    return policy.categories[category] !== false;
  };
  const own = (recorded?.signals ?? []).filter(signal => monitored.includes(signal.country)).map(signal => ({ ...signal, live: false }));
  return mergeDuplicates([...own, ...feedSignals(feeds, monitored, names, today)]).filter(allowed).map(signal => ({ ...signal, hazard: hazardOf(signal) }));
}

// What a signal touches on one route, leg by leg.
function legMatches(signal, route) {
  const matches = [];
  for (const location of signal.locations ?? []) {
    for (const leg of route.legs) {
      if (location.kind === "airport" && leg.kind === "air" && [leg.departure, leg.hub, leg.arrival].includes(location.code) && inWindow(leg.date, signal.window))
        matches.push({ leg: "air", node: location.code, date: leg.date, label: leg.label, effect: location.effect });
      if (location.kind === "facility" && leg.kind === "collection" && leg.facility === location.id && inWindow(leg.date, signal.window))
        matches.push({ leg: "collection", node: location.id, date: leg.date, label: `Collection at the ${leg.name}`, effect: location.effect });
      if (location.kind === "road" && leg.kind === "road" && leg.countries.includes(location.country) && overlaps(leg.from, leg.to, signal.window))
        matches.push({ leg: "road", node: location.country, date: leg.from > signal.window.from ? leg.from : signal.window.from, label: leg.label, effect: location.effect });
      if (location.kind === "country-wide" && (leg.countries ?? [leg.country]).some(code => location.countries.includes(code)) && overlaps(leg.from ?? leg.date, leg.to ?? leg.date, signal.window))
        matches.push({ leg: leg.kind, node: (leg.countries ?? [leg.country]).find(code => location.countries.includes(code)), date: leg.from ?? leg.date, label: leg.label, effect: location.effect });
      if (location.kind === "country" && (leg.countries ?? [leg.country]).includes(location.country))
        matches.push({ leg: leg.kind, node: location.country, date: leg.from ?? leg.date, label: leg.label, effect: location.effect });
    }
    // A courier's tracking outage touches only shipments of that courier moving during the outage, and only their visibility.
    if (location.kind === "provider" && route.carrier === location.carrier && overlaps(route.dispatch, route.delivery, signal.window))
      matches.push({ leg: "tracking", node: location.carrier, date: route.dispatch > signal.window.from ? route.dispatch : signal.window.from, label: `Tracking with the ${location.carrier}`, effect: location.effect, trackingOnly: true });
  }
  // One match per leg is enough.
  return matches.filter((match, index) => matches.findIndex(other => other.leg === match.leg && other.node === match.node && other.date === match.date) === index);
}

// The evidence an authorised system holds for one matched leg, if any. A record counts only for the booking it describes.
function evidenceFor(network, shipmentId, match) {
  const records = network?.operational_status ?? [];
  if (match.leg === "collection") return records.find(item => item.facility === match.node && item.date === match.date) ?? null;
  return records.find(item => item.shipment === shipmentId && item.leg === match.leg && item.node === match.node && item.date === match.date) ?? null;
}
const systemFor = leg => (leg === "collection" ? "the depot" : "the courier");

function classify(network, shipmentId, match, { booked = true } = {}) {
  // A depot's own status for a day holds for every collection that day; a courier record holds only for its booking.
  const evidence = booked || match.leg === "collection" ? evidenceFor(network, shipmentId, match) : null;
  const status = evidence?.status;
  // Lost tracking is lost visibility, never a physical disruption.
  const tier = match.trackingOnly ? "potential" : !evidence ? "potential" : DISRUPTED.includes(status) ? "confirmed" : NORMAL.includes(status) ? "clear" : "potential";
  return {
    tier, evidence: evidence ? { id: evidence.id, source: evidence.source, status, detail: evidence.detail, recordedAt: evidence.recordedAt, nextAvailable: evidence.nextAvailable ?? null } : null,
    missing: match.trackingOnly ? "Tracking visibility lost: the physical shipment is not known to be affected. Ask the courier for a manual status." :
      tier === "potential" ? `No confirmation yet from ${systemFor(match.leg)} about the ${match.leg === "air" ? "flight" : match.leg} on ${plainDay(match.date)}.` : null,
  };
}

// Business priority, from the exposure state, the days left and the site's stock. Fixed rules, no probabilities.
function priorityOf(tier, { date, today, siteStockDays, daysWithoutTreatment = 0 }) {
  if (tier === "confirmed") return daysWithoutTreatment > 0 || (siteStockDays !== null && siteStockDays !== undefined && siteStockDays <= 7) ? "CRITICAL" : "HIGH";
  if (tier === "potential") return daysBetween(today, date) <= 14 ? "MEDIUM" : "LOW";
  return "INFO";
}

// The patients behind a confirmed disruption: when the site's stock runs out, and what happens if nobody acts and the
// courier simply rebooks the next free departure it reported. Dates only, from the records; no estimate of likelihood.
const isIsraeliWeekendDay = day => [5, 6].includes(weekday(day));
function patientImpact(view, route, evidence, today) {
  const stock = view.siteStockDays ?? null;
  const runsOutOn = stock !== null ? addDays(today, stock) : null;
  const impact = { patients: view.patients ?? null, siteStockDays: stock, runsOutOn, plannedDelivery: route?.delivery ?? null, ifNothingDone: null };
  if (evidence?.nextAvailable && route?.mode === "air") {
    let delivery = businessDaysAfter(evidence.nextAvailable, 2);
    const offDay = destinationCode(view) === "IL" ? isIsraeliWeekendDay : day => [0, 6].includes(weekday(day));
    while (offDay(delivery)) delivery = addDays(delivery, 1);
    impact.ifNothingDone = { rebookedFlight: evidence.nextAvailable, delivery, daysWithoutTreatment: runsOutOn ? Math.max(0, daysBetween(runsOutOn, delivery)) : null };
  }
  return impact;
}
export const COST_OF_DELAY = { perDay: 55716, currency: "USD", phase: "Phase III", basis: "direct cost of one day of trial delay, 2023 dollars", source: "Tufts CSDD, published 2024",
  url: "https://www.appliedclinicaltrialsonline.com/view/how-much-does-a-day-of-delay-in-a-clinical-trial-really-cost-" };
const impactSentence = impact => {
  const nothing = impact?.ifNothingDone;
  if (!nothing) return "";
  const who = impact.patients ? `${impact.patients} patients` : "the site's patients";
  return nothing.daysWithoutTreatment > 0
    ? ` If nothing is done, the courier's next free flight (${plainDay(nothing.rebookedFlight)}) delivers on ${shortDay(nothing.delivery)}; the site runs out on ${plainDay(impact.runsOutOn)}, so ${who} would go ${nothing.daysWithoutTreatment} day${nothing.daysWithoutTreatment === 1 ? "" : "s"} without treatment.`
    : ` If nothing is done, the courier's next free flight (${plainDay(nothing.rebookedFlight)}) delivers on ${shortDay(nothing.delivery)}, before the site runs out${impact.runsOutOn ? ` on ${plainDay(impact.runsOutOn)}` : ""}.`;
};

// Every signal against every planned shipment, with the tier of each match and of the signal as a whole.
export function assessSignals({ signals, network, views, today }) {
  const horizon = addDays(today, HORIZON_DAYS);
  const routes = Object.fromEntries(views.map(view => [view.id, routeFor(network, view)]).filter(([, route]) => route));
  const byShipment = {};
  const assessed = signals.map(signal => {
    const ended = signal.window && signal.window.to < today;
    const matches = [];
    const notes = [];
    if (ended) notes.push(`Ended on ${plainDay(signal.window.to)}.`);
    if (!ended) {
      for (const view of views) {
        const route = routes[view.id];
        if (!route || view.dispatch < today || view.dispatch > horizon) continue;
        for (const match of legMatches(signal, route)) {
          const verdict = classify(network, view.id, match);
          const stock = view.siteStockDays ?? null;
          const impact = verdict.tier === "confirmed" ? patientImpact(view, route, verdict.evidence, today) : null;
          const entry = {
            shipment: view.id, site: view.site, country: destinationCode(view), leg: match.leg, node: match.node, date: match.date, label: match.label, effect: match.effect,
            trackingOnly: Boolean(match.trackingOnly), ...verdict,
            priority: priorityOf(verdict.tier, { date: match.date, today, siteStockDays: stock, daysWithoutTreatment: impact?.ifNothingDone?.daysWithoutTreatment ?? 0 }),
            buffer: stock !== null ? { siteStockDays: stock, runsOutOn: addDays(today, stock) } : null,
            impact, patients: view.patients ?? null,
            owner: verdict.tier === "confirmed" ? "Clinical Supply" : verdict.tier === "potential" ? "Clinical Supply Logistics" : null,
            next: verdict.tier === "confirmed" ? "Approve a recovery plan: the agents propose one, the rules check it." : verdict.tier === "potential" ? (match.trackingOnly ? "Ask the courier for a manual status until tracking is back." : `Confirm with ${systemFor(match.leg)} before ${plainDay(addDays(match.date, -1))}.`) : "None. Monitoring continues.",
          };
          matches.push(entry);
          (byShipment[view.id] ??= []).push({ signal: signal.id, title: signal.title, hazard: signal.hazard, illustrative: Boolean(signal.illustrative), ...entry });
        }
      }
      // A facility on the signal's list with no collection that day: say what its own system reports.
      for (const location of signal.locations ?? []) {
        if (location.kind !== "facility") continue;
        const status = (network?.operational_status ?? []).find(item => item.facility === location.id && inWindow(item.date, signal.window));
        const facility = (network?.facilities ?? []).find(item => item.id === location.id);
        if (status && !matches.some(item => item.leg === "collection" && item.node === location.id)) notes.push(`${facility?.name ?? location.id}: ${status.detail} (${status.source}).`);
        else if (!status && facility && !matches.some(item => item.leg === "collection" && item.node === location.id))
          notes.push(`The ${lowerFirst(facility.name)} (${facility.city}) is in the area: no collection is planned there on those days, and its own system reports no exception.`);
      }
      for (const location of signal.locations ?? []) if (["area", "slow-onset"].includes(location.kind)) notes.push(location.effect);
      if ((signal.locations ?? []).some(location => location.kind === "provider") && !matches.length) notes.push("Tracking visibility only: no planned shipment of this courier is moving then, and no physical shipment is affected.");
    }
    const tier = matches.reduce((worst, item) => (TIER_ORDER[item.tier] > TIER_ORDER[worst] ? item.tier : worst), "observed");
    const counts = { confirmed: 0, potential: 0, clear: 0 };
    for (const item of matches) counts[item.tier]++;
    if (!matches.length && !ended && signal.window && !(signal.locations ?? []).some(item => ["area", "slow-onset", "provider"].includes(item.kind))) notes.push("No planned shipment, collection or route of ours is there on those days.");
    const priority = matches.reduce((top, item) => (PRIORITY_ORDER[item.priority] > PRIORITY_ORDER[top] ? item.priority : top), "INFO");
    return { ...signal, tier, tierName: TIER_NAMES[tier], evidenceLevel: signal.evidence ?? "UNKNOWN", evidenceName: EVIDENCE_NAMES[signal.evidence ?? "UNKNOWN"], priority, matches, counts, notes };
  }).sort((a, b) => TIER_ORDER[b.tier] - TIER_ORDER[a.tier] || PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority] || String(b.publishedAt).localeCompare(String(a.publishedAt)));
  return { signals: assessed, byShipment, routes };
}

// ---- the route check for one shipment, as the shipment checks and the option verifier see it ----
// With no overrides it repeats the assessment; with overrides (a new date or departure airport) it judges the new route:
// a booking record only describes the original booking, so a new leg that meets an event is a potential exposure, and a
// new route through a country ClinRadar does not monitor needs a decision first.
export function riskChecks(ss, network, view, overrides = {}) {
  if (!ss || ss.scope?.status !== "determined") return [];
  const route = routeFor(network, view, overrides);
  if (!route) return [{ section: "risk", requirement: "The shipment's route is on record", result: "Confirm",
    detail: "Insufficient data: no route is on record for this shipment, so ClinRadar cannot assess its external risk. It does not guess transit countries; add the route legs from the courier booking." }];
  const original = ss.routes?.[view.id] ?? routeFor(network, view);
  const changed = Boolean(overrides.dispatch || overrides.via);
  const checks = [];
  for (const problem of route.problems) checks.push({ section: "risk", requirement: "The route can run on the planned days", result: "Fail", detail: problem.charAt(0).toUpperCase() + problem.slice(1) });
  const findings = [];
  for (const signal of ss.signals ?? []) {
    if (signal.window && signal.window.to < ss.today) continue;
    for (const match of legMatches(signal, route)) {
      const sameLeg = original?.legs.some(leg => (leg.kind === match.leg || (match.leg === "collection" && leg.kind === "collection")) && (leg.date ?? leg.from) === match.date && [leg.departure, leg.hub, leg.arrival, leg.facility, ...(leg.countries ?? [])].includes(match.node));
      findings.push({ signal, match, ...classify(network, view.id, match, { booked: !changed || sameLeg }) });
    }
  }
  for (const { signal, match, tier, evidence, missing } of findings) {
    const tag = signal.illustrative ? " (illustrative scenario)" : "";
    if (tier === "confirmed") checks.push({ section: "risk", requirement: "No confirmed disruption on the route", result: "Fail", signal: signal.id,
      detail: `${match.label} on ${plainDay(match.date)}: ${evidence.detail} ${evidence.source}, ${String(evidence.recordedAt).replace("T", " ").slice(0, 16)} UTC. Event: ${signal.title}${tag}.${changed ? "" : impactSentence(patientImpact(view, route, evidence, ss.today))}` });
    else if (tier === "potential") checks.push({ section: "risk", requirement: match.trackingOnly ? "Shipment visible to the courier's tracking" : "No unconfirmed exposure on the route", result: "Confirm", signal: signal.id,
      detail: `${match.label} on ${plainDay(match.date)} meets: ${signal.title}${tag}. ${missing}` });
    else checks.push({ section: "risk", requirement: "Exposure checked with the carrier or depot", result: "Pass", signal: signal.id,
      detail: `${signal.title}${tag}: ${evidence.detail} (${evidence.source}).` });
  }
  const monitored = ss.scope.monitored?.external ?? [];
  let coverageGap = false;
  let fresh = [];
  if (changed) {
    fresh = route.countries.filter(code => !(original?.countries ?? []).includes(code) && !monitored.includes(code));
    coverageGap = fresh.length > 0;
    if (coverageGap) checks.push({ section: "risk", requirement: "Every country on a new route is monitored for external risk", result: "Decision",
      detail: `The new route passes through ${list(fresh.map(code => ss.names?.[code] ?? code))}, which ClinRadar does not monitor for external risk, so it cannot assess it. Turn external-risk monitoring on in Monitoring scope, or choose another route.` });
  }
  // No false assurance: a booked leg in a country nobody monitors for external risk is unknown, not clear.
  const blind = route.countries.filter(code => !monitored.includes(code) && !fresh.includes(code));
  if (blind.length) {
    const roles = code => {
      const found = [];
      for (const leg of route.legs) {
        if (leg.kind === "collection" && leg.country === code) found.push("depot");
        if (leg.kind === "air" && network.airports?.[leg.departure]?.country === code) found.push("departure");
        if (leg.kind === "air" && leg.hub && network.airports?.[leg.hub]?.country === code) found.push("transfer hub");
        if (leg.kind === "air" && network.airports?.[leg.arrival]?.country === code) found.push("arrival");
        if (leg.kind === "customs" && leg.country === code) found.push("import clearance");
        if (leg.kind === "delivery" && leg.country === code) found.push("delivery");
        if (leg.kind === "road" && leg.countries.includes(code)) found.push("road");
      }
      const unique = [...new Set(found)];
      return unique.length > 1 ? unique.filter(role => role !== "road") : unique;
    };
    checks.push({ section: "risk", requirement: "External risk is monitored on every country of the route", result: "Confirm", unmonitored: blind,
      detail: `External risk is not monitored on this route: ${list(blind.map(code => `${ss.names?.[code] ?? code} (${list(roles(code))})`))}. ClinRadar cannot see strikes, weather or security events there, so it does not call the route clear. Turn it on in Monitoring scope or confirm with the ${lowerFirst(route.carrier)}.` });
  }
  if (!findings.length && !route.problems.length && !coverageGap) {
    checks.push({ section: "risk", requirement: "No disruption on the route", result: "Pass",
      detail: `No monitored event touches ${route.nodes.join(" → ")} between ${plainDay(route.dispatch)} and ${plainDay(route.delivery)}.${blind.length ? ` Not monitored: ${list(blind.map(code => ss.names?.[code] ?? code))}.` : ""}` });
  }
  return checks;
}

// ---- one call for everything ----
export function computeClinRadar({ network, portfolio, spain, israel, views: plain, choices, connected, feeds, recorded, today, config = {}, catalogue = {}, specs = {} }) {
  const views = plain.filter(Boolean).map(view => { const route = routeFor(network, view); return route ? { ...view, lane: route.lane, originFacility: route.facility } : view; });
  const scope = buildScope({ network, portfolio, spain, israel, views, choices, connected, feeds, today, config, catalogue, specs });
  const names = { ...catalogue, ...(network?.geography?.names ?? {}) };
  const signals = scope.status === "determined" ? collectSignals({ recorded, feeds, scope, names, today, policy: scopePolicy(config) }) : [];
  const { signals: assessed, byShipment, routes } = assessSignals({ signals, network, views, today });
  const counts = { observed: 0, potential: 0, confirmed: 0, clear: 0 };
  for (const signal of assessed) counts[signal.tier]++;
  const feedStatus = feeds ? {
    fetchedAt: feeds.fetchedAt, live: Boolean(feeds.live), attribution: feeds.attribution ?? { fcdo: FCDO_ATTRIBUTION, gdacs: GDACS_ATTRIBUTION },
    fcdo: Object.fromEntries(Object.entries(feeds.fcdo ?? {}).filter(([code]) => (scope.monitored?.external ?? []).includes(code)).map(([code, item]) => [code, { ok: item.ok, updatedAt: item.updatedAt ?? null, url: item.url, error: item.error ?? null }])),
    gdacs: { ok: Boolean(feeds.gdacs?.ok), events: feeds.gdacs?.events?.length ?? 0, outside: (feeds.gdacs?.events ?? []).filter(event => !event.countries.some(code => (scope.monitored?.external ?? []).includes(code))).length, url: feeds.gdacs?.url ?? null,
      // Alerts outside the monitored countries that hit a country hosting one of our facilities: context for a recommendation, not a signal.
      nearOurFacilities: (feeds.gdacs?.events ?? []).filter(event => !event.countries.some(code => (scope.monitored?.external ?? []).includes(code)))
        .map(event => ({ event, facilities: (network?.facilities ?? []).filter(item => event.countries.includes(item.country)) })).filter(item => item.facilities.length)
        .map(({ event, facilities }) => ({ id: event.id, typeName: event.typeName, alert: event.alert, name: event.name, countries: event.countries, from: event.from, to: event.to, ended: event.to < today, facilities: facilities.map(item => item.id), url: event.url ?? null })) },
  } : null;
  const atRisk = assessed.flatMap(signal => signal.matches.filter(match => match.impact?.ifNothingDone?.daysWithoutTreatment > 0));
  const patientsAtRisk = { shipments: atRisk.map(match => match.shipment), patients: atRisk.reduce((sum, match) => sum + (match.impact.patients ?? 0), 0) };
  return { today, scope, signals: assessed, byShipment, routes, counts, names, feeds: feedStatus, checkedAt: recorded?.checked_at ?? null, patientsAtRisk, costReference: COST_OF_DELAY };
}

// ---- the watch team's view: one summary per kind of hazard ----
const dayMonth = day => new Date(day + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const windowText = window => {
  if (!window) return "";
  if (window.from === window.to) return dayMonth(window.from);
  const [from, to] = [dayMonth(window.from), dayMonth(window.to)];
  return from.split(" ")[1] === to.split(" ")[1] ? `${from.split(" ")[0]}–${to}` : `${from}–${to}`;
};
const titleHead = signal => String(signal.title).split(":")[0].replace(/,\s*\d[^,]*$/, "");
const titleWhat = signal => (String(signal.title).split(":")[1] ?? "").split(",")[0].trim();
// Most relevant first: the exposure state, then whether it touches us, then whether it still needs mapping by a person.
const relevance = (signal, network) => (touchesUs(signal, network) ? 2 : (signal.locations ?? []).some(location => location.kind === "area") ? 1 : 0);
const sourceWord = source => (/courier/i.test(source) ? "courier" : /depot/i.test(source) ? "depot" : /tracking|logistics partner/i.test(source) ? "carrier" : source);
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
// Whether a signal touches something of ours: a planned shipment's leg, or one of our facilities.
const touchesUs = (signal, network) => signal.matches.length > 0 || (signal.locations ?? []).some(location => location.kind === "facility" && (network?.facilities ?? []).some(item => item.id === location.id));

// The business finding a watch agent reports: what is confirmed, what is only potential and who must confirm it, what
// was checked and found clear, and what touches nothing of ours. Facts from the assessment only, no probabilities.
function findingFor(entry, signals, ss, network, regulatory) {
  const names = ss.names ?? {};
  const head = `${entry.name}: ${plural(entry.events, "event")} in ${entry.countries} monitored countries`;
  if (entry.hazard === "regulatory") {
    const changes = regulatory.filter(item => item.kind === "change");
    const permits = regulatory.filter(item => item.kind === "permit");
    const affected = [...new Set(changes.flatMap(item => item.touching))];
    const parts = [`${entry.name}: ${plural(changes.length, "rule change")} and ${plural(permits.length, "import approval")} in ${entry.countries} monitored countries`];
    if (affected.length) parts.push(`the changes affect ${plural(affected.length, "planned shipment")} — ${changes.filter(item => item.touching.length).map(item => `${item.short} (${item.touching.length})`).join(", ")}`);
    const permitText = permits.map(item => (item.touching.length ? `${item.id} does not yet cover ${item.shipment}` : `${item.id} covers ${item.shipment}`));
    const gaps = entry.gaps.map(gap => gap.code).filter(Boolean);
    return `${parts.join("; ")}.${permitText.length ? ` Import approvals: ${permitText.join("; ")}.` : ""}${gaps.length ? ` Coverage gap: no Country Specification or regulator source for ${list(gaps.map(code => names[code] ?? code))} (Regulatory SME to register one).` : ""}`;
  }
  const sentences = [];
  const confirmed = signals.flatMap(signal => signal.matches.filter(match => match.tier === "confirmed").map(match => `${match.shipment}'s ${lowerFirst(match.label)} on ${dayMonth(match.date)} ${match.evidence.status} (${sourceWord(match.evidence.source)})`));
  const clear = signals.flatMap(signal => signal.matches.filter(match => match.tier === "clear").map(match => `${match.shipment} checked, not affected`));
  const potential = signals.flatMap(signal => signal.matches.filter(match => match.tier === "potential").map(match => (match.trackingOnly
    ? `${match.shipment}: courier tracking lost on ${dayMonth(match.date)}; ask for a manual status`
    : `${match.shipment}'s ${lowerFirst(match.label)} on ${dayMonth(match.date)}: ${titleHead(signal)}${titleWhat(signal) ? `, ${titleWhat(signal)}` : ""}${signal.illustrative ? " (illustrative)" : ""}; Clinical Supply Logistics to confirm with ${systemFor(match.leg)}`)));
  sentences.push(confirmed.length ? `${head}; ${plural(confirmed.length, "confirmed disruption")} — ${[...confirmed, ...clear].join("; ")}.` : `${head}; nothing confirmed.${clear.length ? ` ${clear.join("; ")}.` : ""}`);
  if (potential.length) sentences.push(`${plural(potential.length, "potential exposure")}: ${potential.join("; ")}.`);
  const observed = signals.filter(signal => signal.tier === "observed");
  const nearFacility = observed.filter(signal => touchesUs(signal, network)).map(signal => {
    const facility = (network?.facilities ?? []).find(item => (signal.locations ?? []).some(location => location.kind === "facility" && location.id === item.id));
    return `${facility ? `the ${lowerFirst(facility.name)} (${facility.city})` : names[signal.country] ?? signal.country} is in the area of the ${lowerFirst(titleHead(signal))}${signal.illustrative ? " (illustrative)" : ""}, ${windowText(signal.window)}: no collection is planned there, so no shipment is exposed`;
  });
  const kindOf = signal => (signal.locations ?? []).map(location => location.kind);
  const areas = observed.filter(signal => kindOf(signal).includes("area"))
    .map(signal => `${names[signal.country] ?? signal.country}: the advice covers parts of the country; missing: the advised areas mapped against our sites and routes (Clinical Supply Logistics)`);
  const slow = observed.filter(signal => kindOf(signal).includes("slow-onset"));
  const tracking = observed.filter(signal => kindOf(signal).includes("provider"));
  const routine = observed.filter(signal => !kindOf(signal).length);
  const rest = observed.filter(signal => !touchesUs(signal, network) && !["area", "slow-onset", "provider"].some(kind => kindOf(signal).includes(kind)) && kindOf(signal).length);
  const observedParts = [...nearFacility, ...areas,
    ...(slow.length ? [`${plural(slow.length, "slow-onset alert")} (${[...new Set(slow.map(signal => (signal.title.match(/^(\w+)/)?.[1] ?? "").toLowerCase()))].join(", ")}): no direct effect on transport`] : []),
    ...(tracking.length ? [`${plural(tracking.length, "courier tracking delay")}: visibility only, no shipment of ours moving then`] : []),
    ...(rest.length > 2 ? [`${plural(rest.length, "other event")} with no shipment, collection or route of ours there on those days`]
      : rest.map(signal => `${titleHead(signal)}, ${windowText(signal.window)}: no shipment, collection or route of ours there on those days`)),
    ...(routine.length ? [`${plural(routine.length, "routine update")} with no restriction`] : [])];
  if (observedParts.length) sentences.push(`Observed only: ${observedParts.join("; ")}.`);
  if (entry.hazard === "weather" && entry.gaps.length) {
    const alerts = ss.feeds?.gdacs?.nearOurFacilities ?? [];
    sentences.push(`Not monitored: ${list(entry.gaps.map(gap => `${names[gap.code] ?? gap.code} (${gap.facilities.join(", ")})`))}.${alerts.length ? ` GDACS reports ${list(alerts.map(alert => `a ${alert.alert.toLowerCase()} ${alert.typeName.toLowerCase()} alert in ${list(alert.countries.filter(code => entry.gaps.some(gap => gap.code === code)).map(code => names[code] ?? code))}, ${windowText({ from: alert.from, to: alert.to })}${alert.ended ? " (ended)" : ""}`))}.` : ""}`);
  }
  return sentences.join(" ");
}

// One summary per kind of hazard, for the page and for the agents' run records. `regulatory` lists the regulatory changes
// and import approvals with the planned shipments each one holds (rules.mjs builds it from the shipment checks).
export function watchSummary(ss, { network, regulatory = [] } = {}) {
  if (!ss || ss.scope?.status !== "determined") return Object.values(HAZARDS).map(item => ({ agent: item.agent, name: item.name, hazard: item.agent, sources: [], countries: 0, regions: [], events: 0, touching: 0, confirmed: 0, potential: 0, top: [], gaps: [], finding: `${item.name}: nothing is monitored until the active-trial portfolio is connected.` }));
  const regions = network?.geography?.regions ?? {};
  const facilityGaps = (network?.facilities ?? []).filter(item => !ss.scope.monitored.external.includes(item.country)).reduce((map, item) => {
    (map[item.country] ??= []).push(lowerFirst(item.name).replace(/, (Singapore|Switzerland|India|Belgium|Netherlands)$/, "")); return map; }, {});
  return Object.entries(HAZARDS).map(([hazard, spec]) => {
    const countries = ss.scope.monitored[spec.kind] ?? [];
    const signals = hazard === "regulatory" ? [] : ss.signals.filter(signal => signal.hazard === hazard);
    const ordered = [...signals].sort((a, b) => TIER_ORDER[b.tier] - TIER_ORDER[a.tier] || relevance(b, network) - relevance(a, network));
    const items = hazard === "regulatory" ? regulatory : [];
    const authorities = [...new Set(signals.flatMap(signal => (signal.sources ?? [{ authority: signal.authority }]).map(source => source.authority)).filter(Boolean))];
    const entry = {
      agent: spec.agent, name: spec.name, hazard, covers: spec.covers,
      sources: [...spec.feeds, ...authorities.filter(name => !/Global Disaster Alert|Foreign, Commonwealth/.test(name))],
      countries: countries.length, regions: [...new Set(countries.map(code => regions[code] ?? "Other"))].sort(),
      events: hazard === "regulatory" ? items.length : signals.length,
      // A rule change touches us when it affects a planned shipment; an import approval always belongs to one of ours.
      touching: hazard === "regulatory" ? items.filter(item => item.touching.length || item.kind === "permit").length : signals.filter(signal => touchesUs(signal, network)).length,
      confirmed: signals.filter(signal => signal.tier === "confirmed").length,
      potential: signals.filter(signal => signal.tier === "potential").length,
      top: hazard === "regulatory" ? [...items].sort((a, b) => b.touching.length - a.touching.length).map(item => item.id).slice(0, 5) : ordered.map(signal => signal.id).slice(0, 5),
      gaps: hazard === "regulatory"
        ? (ss.scope.coverage?.gaps ?? []).filter(gap => gap.code && /regulatory and customs coverage is a gap/i.test(gap.text)).map(gap => ({ code: gap.code, text: gap.text }))
        : Object.entries(facilityGaps).map(([code, facilities]) => ({ code, facilities, text: `${ss.names?.[code] ?? code} hosts the ${list(facilities)} and is not monitored for external risk.` })),
    };
    entry.finding = findingFor(entry, ordered, ss, network, items);
    return entry;
  });
}
