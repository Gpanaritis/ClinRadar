// The Clinical Supply impact assessment, server side: the same deterministic rules as the dashboard
// (scripts/check-server.mjs runs the page's own code beside this module and compares the results).
// Rule versions are named so every stored finding says which rule produced it.

export const RULE_VERSIONS = { uk: "uk_imp_labeling@1", es: "es_shipping_documents@1" };
const UK_EFFECTIVE = "2026-04-28";
const DAY = 86400000;

const countryNames = { GB: "UK", DE: "Germany", FR: "France", IT: "Italy", ES: "Spain", PL: "Poland", NL: "Netherlands", IE: "Ireland", PT: "Portugal", SE: "Sweden", DK: "Denmark", FI: "Finland", BE: "Belgium", US: "United States", CA: "Canada", JP: "Japan", AU: "Australia" };
const partnerNames = { "PARTNER-LOGISTICS-UK-01": "UK logistics partner", "PARTNER-LOGISTICS-EU-01": "EU logistics partner" };
const impactStatuses = { Act: ["Labeling review required", "Insufficient information", "Needs SME assessment"], Check: ["Verify specification", "Potential transition eligibility"] };
export const impactOf = status => (impactStatuses.Act.includes(status) ? "Act" : impactStatuses.Check.includes(status) ? "Check" : "Not affected");

export function businessDaysBefore(day, count) {
  const date = new Date(day + "T00:00:00Z");
  for (let left = count; left > 0;) {
    date.setUTCDate(date.getUTCDate() - 1);
    if (![0, 6].includes(date.getUTCDay())) left--;
  }
  return date.toISOString().slice(0, 10);
}

// The UK labelling rule for one batch: the finished-IMP QP certification date decides, never a shipment date.
export function batchFinding(batch) {
  if (batch.scope !== "UK") return ["Out of scope", "Supplied to " + (countryNames[batch.scope] || batch.scope) + ", no UK linkage."];
  if (!batch.qp) return ["Insufficient information", "Finished-IMP QP certification date is missing."];
  if (!batch.label) return ["Insufficient information", "Label version is missing."];
  if (batch.qp === UK_EFFECTIVE) return ["Needs SME assessment", "QP certification is on the cutoff date."];
  if (batch.qp < UK_EFFECTIVE) return batch.oldRules && batch.intended && batch.legacyEvidence
    ? ["Potential transition eligibility", "Pre-cutoff QP, old-rules cohort, intended use and legacy labeling evidence are present."]
    : ["Insufficient information", "Confirm the old-rules trial, intended use and labeling evidence."];
  if (batch.label === "Legacy") return ["Labeling review required", "Post-cutoff QP certification and a legacy label reference."];
  return ["Verify specification", "Post-cutoff QP certification. Check the approved specification and applicable conditions."];
}

export function createImpact({ portfolio, spain }) {
  const batches = portfolio.batches.map(batch => {
    const studyCountry = portfolio.study_countries.find(item => item.id === batch.study_country_id);
    const label = portfolio.label_specs.find(item => item.id === batch.label_spec_id);
    const qp = batch.finished_imp_qp_certification_date;
    const made = batch.physical_manufacture_date;
    return { id: batch.id, study: batch.study_id, scope: studyCountry.country_code === "GB" ? "UK" : studyCountry.country_code, qp,
      ...(qp && made < UK_EFFECTIVE && qp > UK_EFFECTIVE ? { made } : {}),
      label: label ? (label.legacy_reference ? "Legacy" : "Updated") : undefined,
      oldRules: studyCountry.authorization_cohort === "old_rules", intended: batch.intended_trial_use_confirmed, legacyEvidence: batch.legacy_labeling_evidence_on_file };
  });
  const shipments = portfolio.shipments.map(shipment => {
    const site = portfolio.sites.find(item => item.id === shipment.site_id);
    return { id: shipment.id, batch: shipment.batch_ids[0], destination: countryNames[site.country_code] || site.country_code, date: shipment.planned_dispatch_date,
      partner: partnerNames[shipment.logistics_partner_id] || shipment.logistics_partner_id, leadDays: shipment.preparation_lead_calendar_days, site: site.city, patients: site.patients_on_treatment };
  });
  const assessedBatches = batches.map(batch => {
    const [status, reason] = batchFinding(batch);
    return { ...batch, status, reason, evidenceIds: batch.scope === "UK" ? ["EV-01", "EV-02"] : ["EV-01"] };
  });
  function shipmentFindings() {
    return shipments.map(shipment => {
      const batch = assessedBatches.find(item => item.id === shipment.batch);
      const due = Date.parse(shipment.date) - shipment.leadDays * DAY;
      return { ...shipment, status: impactOf(batch.status), batchStatus: batch.status, preparationDate: new Date(due).toISOString().slice(0, 10), reason: batch.reason };
    });
  }
  function ukImpactSummary() {
    const uk = assessedBatches.filter(batch => batch.scope === "UK");
    const findings = shipmentFindings();
    const count = impact => ({
      batches: uk.filter(batch => impactOf(batch.status) === impact),
      shipments: findings.filter(shipment => shipment.status === impact),
      trials: [...new Set(uk.filter(batch => impactOf(batch.status) === impact).map(batch => batch.study))],
    });
    const act = count("Act");
    const check = count("Check");
    check.trials = check.trials.filter(id => !act.trials.includes(id));
    const lookback = uk.filter(batch => batch.status === "Labeling review required");
    return { act, check, lookback, earliest: [...act.shipments, ...check.shipments].map(item => item.preparationDate).sort()[0] };
  }
  function spainShipmentFindings() {
    if (!spain) return [];
    const { trial, case: rule } = spain;
    return trial.shipments.map(shipment => {
      const site = trial.sites.find(item => item.id === shipment.site);
      const earlier = shipment.dispatch < rule.effective && shipment.delivery <= rule.transitionDeliveredBy;
      const why = earlier ? "Dispatched before 1 Mar 2027 and delivered by 8 Mar 2027, so the earlier procedure applies." :
        shipment.dispatch >= rule.effective ? "Dispatched on or after 1 Mar 2027." : "Dispatched before 1 Mar 2027 but delivered after 8 Mar 2027, so the earlier procedure no longer covers it.";
      const status = earlier ? "Earlier procedure allowed" : site.pharmacyCode ? "New documents needed" : "Insufficient information";
      return { ...shipment, site, status, affected: !earlier, reason: why + (!earlier && !site.pharmacyCode ? " The site has no hospital pharmacy code for the delivery note." : ""),
        prepareBy: businessDaysBefore(shipment.dispatch, trial.standardLeadBusinessDays), noticeBy: businessDaysBefore(shipment.delivery, rule.noticeBusinessDays) };
    });
  }
  function spainImpact() {
    const all = spainShipmentFindings();
    const affected = all.filter(item => item.affected).sort((a, b) => a.prepareBy.localeCompare(b.prepareBy));
    const missing = [...new Map(affected.filter(item => !item.site.pharmacyCode).map(item => [item.site.id, item.site])).values()];
    return { all, affected, first: affected[0], missing, sites: spain?.trial.sites.length ?? 0 };
  }
  // Findings in the shape the database stores, one per assessed object.
  function findings(caseKey) {
    if (caseKey === "uk") {
      return [
        ...assessedBatches.map(batch => ({ objectType: "batch", objectId: batch.id, result: batch.status, impact: impactOf(batch.status), rationale: batch.reason,
          inputs: { scope: batch.scope, qp_date: batch.qp ?? null, label: batch.label ?? null, old_rules: Boolean(batch.oldRules), intended_use: Boolean(batch.intended), legacy_evidence: Boolean(batch.legacyEvidence) },
          evidenceKeys: batch.evidenceIds })),
        ...shipmentFindings().map(shipment => ({ objectType: "shipment", objectId: shipment.id, result: shipment.batchStatus, impact: shipment.status, rationale: shipment.reason,
          inputs: { batch: shipment.batch, dispatch: shipment.date, prepare_by: shipment.preparationDate, lead_days: shipment.leadDays }, evidenceKeys: ["EV-01", "EV-02"] })),
      ];
    }
    return spainShipmentFindings().map(shipment => ({ objectType: "shipment", objectId: shipment.id, result: shipment.status, impact: shipment.affected ? "Act" : "Not affected",
      rationale: shipment.reason, inputs: { dispatch: shipment.dispatch, delivery: shipment.delivery, site: shipment.site.id, pharmacy_code: shipment.site.pharmacyCode ?? null, prepare_by: shipment.prepareBy, notice_by: shipment.noticeBy },
      evidenceKeys: ["EV-ES-01", "EV-ES-02", "EV-ES-03"] }));
  }
  return { assessedBatches, shipmentFindings, ukImpactSummary, spainShipmentFindings, spainImpact, findings };
}
