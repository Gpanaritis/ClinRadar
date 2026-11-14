// Builds the fictional sponsor portfolio for the demo and the expected impact
// of the UK IMP labelling change (in force 28 April 2026) on it.
//
//   node scripts/build-demo-portfolio.mjs
//
// Writes demo-data/uk-labelling-portfolio.json (input, same field names as
// RegChain-AI-Clinical-Trial-Input.example.json) and
// demo-data/uk-labelling-expected-impact.json (what the pipeline should find).
// Every study, site, batch, shipment and patient count here is fictional.
// Edit the tables below, then run the script again.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const AS_OF = "2026-11-14";
const CUTOFF = "2026-04-28";

// id, title, phase, therapy area, status, countries (first is where the sponsor runs it from)
const STUDIES = [
  ["STUDY-001", "UK legacy-cohort study", "III", "Oncology", "active", ["GB"]],
  ["STUDY-002", "Germany-only distribution study", "II", "Immunology", "active", ["DE"]],
  ["STUDY-003", "UK labeling and supply study", "III", "Cardiology", "active", ["GB"]],
  ["STUDY-004", "Multinational asthma maintenance study", "III", "Respiratory", "active", ["GB", "DE", "PL", "ES"]],
  ["STUDY-005", "Rare disease enzyme replacement study", "II", "Rare disease", "active", ["GB", "FR", "IT"]],
  ["STUDY-006", "Paediatric vaccine booster study", "III", "Vaccines", "active", ["GB", "NL"]],
  ["STUDY-007", "Migraine prevention study", "II", "Neurology", "active", ["GB", "IE"]],
  ["STUDY-008", "Type 2 diabetes outcomes study", "III", "Metabolic", "active", ["GB", "US", "CA"]],
  ["STUDY-009", "Rheumatoid arthritis biologic study", "III", "Immunology", "active", ["GB", "DE"]],
  ["STUDY-010", "US oncology dose-finding study", "I", "Oncology", "active", ["US"]],
  ["STUDY-011", "Japan bridging study", "I", "Metabolic", "active", ["JP"]],
  ["STUDY-012", "EU psoriasis study", "III", "Dermatology", "active", ["DE", "FR", "ES"]],
  ["STUDY-013", "Spain and Portugal hepatitis study", "II", "Infectious disease", "active", ["ES", "PT"]],
  ["STUDY-014", "Nordic heart failure study", "III", "Cardiology", "active", ["SE", "DK", "FI"]],
  ["STUDY-015", "US and Canada obesity study", "II", "Metabolic", "active", ["US", "CA"]],
  ["STUDY-016", "France and Belgium lupus study", "II", "Immunology", "active", ["FR", "BE"]],
  ["STUDY-017", "Australia chronic pain study", "II", "Neurology", "active", ["AU"]],
  ["STUDY-018", "UK oncology follow-up study, supply closed", "III", "Oncology", "completed", ["GB"]],
];

// UK authorisation cohort per study: old_rules (authorised under the earlier rules), new_rules or unknown.
const UK_COHORT = {
  "STUDY-001": "old_rules", "STUDY-003": "old_rules", "STUDY-004": "unknown", "STUDY-005": "new_rules",
  "STUDY-006": "old_rules", "STUDY-007": "new_rules", "STUDY-008": "new_rules", "STUDY-009": "old_rules",
  "STUDY-018": "old_rules",
};

// site id, study, country, fictional city, patients currently on treatment
const SITES = [
  ["SITE-GB-01", "STUDY-003", "GB", "London", 14],
  ["SITE-GB-02", "STUDY-001", "GB", "Manchester", 9],
  ["SITE-GB-03", "STUDY-001", "GB", "Glasgow", 7],
  ["SITE-GB-04", "STUDY-004", "GB", "Birmingham", 22],
  ["SITE-GB-05", "STUDY-004", "GB", "Leeds", 17],
  ["SITE-GB-06", "STUDY-005", "GB", "Cambridge", 6],
  ["SITE-GB-07", "STUDY-006", "GB", "Bristol", 40],
  ["SITE-GB-08", "STUDY-007", "GB", "Edinburgh", 25],
  ["SITE-GB-09", "STUDY-008", "GB", "Newcastle", 31],
  ["SITE-GB-10", "STUDY-009", "GB", "Oxford", 19],
  ["SITE-GB-11", "STUDY-018", "GB", "Cardiff", 0],
  ["SITE-DE-01", "STUDY-002", "DE", "Berlin", 12],
  ["SITE-DE-02", "STUDY-004", "DE", "Munich", 20],
  ["SITE-PL-01", "STUDY-004", "PL", "Warsaw", 15],
  ["SITE-ES-01", "STUDY-004", "ES", "Madrid", 11],
  ["SITE-FR-01", "STUDY-005", "FR", "Lyon", 5],
  ["SITE-IT-01", "STUDY-005", "IT", "Milan", 4],
  ["SITE-NL-01", "STUDY-006", "NL", "Utrecht", 35],
  ["SITE-IE-01", "STUDY-007", "IE", "Dublin", 13],
  ["SITE-US-01", "STUDY-008", "US", "Boston", 44],
  ["SITE-CA-01", "STUDY-008", "CA", "Toronto", 18],
  ["SITE-DE-03", "STUDY-009", "DE", "Hamburg", 16],
  ["SITE-US-02", "STUDY-010", "US", "Houston", 12],
  ["SITE-JP-01", "STUDY-011", "JP", "Osaka", 10],
  ["SITE-DE-04", "STUDY-012", "DE", "Frankfurt", 21],
  ["SITE-ES-02", "STUDY-013", "ES", "Seville", 14],
  ["SITE-SE-01", "STUDY-014", "SE", "Gothenburg", 27],
  ["SITE-US-03", "STUDY-015", "US", "Chicago", 33],
  ["SITE-FR-02", "STUDY-016", "FR", "Lille", 8],
  ["SITE-AU-01", "STUDY-017", "AU", "Melbourne", 16],
];

// batch, study, destination country, physical manufacture, finished-IMP QP date (null = missing),
// label version ("legacy", "updated" or null = unknown), intended trial use confirmed, legacy labelling evidence on file
const BATCHES = [
  ["A-101", "STUDY-001", "GB", "2026-04-10", "2026-04-20", "legacy", true, true],
  ["B-102", "STUDY-003", "GB", "2026-04-20", "2026-05-05", "legacy", true, false],
  ["C-103", "STUDY-003", "GB", "2026-04-24", "2026-05-05", "updated", true, false],
  ["D-104", "STUDY-001", "GB", "2026-05-12", null, "legacy", true, false],
  ["E-105", "STUDY-002", "DE", "2026-04-22", "2026-05-05", "legacy", true, false],
  ["F-106", "STUDY-003", "GB", "2026-04-15", "2026-04-28", "legacy", true, true],
  ["G-107", "STUDY-001", "GB", "2026-05-29", "2026-06-10", "legacy", true, false],
  ["H-108", "STUDY-001", "GB", "2026-08-20", "2026-09-02", "updated", true, false],
  ["J-201", "STUDY-004", "GB", "2026-03-18", "2026-03-30", "legacy", true, true],
  ["J-202", "STUDY-004", "GB", "2026-07-01", "2026-07-14", "legacy", true, false],
  ["J-203", "STUDY-004", "GB", "2026-09-17", "2026-10-01", "updated", true, false],
  ["J-204", "STUDY-004", "DE", "2026-07-01", "2026-07-14", "legacy", true, false],
  ["K-301", "STUDY-005", "GB", "2026-05-08", "2026-05-20", "legacy", true, false],
  ["K-302", "STUDY-005", "GB", "2026-07-30", "2026-08-11", "legacy", true, false],
  ["K-303", "STUDY-005", "FR", "2026-07-30", "2026-08-11", "legacy", true, false],
  ["L-401", "STUDY-006", "GB", "2026-02-02", "2026-02-15", "legacy", true, true],
  ["L-402", "STUDY-006", "GB", "2026-04-14", "2026-04-27", "legacy", false, true],
  ["L-403", "STUDY-006", "GB", "2026-06-17", "2026-06-30", "updated", true, false],
  ["M-501", "STUDY-007", "GB", "2026-09-04", "2026-09-18", "updated", true, false],
  ["M-502", "STUDY-007", "GB", "2026-10-06", "2026-10-20", "updated", true, false],
  ["N-601", "STUDY-008", "GB", "2026-05-14", "2026-05-28", "legacy", true, false],
  ["N-602", "STUDY-008", "GB", "2026-08-11", "2026-08-25", null, true, false],
  ["N-603", "STUDY-008", "US", "2026-08-11", "2026-08-25", "legacy", true, false],
  ["P-701", "STUDY-009", "GB", "2026-03-20", "2026-04-01", "legacy", true, true],
  ["P-702", "STUDY-009", "GB", "2026-06-23", "2026-07-07", "legacy", true, false],
  ["R-801", "STUDY-010", "US", "2026-09-01", "2026-09-15", "legacy", true, false],
  ["R-802", "STUDY-011", "JP", "2026-08-05", "2026-08-19", "legacy", true, false],
  ["R-803", "STUDY-012", "DE", "2026-07-20", "2026-08-03", "legacy", true, false],
  ["R-804", "STUDY-013", "ES", "2026-06-01", "2026-06-15", "legacy", true, false],
  ["R-805", "STUDY-014", "SE", "2026-09-09", "2026-09-23", "legacy", true, false],
  ["R-806", "STUDY-015", "US", "2026-10-05", "2026-10-19", "legacy", true, false],
  ["R-807", "STUDY-016", "FR", "2026-08-26", "2026-09-09", "legacy", true, false],
  ["R-808", "STUDY-017", "AU", "2026-07-08", "2026-07-22", "legacy", true, false],
];

// shipment, batch, site, planned dispatch, preparation lead in calendar days
const SHIPMENTS = [
  ["SHP-01", "B-102", "SITE-GB-01", "2026-11-22", 5],
  ["SHP-02", "D-104", "SITE-GB-02", "2026-11-25", 5],
  ["SHP-03", "E-105", "SITE-DE-01", "2026-11-23", 5],
  ["SHP-04", "J-202", "SITE-GB-04", "2026-11-19", 5],
  ["SHP-05", "K-301", "SITE-GB-06", "2026-11-27", 5],
  ["SHP-06", "N-601", "SITE-GB-09", "2026-12-02", 5],
  ["SHP-07", "L-403", "SITE-GB-07", "2026-11-24", 5],
  ["SHP-08", "P-702", "SITE-GB-10", "2026-12-04", 5],
  ["SHP-09", "M-501", "SITE-GB-08", "2026-12-08", 5],
  ["SHP-10", "J-204", "SITE-DE-02", "2026-11-26", 5],
];

const JURISDICTION = { GB: "UK", DE: "EU", FR: "EU", IT: "EU", ES: "EU", PL: "EU", NL: "EU", IE: "EU", PT: "EU", SE: "EU", DK: "EU", FI: "EU", BE: "EU", US: "US", CA: "CA", JP: "JP", AU: "AU" };

const addDays = (day, days) => new Date(Date.parse(day) + days * 86400000).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

function buildPortfolio() {
  const studyCountries = STUDIES.flatMap(([id, , , , , countries]) =>
    countries.map(code => ({
      id: `${id}-${code}`,
      study_id: id,
      country_code: code,
      jurisdiction: JURISDICTION[code],
      authorization_cohort: code === "GB" ? UK_COHORT[id] : "not_applicable",
      site_ids: SITES.filter(([, study, country]) => study === id && country === code).map(([site]) => site),
      source_ref: "SRC-CTMS",
    })),
  );
  const products = STUDIES.map(([id]) => ({ id: `IMP-${id.slice(-3)}`, study_id: id, category: "finished_IMP", role: "investigational", source_ref: "SRC-SUPPLY" }));
  const labelSpecs = products.flatMap(product => [
    { id: `${product.id}-UK-v1`, product_id: product.id, version: "1", jurisdiction: "UK", legacy_reference: true, source_ref: "SRC-SUPPLY" },
    { id: `${product.id}-UK-v2`, product_id: product.id, version: "2", jurisdiction: "UK", legacy_reference: false, source_ref: "SRC-SUPPLY" },
  ]);
  const batches = BATCHES.map(([id, study, country, made, qp, label, intendedUse, legacyEvidence]) => {
    const product = `IMP-${study.slice(-3)}`;
    return {
      id,
      study_id: study,
      study_country_id: `${study}-${country}`,
      product_id: product,
      label_spec_id: country !== "GB" ? null : label === "legacy" ? `${product}-UK-v1` : label === "updated" ? `${product}-UK-v2` : null,
      physical_manufacture_date: made,
      finished_imp_qp_certification_date: qp,
      intended_trial_use_confirmed: intendedUse,
      legacy_labeling_evidence_on_file: legacyEvidence,
      source_ref: "SRC-SUPPLY",
    };
  });
  const shipments = SHIPMENTS.map(([id, batch, site, dispatch, lead]) => {
    const record = BATCHES.find(row => row[0] === batch);
    const country = SITES.find(row => row[0] === site)[2];
    return {
      id,
      batch_ids: [batch],
      site_id: site,
      study_country_id: `${record[1]}-${country}`,
      destination_jurisdiction: JURISDICTION[country],
      planned_dispatch_date: dispatch,
      preparation_lead_calendar_days: lead,
      logistics_partner_id: country === "GB" ? "PARTNER-LOGISTICS-UK-01" : "PARTNER-LOGISTICS-EU-01",
      source_ref: "SRC-SUPPLY",
    };
  });
  return {
    schema_version: "0.1",
    synthetic_operational_data: true,
    note: "Fictional sponsor portfolio for the RegChain demo. No real studies, sites, products or patients.",
    assessment_as_of: `${AS_OF}T10:00:00Z`,
    studies: STUDIES.map(([id, title, phase, area, status, countries]) => ({ id, title, phase, therapy_area: area, status, countries, source_ref: "SRC-CTMS" })),
    study_countries: studyCountries,
    sites: SITES.map(([id, study, country, city, patients]) => ({ id, study_id: study, country_code: country, city, patients_on_treatment: patients, source_ref: "SRC-CTMS" })),
    products,
    label_specs: labelSpecs,
    batches,
    shipments,
    partners: [
      { id: "PARTNER-PACKAGING-01", role: "packaging_and_labeling" },
      { id: "PARTNER-LOGISTICS-UK-01", role: "logistics_uk" },
      { id: "PARTNER-LOGISTICS-EU-01", role: "logistics_eu" },
    ],
    regulatory_case: {
      id: "RC-UK-001",
      jurisdiction: "UK",
      requirement_record_id: "GB/IMP_LABELING",
      effective_date: CUTOFF,
      rule_event: "finished_imp_qp_certification_date",
      evidence_source_ids: ["reg46-before", "reg46-after", "sch14-para6", "mhra-labelling-transition"],
    },
    source_records: [
      { id: "SRC-CTMS", source_system: "CTMS demo", record_version: "1", observed_at: `${AS_OF}T09:00:00Z` },
      { id: "SRC-SUPPLY", source_system: "Clinical supply demo", record_version: "1", observed_at: `${AS_OF}T09:00:00Z` },
    ],
  };
}

// The UK rule from the master specification, section 7.2, steps 4 to 6.
function triage(batch, portfolio) {
  const studyCountry = portfolio.study_countries.find(item => item.id === batch.study_country_id);
  if (studyCountry.jurisdiction !== "UK") {
    return { code: "out_of_scope", reason: `Supplied to ${studyCountry.country_code}, no UK linkage.`, missing_facts: [] };
  }
  const label = portfolio.label_specs.find(item => item.id === batch.label_spec_id);
  const qp = batch.finished_imp_qp_certification_date;
  const missing = [];
  if (!qp) missing.push("finished_imp_qp_certification_date");
  if (!label) missing.push("label_spec");
  if (missing.length) return { code: "needs_review", reason: `Missing ${missing.join(" and ")}.`, missing_facts: missing };
  if (qp === CUTOFF) return { code: "needs_review", reason: "QP certification falls on the cutoff day. Escalate to the SME.", missing_facts: [] };
  if (qp < CUTOFF) {
    const conditions = [];
    if (studyCountry.authorization_cohort !== "old_rules") conditions.push("old_rules_cohort");
    if (!batch.intended_trial_use_confirmed) conditions.push("intended_trial_use");
    if (!label.legacy_reference || !batch.legacy_labeling_evidence_on_file) conditions.push("legacy_labeling_evidence");
    return conditions.length
      ? { code: "needs_review", reason: `Pre-cutoff QP date, but transition conditions are not confirmed: ${conditions.join(", ")}.`, missing_facts: conditions }
      : { code: "potential_transition_eligibility", reason: "Pre-cutoff QP date, old-rules cohort, intended trial use and legacy labelling evidence are on file. SME confirms the Schedule 14 conditions.", missing_facts: [] };
  }
  return label.legacy_reference
    ? { code: "labeling_review_required", reason: `QP certified ${qp}, after the cutoff, with a legacy label.${batch.physical_manufacture_date < CUTOFF ? " Manufactured before the cutoff, but the QP date decides." : ""}`, missing_facts: [] }
    : { code: "verify_specification_and_approvals", reason: `QP certified ${qp}, after the cutoff, with the updated label. Verify the approved specification.`, missing_facts: [] };
}

const NEEDS_ACTION = ["labeling_review_required", "needs_review"];

function buildImpact(portfolio) {
  const batches = portfolio.batches.map(batch => ({ batch_id: batch.id, study_id: batch.study_id, study_country_id: batch.study_country_id, finished_imp_qp_certification_date: batch.finished_imp_qp_certification_date, ...triage(batch, portfolio) }));
  const codeOf = id => batches.find(item => item.batch_id === id).code;
  const shipments = portfolio.shipments.map(shipment => {
    const codes = shipment.batch_ids.map(codeOf);
    const preparation = addDays(shipment.planned_dispatch_date, -shipment.preparation_lead_calendar_days);
    const site = portfolio.sites.find(item => item.id === shipment.site_id);
    const status = codes.some(code => NEEDS_ACTION.includes(code))
      ? "action_before_dispatch"
      : codes.includes("verify_specification_and_approvals")
        ? "check_before_dispatch"
        : codes.includes("potential_transition_eligibility")
          ? "confirm_transition_conditions"
          : "not_affected";
    return {
      shipment_id: shipment.id,
      batch_ids: shipment.batch_ids,
      site_id: shipment.site_id,
      planned_dispatch_date: shipment.planned_dispatch_date,
      preparation_target_date: preparation,
      days_to_preparation_target: daysBetween(AS_OF, preparation),
      patients_on_treatment_at_site: site.patients_on_treatment,
      status,
    };
  });
  const studies = portfolio.studies.map(study => {
    const own = batches.filter(item => item.study_id === study.id);
    const counts = Object.fromEntries(["labeling_review_required", "needs_review", "verify_specification_and_approvals", "potential_transition_eligibility", "out_of_scope"].map(code => [code, own.filter(item => item.code === code).length]));
    const ukSites = portfolio.sites.filter(site => site.study_id === study.id && site.country_code === "GB");
    return {
      study_id: study.id,
      title: study.title,
      status: study.status,
      has_uk_sites: ukSites.length > 0,
      uk_batches: own.filter(item => item.code !== "out_of_scope").length,
      batch_counts: counts,
      needs_action: own.some(item => NEEDS_ACTION.includes(item.code)),
      verification_only: !own.some(item => NEEDS_ACTION.includes(item.code)) && counts.verify_specification_and_approvals > 0,
    };
  });
  const atRisk = shipments.filter(item => item.status === "action_before_dispatch");
  const count = code => batches.filter(item => item.code === code).length;
  return {
    case_id: portfolio.regulatory_case.id,
    requirement_record_id: portfolio.regulatory_case.requirement_record_id,
    effective_date: CUTOFF,
    assessment_as_of: portfolio.assessment_as_of,
    totals: {
      studies_checked: studies.length,
      studies_with_uk_sites: studies.filter(item => item.has_uk_sites).length,
      active_uk_studies_with_supply: studies.filter(item => item.uk_batches > 0).length,
      studies_needing_action: studies.filter(item => item.needs_action).length,
      studies_needing_verification_only: studies.filter(item => item.verification_only).length,
      batches_checked: batches.length,
      uk_batches: batches.filter(item => item.code !== "out_of_scope").length,
      labeling_review_required: count("labeling_review_required"),
      needs_review: count("needs_review"),
      verify_specification_and_approvals: count("verify_specification_and_approvals"),
      potential_transition_eligibility: count("potential_transition_eligibility"),
      out_of_scope: count("out_of_scope"),
      shipments_checked: shipments.length,
      uk_shipments_needing_action: atRisk.length,
      earliest_preparation_target: atRisk.map(item => item.preparation_target_date).sort()[0] ?? null,
      patients_at_sites_awaiting_those_shipments: atRisk.reduce((sum, item) => sum + item.patients_on_treatment_at_site, 0),
    },
    studies,
    batches,
    shipments,
  };
}

const portfolio = buildPortfolio();
const impact = buildImpact(portfolio);
const out = join(root, "demo-data");
await mkdir(out, { recursive: true });
await writeFile(join(out, "uk-labelling-portfolio.json"), JSON.stringify(portfolio, null, 2) + "\n");
await writeFile(join(out, "uk-labelling-expected-impact.json"), JSON.stringify(impact, null, 2) + "\n");
console.log(JSON.stringify(impact.totals, null, 2));
console.log(impact.studies.filter(item => item.uk_batches > 0).map(item => `${item.study_id} ${item.needs_action ? "ACTION" : item.verification_only ? "verify" : "-"} ${JSON.stringify(item.batch_counts)}`).join("\n"));
console.log(impact.shipments.map(item => `${item.shipment_id} ${item.batch_ids} ${item.status} prep ${item.preparation_target_date} (${item.days_to_preparation_target}d) patients ${item.patients_on_treatment_at_site}`).join("\n"));
