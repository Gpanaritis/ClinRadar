// Shipment checks and option verification, for the agents and their MCP tools.
// The same rules as the dashboard's Shipment checks page: scripts/check-agent.mjs confirms both give the same results.
// Nothing here uses AI. The agents propose options; these rules decide whether an option passes and is feasible.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readFileSync, renameSync } from "node:fs";
import { appendAudit, openDatabase, transaction, dataDir } from "./db.mjs";
import { readEnterpriseAlerts } from "./enterprise.mjs";
import { cacheDir } from "./sources.mjs";
import { computeClinRadar, riskChecks, routeFor, watchSummary } from "./supplyshield.mjs";
import { readFeeds } from "./feeds.mjs";
import { readScopeState } from "./monitoring.mjs";
import { parseYaml } from "./yaml-lite.mjs";

// Approvals made before they moved into the database were kept in agent-approvals.json in the cache folder. They are
// imported once, each with an audit entry, and the file is renamed so it is never read again.
const importedFrom = new Set();
function importFileApprovals(root, db) {
  const file = join(cacheDir(root), "agent-approvals.json");
  if (importedFrom.has(file)) return;
  importedFrom.add(file);
  let approvals;
  try { approvals = JSON.parse(readFileSync(file, "utf8")); } catch { return; }
  transaction(db, () => {
    for (const [shipment, approval] of Object.entries(approvals ?? {})) {
      if (!/^SHP-[A-Z0-9-]+$/.test(shipment) || !approval?.option || db.prepare("SELECT 1 FROM agent_approval WHERE shipment_id = ?").get(shipment)) continue;
      const by = String(approval.by ?? "unknown").slice(0, 120);
      const at = approval.at ?? new Date().toISOString();
      db.prepare("INSERT INTO agent_approval (shipment_id, option_id, title, actions, after, approved_by, role, approved_at, run_at, mode, drafts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(shipment, approval.option, approval.title ?? approval.option, JSON.stringify(approval.actions ?? []), approval.after ?? null, by, null, at, approval.runAt ?? null, approval.mode ?? null, JSON.stringify(approval.drafts ?? []));
      appendAudit(db, { actor: "RegChain upgrade", type: "approval.imported", subjectType: "shipment", subjectId: shipment,
        detail: `${approval.title ?? approval.option}, approved by ${by} at ${at}, imported from agent-approvals.json`, data: { option: approval.option, title: approval.title ?? null, by, approvedAt: at, runAt: approval.runAt ?? null, drafts: approval.drafts ?? [] } });
    }
  });
  try { renameSync(file, file.replace(/\.json$/,`.imported-${Date.now()}.json`)); } catch {}
}

// Plans people approved in RegChain. Each one holds the stock and relabelling capacity it uses until it is withdrawn,
// so no two shipments are promised the same kits or the same slot.
export async function readApprovals(root) {
  const db = openDatabase(root);
  importFileApprovals(root, db);
  return Object.fromEntries(db.prepare("SELECT * FROM agent_approval").all().map(row => [row.shipment_id, {
    option: row.option_id, title: row.title, actions: JSON.parse(row.actions), after: row.after, by: row.approved_by, role: row.role,
    at: row.approved_at, runAt: row.run_at, mode: row.mode, drafts: JSON.parse(row.drafts) }]));
}

// The Israel scenario's stock, relabelling slots, label approval, courier, site stock, import approvals and contacts join
// the operational data, as if the IRT, ERP, depot and eTMF held them.
function mergeIsraelOperations(ops, israel) {
  const { trial, operations } = israel;
  const depot = trial.depot;
  ops.depotStock[depot] = { ...(ops.depotStock[depot] ?? {}), ...operations.depotStock };
  const relabel = ops.relabel[depot] ?? { slots: [], turnaroundBusinessDays: operations.relabel.turnaroundBusinessDays };
  ops.relabel[depot] = { ...relabel, slots: [...relabel.slots, ...operations.relabel.slots].sort((a, b) => a.date.localeCompare(b.date)) };
  ops.labelApprovals.IL = { ...(ops.labelApprovals.IL ?? {}), [trial.product]: { status: "approved", version: "1", label: operations.relabel.label } };
  ops.couriers["EMEA specialty courier"] = { from: depot, to: trial.countries, standardTransitBusinessDays: operations.transitBusinessDays, expressTransitBusinessDays: 2, weekend: false,
    note: "Delivers to Israeli sites Sunday to Thursday, and to Greece and Cyprus Monday to Friday." };
  Object.assign(ops.siteStockDays, operations.siteStockDays);
  for (const shipment of trial.shipments) ops.shipmentKits[shipment.id] = shipment.kits;
  ops.importApprovals = { ...(ops.importApprovals ?? {}), ...operations.importApprovals };
  Object.assign(ops.siteContacts, operations.contacts);
  ops.trialAuthorisations[`${trial.id}|IL`] ??= { route: "moh_approved", document: "Ministry of Health clinical trial approval, 4 Feb 2026", reference: "TMF-021-IL-0042", irtRecord: "approved" };
}

export async function loadData(root) {
  const read = async name => JSON.parse(await readFile(join(root, "demo-data", name), "utf8"));
  const optional = name => read(name).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  const [portfolio, spain, specifications, ops, israel, approvals, network, recorded, feeds] = await Promise.all([
    read("uk-labelling-portfolio.json"), read("spain-scenario.json"), read("country-specifications.json"), read("supply-operations.json"), optional("israel-scenario.json"), readApprovals(root),
    optional("supply-network.json"), optional("external-signals.json"), readFeeds(root),
  ]);
  const specs = { ...specifications.countries, es: spain.specification, ...(israel?.specifications ?? {}) };
  if (israel) mergeIsraelOperations(ops, israel);
  const data = { portfolio, spain, israel, specs, ops, network, today: portfolio.assessment_as_of.slice(0, 10), ukEffective: "2026-04-28", approvals };
  data.reservations = Object.entries(approvals).flatMap(([shipment, approval]) => planReservations(data, shipment, approval.actions ?? []));
  if (network) {
    // ClinRadar: the monitoring scope from the active-trial portfolio, read with the company's status policy
    // (config/supplyshield.yaml), and every external signal matched to our shipments.
    // Enterprise risk alerts: the demo file plus whatever the ingest webhook stored in the data folder.
    const [configText, catalogueText, enterprise] = await Promise.all([
      readFile(join(root, "config", "supplyshield.yaml"), "utf8").catch(() => ""), readFile(join(root, "demo-data", "country-catalogue-iso3166.csv"), "utf8").catch(() => ""),
      readEnterpriseAlerts(root, dataDir(root)),
    ]);
    const state = readScopeState(root, network);
    data.scopeState = state;
    data.config = configText ? parseYaml(configText) : {};
    data.catalogue = readCatalogue(catalogueText);
    data.supplyshield = computeClinRadar({ network, portfolio, spain, israel, views: allShipmentIds(data).map(id => shipmentView(data, id)), choices: state.choices,
      connected: state.connected, feeds, recorded, today: data.today, config: data.config, catalogue: data.catalogue, specs, enterprise });
  }
  return data;
}

// The ISO 3166 country catalogue: a vocabulary of names and codes, never a list of countries to monitor.
function readCatalogue(text) {
  const names = {};
  const rows = String(text).replace(/\r/g, "").split("\n").filter(Boolean);
  for (const row of rows.slice(1)) {
    const cells = [];
    let cell = "";
    let quoted = false;
    for (const char of row) {
      if (char === '"') quoted = !quoted;
      else if (char === "," && !quoted) { cells.push(cell); cell = ""; }
      else cell += char;
    }
    cells.push(cell);
    if (/^[A-Z]{2}$/.test(cells[0])) names[cells[0]] = cells[3];
  }
  return names;
}

export const allShipmentIds = data => [...data.portfolio.shipments.map(item => item.id), ...data.spain.trial.shipments.map(item => item.id), ...(data.israel?.trial.shipments.map(item => item.id) ?? [])];

const DAY = 86400000;
export const sectionNames = {
  regulatory: "Regulatory requirements", import: "Import and export rules", permits: "Permits and licences", controlled: "Controlled-drug classifications",
  invoice: "Mandatory invoice statements", ports: "Ports of entry", logistics: "Logistics constraints", carriers: "Approved carriers",
  ior: "Importer of record and consignee", contacts: "Local contacts", notes: "Country-specific notes",
};
const countryOf = code => (code === "GB" ? "uk" : code.toLowerCase());
export const addDays = (day, days) => new Date(Date.parse(day) + days * DAY).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);
export const isWeekend = day => [0, 6].includes(new Date(day + "T00:00:00Z").getUTCDay());
// Israeli sites receive Sunday to Thursday: Friday and Saturday are the weekend.
export const isIsraeliWeekend = day => [5, 6].includes(new Date(day + "T00:00:00Z").getUTCDay());
const shortDay = day => new Date(day + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !Number.isNaN(Date.parse(value + "T00:00:00Z"));
export function businessDaysBefore(day, count) {
  const date = new Date(day + "T00:00:00Z");
  for (let left = count; left > 0;) {
    date.setUTCDate(date.getUTCDate() - 1);
    if (![0, 6].includes(date.getUTCDay())) left--;
  }
  return date.toISOString().slice(0, 10);
}
export function businessDaysAfter(day, count) {
  const date = new Date(day + "T00:00:00Z");
  for (let left = count; left > 0;) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (![0, 6].includes(date.getUTCDay())) left--;
  }
  return date.toISOString().slice(0, 10);
}

// The UK labeling rule, as in the dashboard (finished-IMP QP certification date against 28 Apr 2026).
function ukLabelFinding(batch, effective) {
  if (!batch.qp) return ["Insufficient information", "Finished-IMP QP certification date is missing."];
  if (!batch.label) return ["Insufficient information", "Label version is missing."];
  if (batch.qp === effective) return ["Needs SME assessment", "QP certification is on the cutoff date."];
  if (batch.qp < effective) return batch.oldRules && batch.intended && batch.legacyEvidence
    ? ["Potential transition eligibility", "Pre-cutoff QP, old-rules cohort, intended use and legacy labeling evidence are present."]
    : ["Insufficient information", "Confirm the old-rules trial, intended use and labeling evidence."];
  if (batch.label === "Legacy") return ["Labeling review required", "Post-cutoff QP certification and a legacy label reference."];
  return ["Verify specification", "Post-cutoff QP certification. Check the approved specification and applicable conditions."];
}
const labelResult = status => ({ "Labeling review required": "Fail", "Insufficient information": "Missing", "Needs SME assessment": "Decision", "Verify specification": "Confirm", "Potential transition eligibility": "Confirm" }[status] ?? "Pass");

// A portfolio batch as the rules see it, with any overrides from an option.
function portfolioBatch(data, batchId, overrides = {}) {
  const { portfolio } = data;
  const batch = portfolio.batches.find(item => item.id === batchId);
  if (!batch) return null;
  const studyCountry = portfolio.study_countries.find(item => item.id === batch.study_country_id);
  const label = portfolio.label_specs.find(item => item.id === batch.label_spec_id);
  const route = overrides.authorisationRoute ?? studyCountry.authorization_cohort;
  return {
    id: batch.id, study: batch.study_id, product: batch.product_id, qp: batch.finished_imp_qp_certification_date,
    label: overrides.relabelled ? "Updated" : label ? (label.legacy_reference ? "Legacy" : "Updated") : undefined,
    labelSpec: label, route, oldRules: route === "old_rules", intended: batch.intended_trial_use_confirmed, legacyEvidence: batch.legacy_labeling_evidence_on_file,
  };
}

// Normalised view of one planned shipment, from the portfolio or the Spain scenario.
export function shipmentView(data, shipmentId) {
  const { portfolio, spain, ops } = data;
  const planned = portfolio.shipments.find(item => item.id === shipmentId);
  if (planned) {
    const site = portfolio.sites.find(item => item.id === planned.site_id);
    const countryId = countryOf(site.country_code);
    const carrier = { "PARTNER-LOGISTICS-UK-01": "UK logistics partner", "PARTNER-LOGISTICS-EU-01": "EU logistics partner" }[planned.logistics_partner_id] ?? planned.logistics_partner_id;
    return {
      id: planned.id, source: "portfolio", countryId, siteId: site.id, site: site.city, hospital: "", dispatch: planned.planned_dispatch_date, delivery: null,
      leadDays: planned.preparation_lead_calendar_days, leadType: "calendar", batch: planned.batch_ids[0], kits: ops.shipmentKits[planned.id] ?? null,
      carrier, depot: countryId === "uk" ? "UK depot" : "Central EU depot, Belgium", trial: portfolio.batches.find(item => item.id === planned.batch_ids[0])?.study_id,
      patients: site.patients_on_treatment, siteStockDays: ops.siteStockDays[site.id] ?? null,
    };
  }
  const item = spain.trial.shipments.find(entry => entry.id === shipmentId);
  if (!item) return israelView(data, shipmentId);
  const site = spain.trial.sites.find(entry => entry.id === item.site);
  return {
    id: item.id, source: "spain", countryId: "es", siteId: site.id, site: site.city, hospital: site.hospital, dispatch: item.dispatch, delivery: item.delivery,
    leadDays: spain.trial.standardLeadBusinessDays, leadType: "business", batch: item.batch, kits: ops.shipmentKits[item.id] ?? item.kits, carrier: item.carrier,
    depot: "Central EU depot, Belgium", trial: spain.trial.id, patients: null, siteStockDays: null, pharmacyCode: site.pharmacyCode, kind: item.kind,
  };
}

function israelView(data, shipmentId) {
  const israel = data.israel;
  const item = israel?.trial.shipments.find(entry => entry.id === shipmentId);
  if (!item) return null;
  const site = israel.trial.sites.find(entry => entry.id === item.site);
  return {
    id: item.id, source: "israel", countryId: site.country.toLowerCase(), siteId: site.id, site: site.city, hospital: site.hospital, dispatch: item.dispatch, delivery: item.delivery,
    leadDays: israel.trial.standardLeadBusinessDays, leadType: "business", batch: item.batch, kits: data.ops.shipmentKits[item.id] ?? item.kits, carrier: item.carrier,
    depot: israel.trial.depot, trial: israel.trial.id, patients: site.patients, siteStockDays: data.ops.siteStockDays[site.id] ?? null, transitBusinessDays: israel.operations.transitBusinessDays,
  };
}

// The Israel scenario: one booklet label used to serve Israel, Greece and Cyprus. From the rule's effective date Israel
// refuses any label shared with another country, so the pooled stock splits: the booklet stays with Greece and Cyprus.
const LABEL_LANGUAGE = { IL: ["he", "Hebrew"], GR: ["el", "Greek"], CY: ["el", "Greek"] };
function israelChecks(data, view, overrides, dispatch, prep) {
  const { israel, specs, ops } = data;
  const rule = israel.case;
  const code = view.countryId.toUpperCase();
  const batch = israel.trial.batches.find(entry => entry.id === (overrides.batchId ?? view.batch));
  const labelId = overrides.relabelled ? ops.labelApprovals.IL?.[israel.trial.product]?.label : batch?.label;
  const label = israel.trial.labels.find(entry => entry.id === labelId);
  const delivery = overrides.dispatch ? businessDaysAfter(overrides.dispatch, view.transitBusinessDays) : view.delivery;
  const [language, languageName] = LABEL_LANGUAGE[code];
  const checks = [];
  checks.push({ section: "regulatory", requirement: `The label includes ${languageName}`, result: label?.languages.includes(language) ? "Pass" : "Fail",
    detail: label ? `${label.type} label ${label.id} covers ${label.languages.join(", ").toUpperCase()}.` : `Batch ${batch?.id} has no label on record.` });
  if (code === "IL") {
    const others = (label?.countries ?? []).filter(country => country !== "IL");
    const refused = others.length > 0 && delivery >= rule.effective;
    checks.push({ section: "regulatory", requirement: `From ${shortDay(rule.effective)}: an Israel-only label with the Ministry of Health trial approval number`, result: refused ? "Fail" : "Pass",
      detail: !others.length ? `${label?.id} is an Israel-only label.` : refused
        ? `${label.id} is shared with ${others.join(" and ")}. Kits imported on ${delivery} are refused: relabel them for Israel, use Israel-only stock, or import before ${shortDay(rule.effective)}.`
        : `Shared label ${label.id} is still accepted: the kits are imported on ${delivery}, before ${shortDay(rule.effective)}.` });
    const approval = ops.importApprovals?.[view.id];
    checks.push({ section: "import", requirement: "A Ministry of Health import approval for this shipment", result: approval?.status === "approved" ? "Pass" : approval?.status === "requested" ? "Confirm" : "Missing",
      detail: approval?.status === "approved" ? `Import approval ${approval.number} is on record.` : approval?.status === "requested"
        ? `Requested on ${approval.requested}; usually granted in ${approval.typicalBusinessDays} business days. Confirm it before dispatch.` : "No import approval is on record." });
    // The approval's own terms: the port of entry, the quantity, the consignee and the validity cover this shipment.
    const permit = (data.network?.permits ?? []).find(item => item.shipment === view.id);
    if (permit) {
      const route = routeFor(data.network, view, overrides);
      const arrival = route?.arrival ?? null;
      const kits = view.kits ?? 0;
      const problems = [
        arrival && arrival !== permit.portOfEntry ? `the shipment would arrive at ${arrival}, but ${permit.id} names ${permit.portOfEntry} as the port of entry` : "",
        kits > permit.kits ? `${kits} kits, but ${permit.id} covers ${permit.kits}` : "",
        delivery > permit.validUntil ? `delivery on ${delivery}, after ${permit.id} expires on ${permit.validUntil}` : "",
        permit.consignee !== view.hospital ? `${permit.id} names ${permit.consignee} as consignee, not ${view.hospital}` : "",
      ].filter(Boolean);
      checks.push({ section: "permits", requirement: "The import approval covers the port of entry, the kits, the consignee and the delivery date", result: problems.length ? "Fail" : "Pass",
        detail: problems.length ? `Not covered: ${problems.join("; ")}.` : `${permit.id}: port of entry ${permit.portOfEntry}, up to ${permit.kits} kits for ${permit.consignee}, valid until ${permit.validUntil}.` });
    }
  } else {
    const covered = (label?.countries ?? []).includes(code);
    checks.push({ section: "regulatory", requirement: `The label covers ${code === "GR" ? "Greece" : "Cyprus"}`, result: covered ? "Pass" : "Fail",
      detail: covered ? `${label.id} covers ${label.countries.join(", ")}; a multi-country booklet that includes Greek is accepted.` : `${label?.id} is for ${(label?.countries ?? []).join(", ")} only.` });
  }
  checks.push({ section: "import", requirement: "The batch's QP release documentation travels with the shipment", result: batch?.qp && batch.qp <= dispatch ? "Pass" : "Missing",
    detail: batch?.qp ? `Batch ${batch.id} was QP released on ${batch.qp}.` : `Batch ${batch?.id} has no QP release on record.` });
  checks.push(prep);
  checks.push({ section: "logistics", requirement: "Dispatched on a depot working day", result: isWeekend(dispatch) ? "Fail" : "Pass", detail: isWeekend(dispatch) ? `Dispatch on ${dispatch}, a weekend day.` : `Dispatch on ${dispatch}.` });
  const offDay = code === "IL" ? isIsraeliWeekend(delivery) : isWeekend(delivery);
  checks.push({ section: "logistics", requirement: code === "IL" ? "Delivered on an Israeli working day (Sunday to Thursday)" : "Delivered on a working day", result: offDay ? "Fail" : "Pass",
    detail: offDay ? `Delivery on ${delivery}, ${code === "IL" ? "a Friday or Saturday, when Israeli sites do not receive" : "a weekend day"}.` : `Delivery on ${delivery}.` });
  const approved = (specs[view.countryId]?.sections.carriers?.items ?? []).some(entry => entry.startsWith(view.carrier));
  checks.push({ section: "carriers", requirement: "Carrier on the approved list", result: approved ? "Pass" : "Fail", detail: `${view.carrier}${approved ? " is approved." : " is not approved."}` });
  if (code === "IL") checks.push({ section: "ior", requirement: "Importer of record: the sponsor's local representative; consignee: the site pharmacy", result: "Pass", detail: `Consignee: ${view.hospital}.` });
  return checks;
}

// The day the depot must start preparing a shipment for a given dispatch date.
export const prepareByFor = (view, dispatch) => (view.leadType === "business" ? businessDaysBefore(dispatch, view.leadDays) : addDays(dispatch, -view.leadDays));

function preparation(view, overrides, today) {
  const dispatch = overrides.dispatch ?? view.dispatch;
  const prepareBy = prepareByFor(view, dispatch);
  const days = daysBetween(today, prepareBy);
  const result = days < 0 ? "Fail" : days === 0 || isWeekend(prepareBy) ? "Confirm" : "Pass";
  const detail = days < 0 ? `The preparation date, ${prepareBy}, has passed.` : days === 0 ? `Prepare today, ${prepareBy}.` :
    isWeekend(prepareBy) ? `Prepare by ${prepareBy}, a weekend day; move it to the working day before.` : `Prepare by ${prepareBy}, in ${days} days.`;
  return { prepareBy, check: { section: "logistics", requirement: `Prepared ${view.leadDays} ${view.leadType} days before dispatch`, result, detail } };
}

// Every check for one shipment, against its destination's specification. `overrides` describe an option being tested.
export function checkShipment(data, shipmentId, overrides = {}) {
  const view = shipmentView(data, shipmentId);
  if (!view) throw new Error(`Unknown shipment ${shipmentId}`);
  const { specs, today, spain } = data;
  const dispatch = overrides.dispatch ?? view.dispatch;
  const checks = [];
  const { prepareBy, check: prep } = preparation(view, overrides, today);
  if (view.source === "portfolio") {
    const batch = portfolioBatch(data, overrides.batchId ?? view.batch, overrides);
    if (view.countryId === "uk") {
      const [status, reason] = ukLabelFinding(batch, data.ukEffective);
      checks.push({ section: "regulatory", requirement: "Label meets the amended Part 7 rules, or the batch qualifies for the transition", result: labelResult(status), detail: `${status}. ${reason}` });
      checks.push({ section: "import", requirement: "QP certification evidence on file before the first shipment from the batch", result: batch.qp ? "Pass" : "Missing",
        detail: batch.qp ? `Batch ${batch.id} was QP certified on ${batch.qp}.` : `Batch ${batch.id} has no QP certification date on record.` });
      checks.push({ section: "permits", requirement: "The trial's MHRA authorisation route is recorded", result: batch.route === "unknown" ? "Missing" : "Pass",
        detail: batch.route === "unknown" ? "The trial's authorisation route (old or new rules) is not recorded." : `Authorised under the ${batch.route === "old_rules" ? "old" : "new"} rules.` });
      checks.push({ section: "controlled", requirement: "Not a controlled drug, or a Home Office import licence for this shipment", result: "Pass", detail: "No IMP in the active UK trials is a controlled drug." });
      checks.push(prep);
      checks.push({ section: "logistics", requirement: "Dispatched on a working day", result: isWeekend(dispatch) ? "Fail" : "Pass", detail: isWeekend(dispatch) ? `Dispatch on ${dispatch}, a weekend day; the depot dispatches on working days only.` : `Dispatch on ${dispatch}.` });
      const approved = specs.uk.sections.carriers.items.some(item => item.startsWith(view.carrier));
      checks.push({ section: "carriers", requirement: "Carrier on the approved list", result: approved ? "Pass" : "Fail", detail: `${view.carrier}${approved ? " is approved." : " is not approved."}` });
      checks.push({ section: "invoice", requirement: "Invoice statements", result: "Not checked", detail: "Invoice data is not connected yet." });
    } else {
      const code = view.countryId.toUpperCase();
      const hasSpec = (batch.labelSpec && batch.labelSpec.jurisdiction === code) || overrides.labelSpecFor === code;
      checks.push({ section: "regulatory", requirement: `A label specification for ${code}`, result: hasSpec ? "Pass" : "Missing",
        detail: hasSpec ? `A ${code} label specification is on record.` : `Batch ${batch.id} has no label specification for ${code} on record.` });
      checks.push(prep);
      for (const section of ["import", "carriers", "invoice"]) checks.push({ section, requirement: sectionNames[section], result: "Not checked", detail: `The ${code} specification has no ${sectionNames[section].toLowerCase()} section yet.` });
    }
  } else if (view.source === "israel") {
    checks.push(...israelChecks(data, view, overrides, dispatch, prep));
  } else {
    const rule = spain.case;
    const trial = spain.trial;
    const delivery = overrides.dispatch ? addDays(view.delivery, daysBetween(view.dispatch, overrides.dispatch)) : view.delivery;
    const earlier = dispatch < rule.effective && delivery <= rule.transitionDeliveredBy;
    const batch = trial.batches.find(entry => entry.id === (overrides.batchId ?? view.batch));
    const qp = overrides.qpDate ?? batch?.qp;
    const code = overrides.pharmacyCode ?? view.pharmacyCode;
    const noticeBy = businessDaysBefore(delivery, rule.noticeBusinessDays);
    checks.push({ section: "regulatory", requirement: "The label includes Spanish", result: trial.labelSpec.languages.includes("es") ? "Pass" : "Fail", detail: `${trial.labelSpec.id} covers ${trial.labelSpec.languages.join(", ")}.` });
    checks.push({ section: "import", requirement: "The batch's QP release documentation travels with the shipment", result: !qp ? "Missing" : qp > dispatch ? "Fail" : qp > data.today ? "Confirm" : "Pass",
      detail: !qp ? `No QP release is planned yet for batch ${batch?.id}.` : qp > dispatch ? `QP release on ${qp} is after dispatch.` : qp > data.today ? `QP release planned for ${qp}, before dispatch. Confirm the release happens.` : `QP released on ${qp}.` });
    checks.push({ section: "invoice", requirement: "From 1 Mar 2027: a Spanish delivery note with the EU trial number, pharmacy code and batch number", result: !earlier ? (code ? "Confirm" : "Missing") : "Pass",
      detail: earlier ? "Not needed: the earlier procedure applies." : code ? `Print the Spanish delivery note with pharmacy code ${code}.` : `${view.hospital} has no pharmacy code for the delivery note.` });
    checks.push({ section: "logistics", requirement: "From 1 Mar 2027: notice to the hospital pharmacy 3 business days before delivery", result: earlier ? "Pass" : daysBetween(data.today, noticeBy) < 0 ? "Fail" : "Confirm",
      detail: earlier ? "Not needed for this shipment." : `Send the notice by ${noticeBy}.` });
    checks.push(prep);
    checks.push({ section: "logistics", requirement: "Delivered on a working day", result: isWeekend(delivery) ? "Fail" : "Pass", detail: `Delivery on ${delivery}.` });
    const approved = specs.es.sections.carriers.items.some(entry => entry.startsWith(view.carrier));
    checks.push({ section: "carriers", requirement: "Carrier on the approved list", result: approved ? "Pass" : "Fail", detail: `${view.carrier}${approved ? " is approved." : " is not approved."}` });
    checks.push({ section: "ior", requirement: "Consignee: the hospital pharmacy of the trial site", result: "Pass", detail: `Consignee: ${view.hospital}.` });
    checks.push({ section: "invoice", requirement: "Pro-forma invoice statement", result: "Not checked", detail: "Invoice data is not connected yet." });
  }
  // ClinRadar: external events on this shipment's route, as the carrier and the depot report them.
  checks.push(...riskChecks(data.supplyshield, data.network, view, overrides));
  const results = checks.map(item => item.result);
  const result = results.some(item => ["Fail", "Missing", "Decision"].includes(item)) ? "Blocked" : results.includes("Confirm") ? "Confirm" : "Ready";
  return { id: view.id, country: view.countryId, dispatch, prepareBy, result, checks };
}

// Stock and relabelling capacity a plan would use.
export function planReservations(data, shipmentId, actions) {
  const view = shipmentView(data, shipmentId);
  if (!view) return [];
  return (actions ?? []).flatMap(action => action.type === "swap_batch" ? [{ kind: "stock", depot: view.depot, batch: action.batch_id, kits: view.kits ?? 0, shipment: shipmentId }]
    : action.type === "relabel" ? [{ kind: "relabel", depot: view.depot, date: action.relabel_date, kits: view.kits ?? 0, shipment: shipmentId }] : []);
}
// What other shipments' plans already hold.
function heldByOthers(data, shipmentId, match) {
  const items = (data.reservations ?? []).filter(item => item.shipment !== shipmentId && match(item));
  return { kits: items.reduce((sum, item) => sum + item.kits, 0), shipments: [...new Set(items.map(item => item.shipment))], tentative: items.some(item => item.tentative) };
}

export function verifyOptionSafe(data, shipmentId, actions) {
  try { return verifyOption(data, shipmentId, actions); }
  catch (error) { return { shipment: shipmentId, actions, feasible: false, notes: [`Not feasible: the option could not be checked (${error.message}).`], before: null, after: "Blocked", checks: [], passes: false, reservations: [] }; }
}

export function allShipmentChecks(data) {
  return allShipmentIds(data).map(id => checkShipment(data, id));
}

// What the page needs from ClinRadar: the scope, the assessed signals, and for each shipment the route and permit
// checks these rules add, so the page shows exactly what the agents and the verifier see.
export function supplyShieldPayload(data) {
  const ss = data.supplyshield;
  if (!ss) return null;
  const extraChecks = {};
  const results = {};
  for (const id of allShipmentIds(data)) {
    const result = checkShipment(data, id);
    results[id] = result.result;
    extraChecks[id] = result.checks.filter(item => item.section === "risk" || (item.section === "permits" && item.requirement.startsWith("The import approval covers")));
  }
  const { watch, regulatory } = watchBriefs(data);
  return {
    schema: 1, today: ss.today, checkedAt: ss.checkedAt, scope: ss.scope, signals: ss.signals, counts: ss.counts, byShipment: ss.byShipment, routes: ss.routes,
    feeds: ss.feeds, names: ss.names, extraChecks, results, log: data.scopeState?.log ?? [], connected: data.scopeState?.connected ?? true,
    patientsAtRisk: ss.patientsAtRisk, costReference: ss.costReference, watch, regulatoryItems: regulatory, enterprise: ss.enterprise ?? null,
  };
}

// The regulatory and customs items the regulatory watch agent follows: each rule change waiting for the Regulatory SME,
// and each import approval on record, with the planned shipments it holds today (from the shipment checks).
export function regulatoryWatchItems(data, results = allShipmentChecks(data)) {
  const open = check => !["Pass", "Not checked"].includes(check.result);
  const holding = (country, pick) => results.filter(item => item.country === country && item.checks.some(check => pick(check) && open(check))).map(item => item.id);
  const items = [
    { id: "RC-UK-001", kind: "change", country: "GB", title: "UK: amended Part 7 rules for IMP labels, with the Schedule 14 transition", short: "UK Part 7 labels", effective: data.ukEffective,
      touching: holding("uk", check => check.section === "regulatory") },
  ];
  if (data.spain?.case) items.push({ id: data.spain.case.id, kind: "change", country: "ES", title: "Spain: Spanish delivery note and pharmacy notice for IMP shipments", short: `Spanish delivery notes from ${dayMonthYear(data.spain.case.effective)}`, effective: data.spain.case.effective,
    touching: holding("es", check => /^From 1 Mar 2027/.test(check.requirement)) });
  if (data.israel?.case) items.push({ id: "RC-IL-001", kind: "change", country: "IL", title: data.israel.case.title, short: `Israel-only labels from ${dayMonthYear(data.israel.case.effective)}`, effective: data.israel.case.effective,
    touching: holding("il", check => check.section === "regulatory" && /Israel-only/.test(check.requirement)) });
  for (const permit of data.network?.permits ?? []) {
    const check = results.find(item => item.id === permit.shipment)?.checks.find(item => item.section === "permits" && item.requirement.startsWith("The import approval covers"));
    items.push({ id: permit.id, kind: "permit", country: permit.country, title: `${permit.kind} ${permit.id} for ${permit.shipment}`, short: permit.id, shipment: permit.shipment, validUntil: permit.validUntil,
      result: check?.result ?? "Not checked", touching: check && open(check) ? [permit.shipment] : [] });
  }
  return items.map(item => ({ ...item, hazard: "regulatory", status: item.kind === "change" ? "Waiting for the Regulatory SME; shipments are held against it until then" : `Import check: ${item.result}` }));
}
const dayMonthYear = day => new Date(day + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// The watch team's summaries (one per kind of hazard) and the regulatory items, computed once per data load.
export function watchBriefs(data) {
  if (!data.supplyshield) return { watch: [], regulatory: [] };
  if (!data.watchCache) {
    const regulatory = data.supplyshield.scope.status === "determined" ? regulatoryWatchItems(data) : [];
    data.watchCache = { regulatory, watch: watchSummary(data.supplyshield, { network: data.network, regulatory }) };
  }
  return data.watchCache;
}

// Test an option against the rules and against what operations can deliver. An option is a list of actions.
export function verifyOption(data, shipmentId, actions) {
  const view = shipmentView(data, shipmentId);
  if (!view) throw new Error(`Unknown shipment ${shipmentId}`);
  const { ops, portfolio, spain } = data;
  const overrides = {};
  const notes = [];
  let feasible = true;
  const fail = text => { feasible = false; notes.push("Not feasible: " + text); };
  // A new dispatch date first, so every other action is judged against it.
  const moves = action => ["delay", "advance_dispatch"].includes(action.type);
  const ordered = [...(actions ?? [])].sort((a, b) => moves(b) - moves(a));
  for (const action of ordered) {
    switch (action.type) {
      case "swap_batch": {
        const batches = view.source === "portfolio" ? portfolio.batches : view.source === "israel" ? data.israel.trial.batches : spain.trial.batches;
        const current = batches.find(item => item.id === view.batch);
        const next = batches.find(item => item.id === action.batch_id);
        if (!next) { fail(`batch ${action.batch_id} does not exist.`); break; }
        if (view.source === "portfolio" && next.product_id !== current.product_id) { fail(`batch ${action.batch_id} is a different product.`); break; }
        const stock = ops.depotStock[view.depot]?.[action.batch_id] ?? 0;
        const held = heldByOthers(data, shipmentId, item => item.kind === "stock" && item.depot === view.depot && item.batch === action.batch_id);
        const text = `${view.depot} holds ${stock} kits of ${action.batch_id}${held.kits ? `, ${held.kits} ${held.tentative ? "held for the more urgent plans of" : "already promised to"} ${held.shipments.join(", ")}` : ""}; the shipment needs ${view.kits}.`;
        if (stock - held.kits < (view.kits ?? 0)) fail(text);
        else notes.push(text);
        overrides.batchId = action.batch_id;
        break;
      }
      case "relabel": {
        if (!isDate(action.relabel_date)) { fail(`"${action.relabel_date}" is not a date (YYYY-MM-DD).`); break; }
        const product = view.source === "israel" ? data.israel.trial.product : portfolio.batches.find(item => item.id === (overrides.batchId ?? view.batch))?.product_id;
        const market = { uk: "UK", il: "IL" }[view.countryId];
        if (!market) { fail("relabelling is only modelled for UK and Israeli labels."); break; }
        const approval = ops.labelApprovals[market]?.[product];
        if (approval?.status !== "approved") fail(`the ${market === "UK" ? "updated UK" : "Israel-only"} label for ${product} is ${approval?.status ?? "not on record"}${approval?.expected ? ", expected " + approval.expected : ""}.`);
        const slot = ops.relabel[view.depot]?.slots.find(item => item.date === action.relabel_date);
        if (!slot) fail(`there is no relabelling slot on ${action.relabel_date}.`);
        else if (slot.date < data.today) fail(`the ${slot.date} slot is in the past.`);
        else {
          const held = heldByOthers(data, shipmentId, item => item.kind === "relabel" && item.depot === view.depot && item.date === slot.date);
          if (slot.kits - held.kits < (view.kits ?? 0)) fail(`the ${slot.date} slot takes ${slot.kits} kits${held.kits ? `, ${held.kits} ${held.tentative ? "held for the more urgent plans of" : "already promised to"} ${held.shipments.join(", ")}` : ""}; the shipment needs ${view.kits}.`);
        }
        if (slot) {
          // Kits must be relabelled before the depot starts preparing the shipment.
          const ready = businessDaysAfter(slot.date, ops.relabel[view.depot].turnaroundBusinessDays);
          const prepareBy = prepareByFor(view, overrides.dispatch ?? view.dispatch);
          if (ready > prepareBy) fail(`relabelled kits are ready on ${ready}, after preparation starts on ${prepareBy}.`);
          else notes.push(`Relabelled kits ready on ${ready}, before preparation on ${prepareBy}.`);
        }
        overrides.relabelled = true;
        break;
      }
      case "delay": {
        if (!isDate(action.new_dispatch_date)) { fail(`"${action.new_dispatch_date}" is not a date (YYYY-MM-DD).`); break; }
        const delay = daysBetween(view.dispatch, action.new_dispatch_date);
        if (delay < 0) { fail("the new dispatch date is earlier than planned."); break; }
        if (isWeekend(action.new_dispatch_date)) fail(`${action.new_dispatch_date} is a weekend day.`);
        // Where the planned delivery is known and arrives before the site runs out, the new delivery must too: a later
        // delivery means patients without treatment.
        const runsOut = view.siteStockDays !== null ? addDays(data.today, view.siteStockDays) : null;
        const newDelivery = view.delivery && view.transitBusinessDays ? businessDaysAfter(action.new_dispatch_date, view.transitBusinessDays) : null;
        if (view.siteStockDays !== null && delay >= view.siteStockDays) fail(`the site has ${view.siteStockDays} days of stock; a ${delay}-day delay runs it out.`);
        else if (runsOut && newDelivery && view.delivery <= runsOut && newDelivery > runsOut) fail(`the site runs out on ${runsOut}, but the kits would arrive on ${newDelivery}: ${view.patients ? view.patients + " patients" : "patients"} would go without treatment.`);
        else if (view.siteStockDays !== null) notes.push(`The site has ${view.siteStockDays} days of stock${runsOut ? `, until ${runsOut}` : ""}; the delay is ${delay} days.`);
        overrides.dispatch = action.new_dispatch_date;
        break;
      }
      case "advance_dispatch": {
        if (!isDate(action.new_dispatch_date)) { fail(`"${action.new_dispatch_date}" is not a date (YYYY-MM-DD).`); break; }
        if (action.new_dispatch_date >= view.dispatch) { fail("the new dispatch date is not earlier than planned."); break; }
        if (isWeekend(action.new_dispatch_date)) fail(`${action.new_dispatch_date} is a weekend day.`);
        const prepareBy = prepareByFor(view, action.new_dispatch_date);
        if (prepareBy < data.today) fail(`preparation would have to start on ${prepareBy}, which has passed.`);
        else { const early = daysBetween(action.new_dispatch_date, view.dispatch); notes.push(`Preparation starts on ${prepareBy}; the site receives the kits ${early} day${early === 1 ? "" : "s"} earlier than planned.`); }
        overrides.dispatch = action.new_dispatch_date;
        break;
      }
      case "record_authorisation_route": {
        const record = ops.trialAuthorisations[`${view.trial}|${view.countryId === "uk" ? "GB" : view.countryId.toUpperCase()}`];
        if (!record || record.route !== action.authorisation_route) fail(`the eTMF does not show a ${action.authorisation_route} authorisation for ${view.trial}.`);
        else notes.push(`The eTMF holds ${record.document} (${record.reference}).`);
        overrides.authorisationRoute = action.authorisation_route;
        break;
      }
      case "book_qp_release": {
        if (!isDate(action.qp_date)) { fail(`"${action.qp_date}" is not a date (YYYY-MM-DD).`); break; }
        const plan = ops.qpPlan[overrides.batchId ?? view.batch];
        const prepareBy = prepareByFor(view, overrides.dispatch ?? view.dispatch);
        if (!plan) fail(`there is no QP plan for batch ${view.batch}.`);
        else if (action.qp_date < plan.earliestRelease) fail(`the earliest QP release is ${plan.earliestRelease}.`);
        else {
          const atDepot = businessDaysAfter(action.qp_date, plan.transferBusinessDays ?? 0);
          if (atDepot > prepareBy) fail(`after QP release on ${action.qp_date}, kits reach the depot on ${atDepot}, after preparation starts on ${prepareBy}.`);
          else notes.push(`QP release on ${action.qp_date} at the ${plan.qpSite}; kits reach the depot on ${atDepot}, before preparation on ${prepareBy}. Booked is not released, so the check stays at Confirm until the QP signs.`);
        }
        overrides.qpDate = action.qp_date;
        break;
      }
      case "obtain_pharmacy_code": {
        const contact = ops.siteContacts[view.siteId];
        if (!contact) { fail(`there is no contact on record for ${view.siteId}.`); break; }
        const answer = businessDaysAfter(data.today, contact.typicalResponseBusinessDays);
        const prepareBy = prepareByFor(view, overrides.dispatch ?? view.dispatch);
        if (answer > prepareBy) fail(`${contact.contact} usually answers in ${contact.typicalResponseBusinessDays} business days (${answer}), after preparation on ${prepareBy}.`);
        else notes.push(`Ask ${contact.contact} through the ${contact.channel}; they usually answer in ${contact.typicalResponseBusinessDays} business days (${answer}), before preparation on ${prepareBy}. Until the code arrives, the delivery note check stays at Confirm.`);
        overrides.pharmacyCode = "pending";
        break;
      }
      case "create_label_specification": {
        const product = portfolio.batches.find(item => item.id === (overrides.batchId ?? view.batch))?.product_id;
        const plan = ops.labelApprovals[view.countryId.toUpperCase()]?.[product];
        const ready = plan ? businessDaysAfter(data.today, plan.leadBusinessDays) : null;
        const prepareBy = prepareByFor(view, overrides.dispatch ?? view.dispatch);
        if (!plan) fail(`no ${view.countryId.toUpperCase()} label specification is planned for ${product}.`);
        else if (ready > prepareBy) fail(`the label specification (${plan.status}) takes ${plan.leadBusinessDays} business days, ready ${ready}, after preparation starts on ${prepareBy}.`);
        else notes.push(`Label specification ${plan.status}; ready ${ready}, before preparation on ${prepareBy}.`);
        overrides.labelSpecFor = view.countryId.toUpperCase();
        break;
      }
      case "reroute": {
        // Leave from another qualified airport: same depot, same dispatch day, a different road leg and departure.
        const route = routeFor(data.network, view, { ...overrides, via: action.via });
        const alternative = (data.network?.departure_alternatives ?? []).find(item => item.lane === route?.lane && item.airport === action.via);
        if (!route || route.mode !== "air") { fail("only air routes can leave from another airport."); break; }
        if (!alternative) { fail(`the ${route.carrier} has no qualified departure from ${action.via} on this route.`); break; }
        const airport = data.network.airports?.[action.via];
        notes.push(`Road from the ${view.depot} to ${airport?.name ?? action.via} (about ${alternative.roadHours} h), then the ${route.carrier} flight on ${route.legs.find(leg => leg.kind === "air")?.date} (${alternative.days.join(", ")}; ${alternative.qualified}). Delivery on ${route.delivery}.`);
        overrides.via = action.via;
        break;
      }
      case "proceed":
        notes.push("Proceed as planned, with no change.");
        break;
      default:
        fail(`unknown action ${action.type}.`);
    }
  }
  if (!overrides.batchId) {
    const own = view.batch;
    const stock = ops.depotStock[view.depot]?.[own] ?? 0;
    if (stock < (view.kits ?? 0)) {
      const plan = ops.qpPlan[own];
      if (overrides.qpDate && plan?.kitsAfterRelease >= (view.kits ?? 0)) notes.push(`${plan.kitsAfterRelease} kits of ${own} reach the ${view.depot} after QP release.`);
      else fail(`the ${view.depot} holds ${stock} kits of ${own}; the shipment needs ${view.kits}.`);
    }
  }
  const before = checkShipment(data, shipmentId);
  const after = checkShipment(data, shipmentId, overrides);
  return { shipment: shipmentId, actions, feasible, notes, before: before.result, after: after.result, checks: after.checks,
    passes: feasible && after.result !== "Blocked", reservations: planReservations(data, shipmentId, actions) };
}
