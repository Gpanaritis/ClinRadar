// Checks ClinRadar's fixed rules without network or AI calls: the monitoring scope comes only from the active-trial
// portfolio and cannot be determined without it; recommended countries are never switched on by themselves, carry their
// evidence and change only by the right role, with a reason, in the audit trail; external signals are matched to the
// shipments and classified (observed event, potential exposure, confirmed disruption, not affected after check); the
// option verifier judges new routes, dates and monitoring coverage; the MCP tools expose all of it read-only.
// Usage: node scripts/check-supplyshield.mjs     (runs in a temporary data folder; nothing on this computer changes)

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(join(tmpdir(), "supplyshield-check-"));
process.env.REGCHAIN_DATA_DIR = join(temp, "data");
process.env.REGCHAIN_CACHE_DIR = join(temp, "cache");

const { loadData, checkShipment, verifyOption, allShipmentChecks, supplyShieldPayload } = await import("../regchain-ai/rules.mjs");
const { computeClinRadar, MONITORING_KINDS } = await import("../regchain-ai/supplyshield.mjs");
const { setMonitoring, setPortfolioConnection, emptyScope, readScopeState, reviewRecommendation } = await import("../regchain-ai/monitoring.mjs");
const { openDatabase, verifyAudit, closeDatabase } = await import("../regchain-ai/db.mjs");
const inScopeCodes = state => state.scope.countries.map(item => item.code);
const clinicalSupply = { by: "P. Laine · Clinical Supply", role: "viewer" };
const regulatorySme = { by: "A. Novak · Regulatory SME", role: "reviewer" };
const quality = { by: "M. Okafor · Quality owner", role: "owner" };

// 1. The scope comes only from the active-trial portfolio.
let data = await loadData(root);
let ss = data.supplyshield;
assert.equal(ss.scope.status, "determined");
assert.deepEqual(ss.scope.countries.map(item => item.code).sort(), ["AU", "CA", "CY", "DE", "ES", "FR", "GB", "GR", "IE", "IL", "IT", "JP", "NL", "PL", "SE", "US"], "only countries with an operationally active trial");
assert.ok(ss.scope.countries.every(item => item.monitoring.external.on && item.monitoring.regulatory.on && item.monitoring.external.locked), "active-trial countries are monitored for both, automatically");
assert.deepEqual(ss.scope.studies.excluded.map(item => `${item.id}:${item.status}`), ["STUDY-018:COMPLETED", "STUDY-019:COMPLETED", "STUDY-020:SUSPENDED", "CTP-7842-201:NOT_YET_RECRUITING"], "the status policy in config/supplyshield.yaml leaves these out");
assert.equal(ss.scope.studies.active, 18);
assert.match(ss.scope.studies.excluded.find(item => item.id === "CTP-7842-201").note, /Spain is monitored through other active studies/);
assert.deepEqual(ss.scope.notInScope.map(item => item.code), ["BE", "BR", "DK", "FI", "MX"], "registered but not operationally active, or only in completed studies: excluded");
assert.ok(ss.scope.notInScope.every(item => item.scopeClass === "EXCLUDED"));
assert.ok(ss.scope.notInScope.find(item => item.code === "MX").entries.every(entry => entry.status === "CLOSED"));
assert.deepEqual(ss.scope.reviewWarnings.map(item => `${item.code}:${item.study}:${item.status}`), ["PT:STUDY-013:UNKNOWN"], "a contradictory status is shown for confirmation, not guessed");
assert.ok(!inScopeCodes(ss).includes("PT") && !ss.scope.notInScope.some(item => item.code === "PT"), "neither monitored nor excluded until someone confirms it");
assert.deepEqual(ss.scope.supranational[0].appliesTo.sort(), ["CY", "DE", "ES", "FR", "GR", "IE", "IT", "NL", "PL", "SE"], "EU rules for the active-trial EU countries");
assert.ok(!ss.scope.monitored.regulatory.some(code => ["AT", "BE", "BG", "CZ", "DK", "FI", "PT", "RO"].includes(code)), "no other EU country is switched on because of EU rules");
assert.ok(ss.scope.coverage.gaps.some(gap => gap.code === "JP" && /regulatory and customs coverage is a gap/.test(gap.text)), "a country without a regulator source says so");
console.log(`ok  scope: ${ss.scope.countries.length} countries with an active trial, monitored automatically; 4 studies left out by the status policy; 5 countries excluded; Portugal's contradictory status waits for confirmation; EU rules for 10 countries and no other; coverage gaps named`);

// 2. Recommendations: evidence only, off by default, never an active-trial country.
const inScope = new Set(ss.scope.countries.map(item => item.code));
assert.ok(ss.scope.recommendations.every(item => !inScope.has(item.code)));
const KINDS = ["facility", "transit", "hub", "alternative", "land", "sea", "advice", "conditional"];
assert.ok(ss.scope.recommendations.every(item => item.reasons.length && item.reasons.every(reason => KINDS.includes(reason.kind) && reason.text)), "every recommendation has documented evidence, of a known kind");
assert.ok(ss.scope.recommendations.every(item => item.reasons.some(reason => reason.kind !== "advice")), "official advice alone never recommends a country: it needs a link or a border");
for (const item of ss.scope.recommendations.flatMap(entry => entry.reasons.filter(reason => reason.kind === "advice"))) assert.ok(item.evidence?.url?.startsWith("https://www.gov.uk/") && item.evidence.at, "official advice carries its source and date");
const on = ss.scope.recommendations.filter(item => item.monitoring.external.on || item.monitoring.regulatory.on).map(item => `${item.code}:${item.monitoring.external.on ? "external" : "regulatory"}`);
assert.deepEqual(on, ["BE:external"], "only the decision a person recorded is on (Belgium, external risk, P. Laine)");
assert.equal(ss.scope.recommendations.find(item => item.code === "BE").monitoring.external.by, "P. Laine");
assert.deepEqual(ss.scope.recommendations.filter(item => item.group === "supply").map(item => item.code).sort(), ["AE", "BE", "CH", "IN", "LU", "SG"], "supply links: depots, the manufacturer, the supplier, the Dubai hub, the alternative Luxembourg departure");
assert.ok(ss.scope.recommendations.find(item => item.code === "BE").reasons.some(reason => reason.kind === "facility" && /17 planned shipments/.test(reason.text)));
assert.deepEqual(ss.scope.monitored.external.sort(), [...inScope, "BE"].sort());
assert.deepEqual(ss.scope.monitored.regulatory.sort(), [...inScope].sort());
assert.equal(ss.scope.recommendations.find(item => item.code === "BE").scopeClass, "MANUALLY_ENABLED");
assert.ok(ss.scope.recommendations.filter(item => item.code !== "BE").every(item => item.scopeClass === "RECOMMENDED"));
const austria = ss.scope.recommendations.find(item => item.code === "AT");
assert.equal(austria.group, "conditional", "a suspended study with product still at a site is an opt-in recommendation, not monitoring");
assert.ok(austria.monitoring.external.on === false && austria.monitoring.regulatory.on === false);
assert.ok(ss.scope.recommendations.flatMap(item => item.reasons).filter(reason => reason.kind === "sea").every(reason => /not a land border/.test(reason.text)), "sea proximity is never called a land border");
assert.ok(ss.scope.recommendations.find(item => item.code === "BG").reasons.some(reason => reason.kind === "land" && /Greece/.test(reason.text)), "Bulgaria: a Greek land neighbour, suggested only");
assert.ok(!(data.network.geography.land.GR ?? []).includes("CY") && (data.network.geography.sea.GR ?? []).includes("CY"), "Cyprus is a Greek sea neighbour, not a land neighbour");
console.log(`ok  recommendations: ${ss.scope.recommendations.length} countries, each with evidence (${ss.scope.recommendations.filter(item => item.group === "supply").length} supply links, 1 suspended study with product on site, ${ss.scope.recommendations.filter(item => item.group === "advice").length} with current official advice, ${ss.scope.recommendations.filter(item => item.group === "proximity").length} proximity only), all off except Belgium's external risk, which a person turned on`);

// 3. Signals: matched to our shipments and classified, never generic news.
const signal = id => ss.signals.find(item => item.id === id);
const strike = signal("SIG-BE-STRIKE-1124");
assert.equal(strike.tier, "confirmed");
assert.deepEqual(strike.matches.map(match => `${match.shipment}:${match.leg}:${match.tier}`).sort(), ["SHP-03:road:clear", "SHP-IL-01:air:confirmed"]);
assert.match(strike.matches.find(match => match.shipment === "SHP-IL-01").evidence.source, /courier booking system/);
assert.ok(strike.notes.some(note => /no outbound collections/.test(note)), "the depot's own status is reported");
assert.equal(strike.sources.length, 3, "three reports of the same strike are one signal with three sources: the airport, the federal notice and the enterprise risk system");
assert.deepEqual(strike.sources.filter(source => source.enterprise).map(source => source.alert), ["ERS-26-114-0031"], "the enterprise alert corroborates the incident, it is not a new one");
assert.equal(strike.evidenceLevel, "TRUSTED_CORROBORATED");
assert.ok(!ss.signals.some(item => item.id === "SIG-BE-STRIKE-1124-FPS"), "not a second incident");
assert.equal(strike.priority, "CRITICAL", "patients would go without treatment if nobody acts");
const il01Match = strike.matches.find(match => match.shipment === "SHP-IL-01");
assert.deepEqual(il01Match.buffer, { siteStockDays: 13, runsOutOn: "2026-11-27" }, "the time buffer behind a confirmed disruption");
assert.deepEqual(il01Match.impact.ifNothingDone, { rebookedFlight: "2026-11-25", delivery: "2026-11-29", daysWithoutTreatment: 2 }, "the courier's next free flight delivers on Sunday 29 Nov, two days after the stock runs out");
assert.equal(il01Match.impact.patients, 14);
assert.deepEqual(ss.patientsAtRisk, { shipments: ["SHP-IL-01"], patients: 14 });
assert.equal(ss.costReference.perDay, 40000, "the cost of a trial day as the pitch quotes it (Phase II and III), with its source");
assert.equal(ss.costReference.byPhase["Phase III"], 55716, "and the figure for each phase");
const tracking = signal("SIG-COURIER-TRACKING-1114");
assert.equal(tracking.tier, "observed");
assert.ok(tracking.notes.some(note => /no physical shipment is affected/.test(note)), "a tracking outage is not a lost shipment");
assert.ok(ss.signals.every(item => !/%|probab/i.test(JSON.stringify([item.title, item.summary, item.notes]))), "no probabilities");
const works = signal("SIG-IL-TLV-0104");
assert.equal(works.tier, "potential");
assert.match(works.matches[0].missing, /No confirmation yet from the courier/);
assert.equal(works.matches[0].owner, "Clinical Supply Logistics");
assert.equal(signal("SIG-FR-ROAD-1202").tier, "observed", "no shipment of ours is on French roads on those days");
assert.ok(ss.signals.filter(item => item.category === "natural-hazard").every(item => item.tier === "observed"), "the recorded GDACS alerts touch nothing of ours");
assert.ok(ss.signals.every(item => ss.scope.monitored.external.includes(item.country)), "signals come only from monitored countries");
assert.equal(ss.feeds.live, false, "without a live check, the recorded copy of the feeds is used and says so");
// Every signal belongs to one kind of hazard, for the watch team.
assert.ok(ss.signals.every(item => ["weather", "transport", "security", "regulatory"].includes(item.hazard)), "every signal has a hazard");
assert.equal(strike.hazard, "transport");
assert.equal(tracking.hazard, "transport");
assert.equal(works.hazard, "transport");
assert.ok(ss.signals.filter(item => item.category === "natural-hazard").every(item => item.hazard === "weather" && item.hazardType), "GDACS alerts are weather, and keep their GDACS type");
assert.ok(ss.signals.filter(item => item.category === "official-advice").every(item => item.hazard === "security"), "UK FCDO advice is security");
const storm = signal("SIG-US-WINTER-1116");
assert.ok(storm.illustrative && storm.hazard === "weather" && storm.country === "US", "a non-European natural hazard, clearly illustrative");
assert.equal(storm.tier, "observed", "the US depot has no collection planned on those days");
assert.ok(storm.notes.some(note => /US depot \(Allentown, Pennsylvania\) is in the area: no collection is planned/.test(note)));
assert.deepEqual(ss.byShipment["SHP-IL-01"].map(item => item.hazard), ["transport"], "each shipment match says which kind of hazard it is");
console.log(`ok  signals: ${ss.counts.confirmed} confirmed disruption, ${ss.counts.potential} potential exposure, ${ss.counts.observed} observed; the strike cancels SHP-IL-01's flight (courier), SHP-03 is not affected after check, the runway works wait for the courier's confirmation`);

// 4. The route check and the option verifier.
const il01 = checkShipment(data, "SHP-IL-01");
assert.equal(il01.result, "Blocked");
assert.equal(il01.checks.find(item => item.section === "permits" && /import approval covers/.test(item.requirement)).result, "Pass", "MOH-IMP-26-4410 covers TLV, 10 kits, the consignee and the date");
const verdict = actions => verifyOption(data, "SHP-IL-01", actions);
assert.equal(verdict([{ type: "reroute", via: "AMS" }]).after, "Ready", "leave from Amsterdam: delivery unchanged");
const lux = verdict([{ type: "reroute", via: "LUX" }]);
assert.equal(lux.passes, false);
assert.match(lux.checks.find(item => item.result === "Decision").detail, /Luxembourg, which ClinRadar does not monitor/);
assert.match(verdict([{ type: "delay", new_dispatch_date: "2026-11-25" }]).notes.join(" "), /runs out on 2026-11-27, but the kits would arrive on 2026-11-30: 14 patients/, "a later dispatch arrives after the stock runs out");
assert.equal(verdict([{ type: "delay", new_dispatch_date: "2026-11-25" }]).passes, false);
assert.match(il01.checks.find(item => item.section === "risk").detail, /14 patients would go 2 days without treatment/, "the shipment's own check says who is at risk");
assert.match(verdict([{ type: "delay", new_dispatch_date: "2026-11-24" }]).checks.find(item => item.result === "Fail" && item.section === "risk").detail, /no outbound collections/, "the depot does not collect on the strike day");
assert.equal(verdict([{ type: "advance_dispatch", new_dispatch_date: "2026-11-20" }]).feasible, false, "preparation would have had to start on 13 Nov");
assert.equal(verdict([{ type: "reroute", via: "CDG" }]).feasible, false, "no qualified departure from Paris");
assert.equal(verifyOption(data, "SHP-03", [{ type: "reroute", via: "AMS" }]).feasible, false, "a road shipment has no departure airport");
assert.equal(verifyOption(data, "SHP-IL-02", [{ type: "advance_dispatch", new_dispatch_date: "2026-12-28" }]).after, "Ready", "an earlier dispatch also avoids the runway works");
// The watch team's summary for the page: one entry per kind of hazard, in the default workspace (Belgium monitored).
{
  const payload = supplyShieldPayload(data);
  assert.deepEqual(payload.watch.map(item => [item.agent, item.name, item.hazard]), [["weather", "Weather & natural hazards", "weather"], ["transport", "Strikes & transport", "transport"], ["security", "Security & travel advice", "security"], ["regulatory", "Regulatory & customs", "regulatory"]]);
  for (const item of payload.watch) {
    assert.ok(Array.isArray(item.sources) && item.sources.length && Number.isInteger(item.countries) && item.countries > 0 && item.regions.length && Number.isInteger(item.events) && Number.isInteger(item.touching) && Array.isArray(item.top) && item.finding, item.agent);
    if (item.hazard !== "regulatory") assert.ok(item.top.every(id => payload.signals.some(entry => entry.id === id && entry.hazard === item.hazard)), `${item.agent}: top lists its own signals`);
    else assert.ok(item.top.every(id => payload.regulatoryItems.some(entry => entry.id === id)), "regulatory: top lists regulatory items");
    assert.ok(!/%|probab/i.test(item.finding), "no probabilities");
  }
  const watch = Object.fromEntries(payload.watch.map(item => [item.hazard, item]));
  assert.deepEqual([watch.transport.events, watch.transport.touching, watch.transport.confirmed, watch.transport.potential, watch.transport.top[0]], [4, 2, 1, 1, "SIG-BE-STRIKE-1124"]);
  assert.deepEqual(watch.weather.top.slice(0, 2), ["SIG-ENT-ERS-26-114-0042", "SIG-US-WINTER-1116"], "the Andalusian heat outlook (potential exposure) first, then the storm at the US depot");
  assert.deepEqual([watch.weather.enterprise.received, watch.weather.enterprise.matched, watch.transport.enterprise.gaps], [3, 2, 1], "each watch agent sees its own enterprise alerts");
  assert.match(watch.transport.finding, /Enterprise risk system: 3 alerts, 1 touches our network \(merged into SIG-BE-STRIKE-1124\), 1 coverage gap \(touches the drug product manufacturer in Switzerland, not monitored\)/);
  assert.ok(watch.weather.touching >= 1 && watch.weather.regions.includes("North America"));
  assert.ok(watch.weather.gaps.some(gap => gap.code === "SG") && /India, 1–3 Nov \(ended\)/.test(watch.weather.finding), "the APAC depot is not monitored; the GDACS cyclone in India is context, not a signal");
  assert.equal(watch.security.top[0], "FCDO-IL-2026-10-27", "advice for parts of Israel needs mapping against our sites");
  assert.equal(watch.regulatory.countries, ss.scope.monitored.regulatory.length);
  assert.deepEqual(payload.regulatoryItems.find(item => item.id === "RC-IL-001").touching, ["SHP-IL-02", "SHP-IL-03"]);
  assert.equal(payload.regulatoryItems.find(item => item.id === "MOH-IMP-26-4410").result, "Pass");
  assert.ok(payload.regulatoryItems.every(item => item.hazard === "regulatory"));
  console.log(`ok  watch summary: ${payload.watch.map(item => `${item.name} ${item.events} events, ${item.touching} touching us`).join("; ")}`);
}

// Enterprise risk alerts: matched to our studies, sites, routes and facilities; the rest counted, not matched.
{
  const payload = supplyShieldPayload(data);
  const enterprise = payload.enterprise;
  assert.equal(enterprise.system, "Enterprise risk system (illustrative)");
  assert.deepEqual([enterprise.received, enterprise.matched, enterprise.merged, enterprise.newSignals, enterprise.notMatched, enterprise.gaps], [7, 3, 2, 1, 3, 1]);
  const result = Object.fromEntries(enterprise.alerts.map(item => [item.id, item.result]));
  assert.deepEqual(result, {
    "ERS-26-114-0031": "merged into SIG-BE-STRIKE-1124",
    "ERS-26-114-0038": "merged into SIG-US-WINTER-1116",
    "ERS-26-114-0042": "new signal SIG-ENT-ERS-26-114-0042",
    "ERS-26-114-0045": "no study, site, route or facility affected",
    "ERS-26-114-0047": "no study, site, route or facility affected",
    "ERS-26-114-0049": "no study, site, route or facility affected",
    "ERS-26-114-0052": "touches the drug product manufacturer in Switzerland, not monitored",
  }, "every alert keeps its own id, and says what became of it");
  assert.deepEqual(enterprise.alerts.find(item => item.id === "ERS-26-114-0031").shipments.sort(), ["SHP-03", "SHP-IL-01"]);
  assert.match(enterprise.alerts.find(item => item.id === "ERS-26-114-0052").suggestion, /nobody monitors.*Suggest turning external risk on for Switzerland/);
  assert.match(enterprise.alerts.find(item => item.id === "ERS-26-114-0045").note, /NorthSea Freight Systems is not one of our carriers/);
  assert.ok(!ss.signals.some(item => ["SIG-ENT-ERS-26-114-0045", "SIG-ENT-ERS-26-114-0047", "SIG-ENT-ERS-26-114-0049", "SIG-ENT-ERS-26-114-0052"].includes(item.id)), "alerts that touch nothing of ours are counted, not added to the signals");
  const heat = signal("SIG-ENT-ERS-26-114-0042");
  assert.deepEqual([heat.tier, heat.evidenceLevel, heat.hazard, heat.illustrative], ["potential", "SINGLE_SOURCE", "weather", true], "an aggregator alone is a single source, and never confirms an impact");
  assert.deepEqual(heat.matches.map(match => `${match.shipment}:${match.leg}:${match.date}`), ["SHP-ES-08:delivery:2027-03-10", "SHP-ES-10:delivery:2027-03-24"], "deliveries to Sevilla and Málaga in March; Madrid, Barcelona and February deliveries untouched");
  assert.ok(heat.matches.every(match => match.owner === "Clinical Supply Logistics" && /the depot and the courier that the shipment's qualified packaging holds its temperature range/.test(match.missing)));
  assert.equal(checkShipment(data, "SHP-ES-08").result, "Blocked", "still blocked for its own reasons: the heat outlook adds a confirmation, not a block");
  assert.equal(signal("SIG-US-WINTER-1116").sources.length, 2, "the enterprise storm alert corroborates the NWS watch");
  // Validation and storage, as the ingest webhook uses them.
  const { validateAlerts, storeEnterpriseAlerts } = await import("../regchain-ai/enterprise.mjs");
  const { dataDir } = await import("../regchain-ai/db.mjs");
  const good = { id: "ERS-TEST-1", category: "Airport disruption", severity: "Severe", title: "Tel Aviv: Ben Gurion Airport cargo terminal closed, 5 Jan 2027", location: { country: "IL", city: "Tel Aviv", airport: "TLV" }, window: { from: "2027-01-05", to: "2027-01-05" } };
  assert.ok(validateAlerts({ alerts: [good] }).alerts?.length === 1);
  assert.match(validateAlerts([{ ...good, location: { country: "Israel" } }]).errors[0], /location.country/);
  assert.match(validateAlerts([{ ...good, window: { from: "2027-01-06", to: "2027-01-05" } }]).errors[0], /window/);
  assert.match(validateAlerts([{ ...good, id: "bad id!" }]).errors[0], /id:/);
  assert.match(validateAlerts(Array.from({ length: 101 }, (_, index) => ({ ...good, id: `E-${index}` }))).errors[0], /At most 100/);
  await storeEnterpriseAlerts(dataDir(root), validateAlerts([good]).alerts);
  const withStored = (await loadData(root)).supplyshield;
  const stored = withStored.enterprise.alerts.find(item => item.id === "ERS-TEST-1");
  assert.deepEqual([stored.origin, stored.result, withStored.enterprise.received], ["webhook", "merged into SIG-IL-TLV-0104", 8], "a stored alert is merged with the demo file on load and runs through the same matching");
  assert.equal(withStored.signals.find(item => item.id === "SIG-IL-TLV-0104").evidenceLevel, "TRUSTED_CORROBORATED", "the runway works now have a second source");
  const { rm: remove } = await import("node:fs/promises");
  await remove(join(dataDir(root), "enterprise-alerts.json"));
  console.log("ok  enterprise risk alerts: 7 received; the Belgian strike and the US storm merge as extra sources, the Andalusian heat outlook is a new single-source potential exposure for SHP-ES-08 and SHP-ES-10, 3 counted (an outage at a forwarder we don't use, a typhoon in Taiwan, a Paris demonstration), 1 coverage gap (the Swiss manufacturer); stored alerts are validated and merged on load");
}
console.log("ok  verifier: Amsterdam passes with the same delivery day, Luxembourg needs a monitoring decision, 25 Nov arrives after the Tel Aviv stock runs out, 24 Nov fails at the depot, 20 Nov is too late to prepare, no departure from Paris, no airport for road shipments");

// 5. Monitoring decisions: the right role, a reason, the audit trail; nothing switches on by itself.
const allowed = ss.scope.recommendations.map(item => item.code);
const names = ss.names;
assert.throws(() => setMonitoring(root, data.network, { country: "LU", kind: "external", enabled: true, reason: "Alternative departure for Israel" }, { ...regulatorySme, allowed, names }), /Clinical Supply turns external risk monitoring/);
assert.throws(() => setMonitoring(root, data.network, { country: "LU", kind: "regulatory", enabled: true, reason: "Customs on the new route" }, { ...clinicalSupply, allowed, names }), /The Regulatory SME turns regulatory and customs monitoring/);
assert.throws(() => setMonitoring(root, data.network, { country: "LU", kind: "external", enabled: true, reason: "" }, { ...clinicalSupply, allowed, names }), /Say why/);
assert.throws(() => setMonitoring(root, data.network, { country: "DE", kind: "external", enabled: false, reason: "test" }, { ...clinicalSupply, allowed, names }), /monitored automatically/);
assert.throws(() => setMonitoring(root, data.network, { country: "LU", kind: "external", enabled: true, reason: "test" }, { ...quality, allowed, names }), /turns external risk monitoring/);
setMonitoring(root, data.network, { country: "LU", kind: "external", enabled: true, reason: "Alternative departure for Israeli shipments" }, { ...clinicalSupply, allowed, names });
data = await loadData(root);
assert.equal(data.supplyshield.scope.recommendations.find(item => item.code === "LU").monitoring.external.on, true);
assert.equal(verifyOption(data, "SHP-IL-01", [{ type: "reroute", via: "LUX" }]).passes, true, "once Luxembourg is monitored, the route can be assessed and passes");
setMonitoring(root, data.network, { country: "BE", kind: "external", enabled: false, reason: "Rehearsal: what if no one had turned Belgium on" }, { ...clinicalSupply, allowed, names });
data = await loadData(root);
assert.equal(data.supplyshield.signals.some(item => item.id === "SIG-BE-STRIKE-1124"), false, "Belgium is not monitored: its events are not assessed");
// No false assurance: the strike is no longer seen, but the route is not called clear either.
const blind = checkShipment(data, "SHP-IL-01");
assert.equal(blind.result, "Confirm", "a booked leg in an unmonitored country is a confirmation, never Ready");
const blindCheck = blind.checks.find(item => item.section === "risk" && item.requirement === "External risk is monitored on every country of the route");
assert.equal(blindCheck.result, "Confirm");
assert.match(blindCheck.detail, /^External risk is not monitored on this route: Belgium \(depot and departure\)\..*Turn it on in Monitoring scope or confirm with the EMEA specialty courier\.$/);
assert.deepEqual(blindCheck.unmonitored, ["BE"]);
assert.ok(!blind.checks.some(item => item.result === "Pass" && /No disruption/.test(item.requirement) && !/Not monitored: Belgium/.test(item.detail)), "any pass on the route names what is not monitored");
assert.match(checkShipment(data, "SHP-03").checks.find(item => item.unmonitored).detail, /Belgium \(depot\)/, "a road shipment from the Belgian depot");
assert.equal(checkShipment(data, "SHP-04").checks.some(item => item.unmonitored), false, "only countries on the booked route count: a UK shipment is untouched");
assert.ok(allShipmentChecks(data).every(item => item.result !== "Ready" || !(data.supplyshield.routes[item.id]?.countries ?? []).includes("BE")), "no shipment through Belgium is Ready while Belgium is unmonitored");
const audit = openDatabase(root).prepare("SELECT actor, role, type, detail FROM audit_entry WHERE type = 'scope.monitoring_changed' ORDER BY seq").all();
assert.deepEqual(audit.map(row => [row.actor, row.role]), [[clinicalSupply.by, "viewer"], [clinicalSupply.by, "viewer"]]);
assert.match(audit[0].detail, /Luxembourg · External risk monitoring on · Alternative departure/);
setMonitoring(root, data.network, { country: "BE", kind: "external", enabled: true, reason: "Rehearsal over: our central EU depot is in Belgium" }, { ...clinicalSupply, allowed, names });
data = await loadData(root);
const seen = checkShipment(data, "SHP-IL-01");
assert.equal(seen.result, "Blocked", "Belgium monitored again: the strike is seen again");
assert.ok(seen.checks.some(item => item.section === "risk" && item.result === "Fail" && /cancelled/.test(item.detail)) && !seen.checks.some(item => item.unmonitored), "back to the strike Fail, and no unmonitored-route check");
// Reviewing recommendations: dismiss with a reason, restore; never a country that is being monitored.
assert.throws(() => reviewRecommendation(root, data.network, { country: "MA", decision: "dismiss", reason: "" }, { ...clinicalSupply, allowed, names }), /Say why/);
assert.throws(() => reviewRecommendation(root, data.network, { country: "LU", decision: "dismiss", reason: "No longer needed" }, { ...clinicalSupply, allowed, names }), /Turn its monitoring off/);
assert.throws(() => reviewRecommendation(root, data.network, { country: "MA", decision: "dismiss", reason: "Not on any route" }, { ...quality, allowed, names }), /Clinical Supply or the Regulatory SME/);
reviewRecommendation(root, data.network, { country: "MA", decision: "dismiss", reason: "Sea proximity only; no route or facility there" }, { ...regulatorySme, allowed, names });
data = await loadData(root);
assert.deepEqual([data.supplyshield.scope.recommendations.find(item => item.code === "MA").review.state, data.supplyshield.scope.recommendations.find(item => item.code === "MA").review.by], ["dismissed", regulatorySme.by]);
reviewRecommendation(root, data.network, { country: "MA", decision: "restore", reason: "" }, { ...clinicalSupply, allowed, names });
data = await loadData(root);
assert.equal(data.supplyshield.scope.recommendations.find(item => item.code === "MA").review.state, "open");
assert.equal(verifyAudit(openDatabase(root)).ok, true, "the hash chain holds");
console.log("ok  monitoring decisions: Clinical Supply owns external risk, the Regulatory SME regulatory and customs, a reason is required, active-trial countries cannot be switched, recommendations can be dismissed and restored, every change is in the hash-chained audit trail");
console.log("ok  no false assurance: with Belgium unmonitored, SHP-IL-01 is Confirm (\"External risk is not monitored on this route: Belgium (depot and departure)\"), never Ready; Belgium on again brings back the strike Fail");

// 6. No portfolio, no scope: nothing is monitored and nothing is assumed.
setPortfolioConnection(root, data.network, false, clinicalSupply);
data = await loadData(root);
assert.equal(data.supplyshield.scope.status, "undetermined");
assert.match(data.supplyshield.scope.message, /cannot identify the active-trial countries without the authorised CTMS/);
assert.equal(data.supplyshield.scope.agentAnswer, "I cannot identify your active-trial countries without the authorized CTMS/study-country export. I will not substitute a global list of clinical trial countries or monitor all countries by default. Please connect the portfolio or supply an approved CSV/API response.", "the starter pack's exact answer");
assert.deepEqual([data.supplyshield.scope.countries.length, data.supplyshield.scope.recommendations.length, data.supplyshield.signals.length], [0, 0, 0]);
assert.ok(allShipmentChecks(data).every(item => !item.checks.some(check => check.section === "risk")), "no route checks without a scope");
setPortfolioConnection(root, data.network, true, clinicalSupply);
emptyScope(root, { by: "Start from empty" });
let state = readScopeState(root, data.network);
assert.equal(state.connected, false);
assert.deepEqual(state.choices, {}, "an empty workspace clears the decisions, including the recorded one");
setPortfolioConnection(root, data.network, true, clinicalSupply);
data = await loadData(root);
assert.ok(data.supplyshield.scope.recommendations.every(item => !item.monitoring.external.on && !item.monitoring.regulatory.on), "after an empty start, every recommendation is off");
console.log("ok  no portfolio: the scope cannot be determined, nothing is monitored, no country is assumed; an empty workspace starts with every recommendation off");

// 7. Live feeds become signals only for monitored countries; a whole-country alert is a potential exposure.
{
  const base = await loadData(root);
  const feeds = { fetchedAt: "2026-11-14T07:00:00Z", live: true,
    fcdo: { DE: { ok: true, url: "https://www.gov.uk/foreign-travel-advice/germany", updatedAt: "2026-11-13T10:00:00Z", alertStatus: ["avoid_all_but_essential_travel_to_whole_country"], change: "Test." }, RU: { ok: true, url: "https://www.gov.uk/foreign-travel-advice/russia", updatedAt: "2026-11-01T10:00:00Z", alertStatus: ["avoid_all_travel_to_whole_country"], change: "" } },
    gdacs: { ok: true, events: [{ id: "GDACS-FL-1", type: "FL", typeName: "Flood", alert: "Red", name: "Test flood", countries: ["ES"], from: "2027-02-01", to: "2027-02-05", url: "https://www.gdacs.org/" }, { id: "GDACS-EQ-2", type: "EQ", typeName: "Earthquake", alert: "Orange", name: "Elsewhere", countries: ["NZ"], from: "2026-11-14", to: "2026-11-14", url: "https://www.gdacs.org/" }] } };
  const views = [...base.portfolio.shipments, ...base.spain.trial.shipments, ...base.israel.trial.shipments].map(item => item.id).map(id => (base.supplyshield.routes[id] ? { id } : null)).filter(Boolean);
  assert.ok(views.length > 0);
  const { shipmentView, allShipmentIds } = await import("../regchain-ai/rules.mjs");
  const result = computeClinRadar({ network: base.network, portfolio: base.portfolio, spain: base.spain, israel: base.israel, views: allShipmentIds(base).map(id => shipmentView(base, id)),
    choices: {}, connected: true, feeds, recorded: { signals: [] }, today: base.today });
  const germany = result.signals.find(item => item.id.startsWith("FCDO-DE"));
  assert.equal(germany.tier, "potential", "a whole-country alert touches every German shipment, unconfirmed");
  assert.ok(!result.signals.some(item => item.id.startsWith("FCDO-RU")), "Russia is not monitored: its advice is evidence for a recommendation, not a signal");
  assert.equal(result.signals.find(item => item.id === "GDACS-FL-1").tier, "potential", "a flood in Spain during Spanish deliveries");
  assert.ok(!result.signals.some(item => item.id === "GDACS-EQ-2"), "an alert outside the monitored countries is not matched");
  assert.equal(result.feeds.gdacs.outside, 1);
  console.log("ok  live feeds: FCDO advice and GDACS alerts become signals only for monitored countries; a whole-country alert and an overlapping flood are potential exposures; the rest is counted, not matched");
}

// 8. The starter pack's acceptance tests that need a portfolio of their own (ClinRadar-Master-Prompt.md, section M).
{
  const base = await loadData(root);
  const { buildScope, riskChecks } = await import("../regchain-ai/supplyshield.mjs");
  const { shipmentView, allShipmentIds } = await import("../regchain-ai/rules.mjs");
  const scopeOf = (studies, feeds = null) => buildScope({ network: { ...base.network, ctms: { ...base.network.ctms, studies } }, portfolio: { studies: [], sites: [] }, views: [], choices: {}, connected: true,
    feeds, today: base.today, config: base.config, catalogue: base.catalogue, specs: base.specs });
  const greeceGermany = scopeOf([{ id: "T-1", status: "RECRUITING", countries: { GR: { status: "ACTIVE" } } }, { id: "T-2", status: "TREATMENT_ONGOING", countries: { DE: { status: "ACTIVE" } } }]);
  assert.deepEqual(greeceGermany.countries.map(item => item.code).sort(), ["DE", "GR"], "M1: active trials in Greece and Germany monitor GR and DE only");
  assert.ok(greeceGermany.recommendations.every(item => !item.monitoring.external.on && !item.monitoring.regulatory.on), "M4: every suggestion is off");
  assert.deepEqual(greeceGermany.recommendations.filter(item => item.reasons.some(reason => reason.kind === "land" && /Greece/.test(reason.text))).map(item => item.code).sort(), ["AL", "BG", "MK", "TR"], "M4: Greek land neighbours from the geography table");
  assert.ok(!greeceGermany.recommendations.find(item => item.code === "CY")?.reasons.some(reason => reason.kind === "land"), "M4, M27: Cyprus is never a Greek land neighbour");
  assert.deepEqual(greeceGermany.supranational[0].appliesTo.sort(), ["DE", "GR"], "M8: EU rules are assessed for DE and GR");
  assert.equal(greeceGermany.monitored.regulatory.sort().join(","), "DE,GR", "M8: no other EU country is switched on");
  assert.ok(!scopeOf([{ id: "T-1", status: "RECRUITING", countries: { GR: { status: "ACTIVE" } } }, { id: "T-3", status: "COMPLETED", countries: { BR: { status: "CLOSED" } } }]).countries.some(item => item.code === "BR"), "M2: a completed study in Brazil adds nothing");
  assert.deepEqual(scopeOf([{ id: "T-4", status: "RECRUITING", countries: { JP: { status: "CLOSED" }, DE: { status: "ACTIVE" } } }]).countries.map(item => item.code), ["DE"], "M3: Japan with all sites closed is not monitored");
  const contradictory = scopeOf([{ id: "T-5", status: "RECRUITING", countries: { DE: { status: "UNKNOWN" } } }, { id: "T-6", status: "MYSTERY_STATUS", countries: { FR: { status: "ACTIVE" } } }]);
  assert.equal(contradictory.countries.length, 0);
  assert.deepEqual(contradictory.reviewWarnings.map(item => item.code).sort(), ["DE", "FR"], "M25: unknown statuses become review warnings, not activations");
  const kenya = scopeOf([{ id: "T-7", status: "RECRUITING", countries: { KE: { status: "ACTIVE" } } }]);
  assert.equal(kenya.countries[0].name, "Kenya", "M28: any country in the ISO vocabulary works");
  assert.ok(kenya.bordersUnknown.some(item => item.code === "KE"), "border relation unknown rather than invented");
  assert.ok(kenya.coverage.gaps.some(item => item.code === "KE"), "M29: an uncovered country states its source gaps");
  const insufficient = riskChecks(base.supplyshield, base.network, { id: "SHP-X", countryId: "ke", carrier: "Unknown courier", dispatch: "2026-11-20", delivery: null, siteId: "S-1", site: "Nairobi" });
  assert.ok(insufficient[0].result === "Confirm" && /Insufficient data/.test(insufficient[0].detail), "M11: no route means insufficient data, never invented transit countries");
  const broken = scopeOf([{ id: "T-2", status: "TREATMENT_ONGOING", countries: { DE: { status: "ACTIVE" } } }], { fetchedAt: "2026-11-14T07:00:00Z", live: true, fcdo: { DE: { ok: false, error: "HTTP 503" } }, gdacs: { ok: true, events: [] } });
  assert.equal(broken.countries[0].coverage.external, "degraded", "M17: a broken feed is a coverage gap, never no risk");
  // M16 and M20 against the real shipments: two reports of one road protest merge; a tracking outage stays visibility only.
  const views = allShipmentIds(base).map(id => shipmentView(base, id));
  const recorded = { signals: [
    { id: "T-ROAD-A", category: "road", title: "Road protest A", country: "BE", authority: "Source A", publishedAt: "2026-11-13T10:00:00Z", window: { from: "2026-11-23", to: "2026-11-24" }, locations: [{ kind: "road", country: "BE", effect: "Slow traffic." }] },
    { id: "T-ROAD-B", category: "road", title: "Road protest B", country: "BE", authority: "Source B", publishedAt: "2026-11-13T12:00:00Z", window: { from: "2026-11-24", to: "2026-11-24" }, locations: [{ kind: "road", country: "BE", effect: "Slow traffic." }] },
    { id: "T-TRACK", category: "tracking", title: "Courier tracking outage", country: "BE", authority: "Status page", publishedAt: "2026-11-20T08:00:00Z", window: { from: "2026-11-23", to: "2026-11-26" }, locations: [{ kind: "provider", carrier: "EMEA specialty courier", effect: "Tracking delayed." }] },
  ] };
  const result = computeClinRadar({ network: base.network, portfolio: base.portfolio, spain: base.spain, israel: base.israel, views, choices: { "BE|external": { enabled: true, by: "test" } }, connected: true,
    feeds: null, recorded, today: base.today, config: base.config, catalogue: base.catalogue, specs: base.specs });
  const roads = result.signals.filter(item => item.category === "road");
  assert.equal(roads.length, 1, "M16: two reports of the same protest are one signal");
  assert.equal(roads[0].sources.length, 2);
  const track = result.signals.find(item => item.id === "T-TRACK");
  assert.ok(track.matches.length && track.matches.every(match => match.tier === "potential" && match.trackingOnly && /Tracking visibility lost/.test(match.missing)), "M20: a tracking outage is lost visibility, not a lost shipment");
  assert.equal(base.supplyshield.signals.find(item => item.id.startsWith("FCDO-IL")).tier, "observed", "M18: official advice for parts of a country restricts no shipment by itself");
  console.log("ok  starter pack acceptance tests M1, M2, M3, M4, M8, M11, M16, M17, M18, M20, M25, M27, M28, M29 (the others are covered above or by check:server)");
}

// 9. The page gets exactly what the rules decide.
{
  const payload = supplyShieldPayload(await loadData(root));
  assert.ok(payload.scope && payload.signals && payload.extraChecks["SHP-IL-01"].length && Object.keys(payload.results).length === 25);
  assert.equal(Object.keys(MONITORING_KINDS).length, 2);
  console.log("ok  page payload: scope, signals, routes and the route and permit checks for all 25 shipments");
}

closeDatabase(root);
await rm(temp, { recursive: true, force: true }).catch(() => {});
console.log("All ClinRadar checks passed.");
