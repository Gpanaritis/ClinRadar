// Shipment checks and option verification, for the agents and their MCP tools.
// The same rules as the dashboard's Shipment checks page: scripts/check-agent.mjs confirms both give the same results.
// Nothing here uses AI. The agents propose options; these rules decide whether an option passes and is feasible.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function loadData(root) {
  const read = async name => JSON.parse(await readFile(join(root, "demo-data", name), "utf8"));
  const [portfolio, spain, specifications, ops] = await Promise.all([
    read("uk-labelling-portfolio.json"), read("spain-scenario.json"), read("country-specifications.json"), read("supply-operations.json"),
  ]);
  const specs = { ...specifications.countries, es: spain.specification };
  return { portfolio, spain, specs, ops, today: portfolio.assessment_as_of.slice(0, 10), ukEffective: "2026-04-28" };
}

const DAY = 86400000;
export const sectionNames = {
  regulatory: "Regulatory requirements", import: "Import and export rules", permits: "Permits and licences", controlled: "Controlled-drug classifications",
  invoice: "Mandatory invoice statements", ports: "Ports of entry", logistics: "Logistics constraints", carriers: "Approved carriers",
  ior: "Importer of record and consignee", contacts: "Local contacts", notes: "Country-specific notes",
};
const countryOf = code => (code === "GB" ? "uk" : code.toLowerCase());
const addDays = (day, days) => new Date(Date.parse(day) + days * DAY).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);
const isWeekend = day => [0, 6].includes(new Date(day + "T00:00:00Z").getUTCDay());
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
  if (!item) return null;
  const site = spain.trial.sites.find(entry => entry.id === item.site);
  return {
    id: item.id, source: "spain", countryId: "es", siteId: site.id, site: site.city, hospital: site.hospital, dispatch: item.dispatch, delivery: item.delivery,
    leadDays: spain.trial.standardLeadBusinessDays, leadType: "business", batch: item.batch, kits: ops.shipmentKits[item.id] ?? item.kits, carrier: item.carrier,
    depot: "Central EU depot, Belgium", trial: spain.trial.id, patients: null, siteStockDays: null, pharmacyCode: site.pharmacyCode, kind: item.kind,
  };
}

function preparation(view, overrides, today) {
  const dispatch = overrides.dispatch ?? view.dispatch;
  const prepareBy = view.leadType === "business" ? businessDaysBefore(dispatch, view.leadDays) : addDays(dispatch, -view.leadDays);
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
      checks.push({ section: "logistics", requirement: "Dispatched on a working day", result: isWeekend(dispatch) ? "Confirm" : "Pass", detail: `Dispatch on ${dispatch}${isWeekend(dispatch) ? ", a weekend day" : ""}.` });
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
    checks.push({ section: "import", requirement: "The batch's QP release documentation travels with the shipment", result: !qp ? "Missing" : qp > dispatch ? "Fail" : "Pass",
      detail: !qp ? `No QP release is planned yet for batch ${batch?.id}.` : qp > dispatch ? `QP release on ${qp} is after dispatch.` : `QP release on ${qp}, before dispatch.` });
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
  const results = checks.map(item => item.result);
  const result = results.some(item => ["Fail", "Missing", "Decision"].includes(item)) ? "Blocked" : results.includes("Confirm") ? "Confirm" : "Ready";
  return { id: view.id, country: view.countryId, dispatch, prepareBy, result, checks };
}

export function allShipmentChecks(data) {
  const ids = [...data.portfolio.shipments.map(item => item.id), ...data.spain.trial.shipments.map(item => item.id)];
  return ids.map(id => checkShipment(data, id));
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
  const ordered = [...(actions ?? [])].sort((a, b) => (b.type === "delay") - (a.type === "delay"));
  for (const action of ordered) {
    switch (action.type) {
      case "swap_batch": {
        const current = view.source === "portfolio" ? portfolio.batches.find(item => item.id === view.batch) : spain.trial.batches.find(item => item.id === view.batch);
        const next = view.source === "portfolio" ? portfolio.batches.find(item => item.id === action.batch_id) : spain.trial.batches.find(item => item.id === action.batch_id);
        if (!next) { fail(`batch ${action.batch_id} does not exist.`); break; }
        if (view.source === "portfolio" && next.product_id !== current.product_id) { fail(`batch ${action.batch_id} is a different product.`); break; }
        const stock = ops.depotStock[view.depot]?.[action.batch_id] ?? 0;
        if (stock < (view.kits ?? 0)) fail(`${view.depot} holds ${stock} kits of ${action.batch_id}; the shipment needs ${view.kits}.`);
        else notes.push(`${view.depot} holds ${stock} kits of ${action.batch_id}; the shipment needs ${view.kits}.`);
        overrides.batchId = action.batch_id;
        break;
      }
      case "relabel": {
        const product = portfolio.batches.find(item => item.id === (overrides.batchId ?? view.batch))?.product_id;
        const approval = ops.labelApprovals.UK?.[product];
        if (view.countryId !== "uk") { fail("relabelling is only modelled for UK labels."); break; }
        if (approval?.status !== "approved") fail(`the updated UK label for ${product} is ${approval?.status ?? "not on record"}${approval?.expected ? ", expected " + approval.expected : ""}.`);
        const slot = ops.relabel[view.depot]?.slots.find(item => item.date === action.relabel_date);
        if (!slot) fail(`there is no relabelling slot on ${action.relabel_date}.`);
        else if (slot.kits < (view.kits ?? 0)) fail(`the ${action.relabel_date} slot takes ${slot.kits} kits; the shipment needs ${view.kits}.`);
        if (slot) {
          const ready = businessDaysAfter(slot.date, ops.relabel[view.depot].turnaroundBusinessDays);
          const dispatch = overrides.dispatch ?? view.dispatch;
          if (ready > dispatch) fail(`relabelled kits are ready on ${ready}, after dispatch on ${dispatch}.`);
          else notes.push(`Relabelled kits ready on ${ready}, before dispatch on ${dispatch}.`);
        }
        overrides.relabelled = true;
        break;
      }
      case "delay": {
        const delay = daysBetween(view.dispatch, action.new_dispatch_date);
        if (delay < 0) { fail("the new dispatch date is earlier than planned."); break; }
        if (isWeekend(action.new_dispatch_date)) fail(`${action.new_dispatch_date} is a weekend day.`);
        if (view.siteStockDays !== null && delay >= view.siteStockDays) fail(`the site has ${view.siteStockDays} days of stock; a ${delay}-day delay runs it out.`);
        else if (view.siteStockDays !== null) notes.push(`The site has ${view.siteStockDays} days of stock; the delay is ${delay} days.`);
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
        const plan = ops.qpPlan[overrides.batchId ?? view.batch];
        if (!plan) fail(`there is no QP plan for batch ${view.batch}.`);
        else if (action.qp_date < plan.earliestRelease) fail(`the earliest QP release is ${plan.earliestRelease}.`);
        else notes.push(`QP slot available from ${plan.earliestRelease} at the ${plan.qpSite}.`);
        overrides.qpDate = action.qp_date;
        break;
      }
      case "obtain_pharmacy_code": {
        const contact = ops.siteContacts[view.siteId];
        notes.push(contact ? `Ask ${contact.contact} through the ${contact.channel}; they usually answer in ${contact.typicalResponseBusinessDays} business days. Assumes the code arrives in time.` : "No site contact on record.");
        overrides.pharmacyCode = "pending";
        break;
      }
      case "create_label_specification": {
        const product = portfolio.batches.find(item => item.id === view.batch)?.product_id;
        const plan = ops.labelApprovals[view.countryId.toUpperCase()]?.[product];
        const ready = plan ? businessDaysAfter(data.today, plan.leadBusinessDays) : null;
        if (!plan) fail(`no ${view.countryId.toUpperCase()} label specification is planned for ${product}.`);
        else if (ready > (overrides.dispatch ?? view.dispatch)) fail(`the label specification (${plan.status}) takes ${plan.leadBusinessDays} business days, ready ${ready}, after dispatch.`);
        else notes.push(`Label specification ${plan.status}; ready ${ready}.`);
        overrides.labelSpecFor = view.countryId.toUpperCase();
        break;
      }
      case "proceed":
        notes.push("Proceed as planned, with no change.");
        break;
      default:
        fail(`unknown action ${action.type}.`);
    }
  }
  const before = checkShipment(data, shipmentId);
  const after = checkShipment(data, shipmentId, overrides);
  return { shipment: shipmentId, actions, feasible, notes, before: before.result, after: after.result, checks: after.checks,
    passes: feasible && after.result !== "Blocked" };
}
