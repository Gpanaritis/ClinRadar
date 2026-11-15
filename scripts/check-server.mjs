// Checks the server side without network or AI calls: the database and its audit trail, the case workflow against
// the dashboard's own code, the regulation pipeline on synthetic sources, and the /v1 API with its rules.
// Usage: node scripts/check-server.mjs   (everything runs in temporary folders)

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(join(tmpdir(), "regchain-server-check-"));
process.env.REGCHAIN_DATA_DIR = join(temp, "data");
process.env.REGCHAIN_CACHE_DIR = join(temp, "cache");
await import("node:fs/promises").then(fs => fs.mkdir(process.env.REGCHAIN_CACHE_DIR, { recursive: true }));

const { openDatabase, appendAudit, verifyAudit, closeDatabase } = await import("../regchain-ai/db.mjs");
const { createCaseModel, ensureCases, returnDueDeferrals, caseRow } = await import("../regchain-ai/cases.mjs");
const { runReplay } = await import("../regchain-ai/pipeline.mjs");
const { createApi } = await import("../regchain-ai/api.mjs");
const { loadData } = await import("../regchain-ai/rules.mjs");

// ---------- 1. Database and audit trail ----------
{
  const db = openDatabase(root, { path: ":memory:" });
  appendAudit(db, { actor: "test", type: "a", subjectType: "x", subjectId: "1" });
  appendAudit(db, { actor: "test", type: "b", subjectType: "x", subjectId: "1" });
  assert.equal(verifyAudit(db).ok, true);
  assert.throws(() => db.prepare("UPDATE audit_entry SET detail = 'changed' WHERE seq = 1").run(), /append-only/);
  assert.throws(() => db.prepare("DELETE FROM audit_entry WHERE seq = 1").run(), /append-only/);
  // Someone with direct file access drops the guard and edits an entry: the chain shows where.
  db.exec("DROP TRIGGER audit_entry_no_update");
  db.prepare("UPDATE audit_entry SET detail = 'changed' WHERE seq = 1").run();
  assert.deepEqual({ ok: verifyAudit(db).ok, brokenAt: verifyAudit(db).brokenAt }, { ok: false, brokenAt: 1 });
  closeDatabase(root, { path: ":memory:" });
  console.log("ok  database: migrations run, audit entries cannot be changed or deleted, and a tampered entry breaks the hash chain");
}

// ---------- 1b. Approvals from before the database are imported once ----------
{
  const { readdir } = await import("node:fs/promises");
  const { readApprovals } = await import("../regchain-ai/rules.mjs");
  const legacy = { "SHP-LEGACY-1": { option: "escalate", title: "Escalation", actions: [], by: "Former Approver · Clinical Supply", at: "2026-11-10T09:00:00.000Z", runAt: "2026-11-10T08:00:00.000Z", mode: "scripted", drafts: [] } };
  await writeFile(join(process.env.REGCHAIN_CACHE_DIR, "agent-approvals.json"), JSON.stringify(legacy));
  const approvals = await readApprovals(root);
  assert.deepEqual([approvals["SHP-LEGACY-1"]?.by, approvals["SHP-LEGACY-1"]?.at], ["Former Approver · Clinical Supply", "2026-11-10T09:00:00.000Z"]);
  const files = await readdir(process.env.REGCHAIN_CACHE_DIR);
  assert.ok(!files.includes("agent-approvals.json") && files.some(name => /^agent-approvals\.imported-\d+\.json$/.test(name)), "the old file is renamed, not deleted");
  await readApprovals(root);
  const db = openDatabase(root);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_entry WHERE type = 'approval.imported'").get().n, 1, "imported once, with an audit entry");
  db.prepare("DELETE FROM agent_approval WHERE shipment_id = 'SHP-LEGACY-1'").run();
  console.log("ok  upgrade: approvals kept in agent-approvals.json by earlier versions are imported once, audited, and the file is kept under a new name");
}

// ---------- 2. The workflow matches the dashboard's own code ----------
const html = await readFile(join(root, "RegChain-AI-Dashboard.html"), "utf8");
const grab = open => { const start = html.indexOf(open) + open.length; return html.slice(start, html.indexOf("</script>", start)); };
const stub = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => "" : stub()), set: () => true, apply: () => stub() });
const elements = Object.fromEntries(["portfolio-data", "spain-data", "specifications-data"].map(id => [id, { textContent: grab(`<script id="${id}" type="application/json">`) }]));
const pageContext = { console, Intl, Date, Math, JSON, Object, Array, Set, Map, String, Number, Boolean, Error, RegExp, structuredClone, URL, URLSearchParams,
  document: { getElementById: id => elements[id] ?? stub(), addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} }, location: { protocol: "file:", search: "" }, window: {} };
vm.createContext(pageContext);
vm.runInContext(grab('<script id="dashboard-data">') + "\n" + grab('<script id="workflow-model">') + "\n;globalThis.__page={initialWorkflow,workflowStep,adoptAiDraft,ukImpactSummary,spainImpact};", pageContext);
const page = pageContext.__page;
const data = await loadData(root);
const model = createCaseModel(data);
const plain = value => JSON.parse(JSON.stringify(value));
assert.deepEqual(plain(model.impact.ukImpactSummary()), plain(page.ukImpactSummary()), "UK impact");
assert.deepEqual(plain(model.impact.spainImpact()), plain(page.spainImpact()), "Spain impact");
const passing = { at: "2026-11-14T08:00:00.000Z", model: "claude-opus-5-5", verification: { verified: true, checks: [{ ok: true }, { ok: true }] },
  draft: { proposedRequirement: "Check each batch's QP date before dispatch.", requirementStatement: "Amended Part 7 applies from 28 April 2026.", scope: "UK IMP batches",
    transition: { conditions: ["Pre-cutoff QP date"] }, sectionEdits: [{ section: "invoice", replaces: "", text: "A delivery note in Spanish." }] } };
const sequences = {
  "approve, then Quality to closure": ["uk", [["reviewer", { action: "approve", reason: "Evidence checked", override: true, today: "2026-11-14" }], ["owner", { action: "ack" }],
    ["owner", { action: "implement", reason: "QMS-REF-1" }], ["verifier", { action: "return", reason: "Missing SOP" }], ["owner", { action: "implement", reason: "QMS-REF-2" }], ["verifier", { action: "verify", reason: "Evidence complete" }]]],
  "edit and approve": ["uk", [["reviewer", { action: "edit", reason: "Clearer wording", instruction: "Record each batch's QP date and label.", override: true, today: "2026-11-14" }]]],
  "reject, resume, investigate, resume, defer": ["uk", [["reviewer", { action: "reject", reason: "Out of scope" }], ["reviewer", { action: "resume", reason: "New evidence" }],
    ["reviewer", { action: "investigate", reason: "Check the cohort" }], ["reviewer", { action: "resume", reason: "Cohort confirmed" }], ["reviewer", { action: "defer", reason: "Wait for MHRA", reviewOn: "2026-12-01", today: "2026-11-14" }]]],
  "Spain: AI draft adopted, approved and acknowledged": ["es", [["ai", passing], ["reviewer", { action: "approve", reason: "Matches the note", today: "2026-11-14" }], ["owner", { action: "ack" }]]],
  "refused steps": ["uk", [["viewer", { action: "approve", reason: "x" }], ["reviewer", { action: "approve", reason: "" }], ["owner", { action: "ack" }]]],
};
for (const [name, [key, steps]] of Object.entries(sequences)) {
  let pageState = page.initialWorkflow(key);
  let serverState = model.initialWorkflow(key);
  steps.forEach(([role, command], index) => {
    const now = `2026-11-14T10:${String(index).padStart(2, "0")}:00.000Z`;
    if (role === "ai") {
      assert.equal(page.adoptAiDraft(pageState, command, now), model.adoptAiDraft(serverState, command, now));
      return;
    }
    const full = { revision: serverState.revision, ...command };
    let pageError = null;
    let serverError = null;
    try { page.workflowStep(pageState, { ...full }, role, now); } catch (error) { pageError = error.message; }
    try { model.workflowStep(serverState, { ...full }, role, now); } catch (error) { serverError = error.message; }
    assert.equal(serverError, pageError, `${name}, step ${index + 1}: same refusal`);
    assert.deepEqual(plain(serverState), plain(pageState), `${name}, step ${index + 1}: same state`);
  });
}
console.log(`ok  workflow: ${Object.keys(sequences).length} sequences give identical states and refusals in the page and on the server; UK and Spain impact match`);

// The acceptance answer key (demo-data/uk-labelling-expected-impact.json): every batch and shipment, and the totals.
{
  const key = JSON.parse(await readFile(join(root, "demo-data", "uk-labelling-expected-impact.json"), "utf8"));
  const code = { "Labeling review required": "labeling_review_required", "Insufficient information": "needs_review", "Needs SME assessment": "needs_review",
    "Verify specification": "verify_specification_and_approvals", "Potential transition eligibility": "potential_transition_eligibility", "Out of scope": "out_of_scope" };
  const status = { Act: "action_before_dispatch", Check: "check_before_dispatch", "Not affected": "not_affected" };
  const findings = model.impact.findings("uk");
  for (const batch of key.batches) assert.equal(code[findings.find(item => item.objectType === "batch" && item.objectId === batch.batch_id)?.result], batch.code, batch.batch_id);
  for (const shipment of key.shipments) {
    const found = findings.find(item => item.objectType === "shipment" && item.objectId === shipment.shipment_id);
    assert.equal(status[found.impact], shipment.status, shipment.shipment_id);
    assert.equal(found.inputs.prepare_by, shipment.preparation_target_date, shipment.shipment_id + " preparation date");
  }
  const summary = model.impact.ukImpactSummary();
  assert.equal(summary.act.trials.length, key.totals.studies_needing_action);
  assert.equal(summary.act.shipments.filter(item => item.destination === "UK").length, key.totals.uk_shipments_needing_action);
  assert.equal(summary.earliest, key.totals.earliest_preparation_target);
  assert.equal(summary.act.shipments.filter(item => item.destination === "UK").reduce((sum, item) => sum + item.patients, 0), key.totals.patients_at_sites_awaiting_those_shipments);
  console.log(`ok  answer key: ${key.batches.length} batches and ${key.shipments.length} shipments match; ${key.totals.studies_needing_action} trials and ${key.totals.uk_shipments_needing_action} UK shipments need action, earliest ${key.totals.earliest_preparation_target}, ${key.totals.patients_at_sites_awaiting_those_shipments} patients`);
}

// ---------- 3. The regulation pipeline on synthetic sources ----------
const cache = process.env.REGCHAIN_CACHE_DIR;
const sourceFile = (id, text) => writeFile(join(cache, `source-${id}.json`), JSON.stringify({ id, role: id.includes("before") ? "before" : id.includes("after") ? "after" : "supporting", title: id, authority: "UK Legislation",
  kind: id.startsWith("mhra") ? "govuk" : "legislation", url: "https://example.org/" + id, text, validFrom: "2026-04-28", hash: "x", retrievedAt: "2026-11-14T08:00:00Z" }));
await sourceFile("reg46-before", "46. Labelling of investigational medicinal products under Article 15.");
await sourceFile("reg46-after", "46. Labelling of investigational medicinal products under Part 7 as amended.");
await sourceFile("sch14-para6", "6. An IMP may be labelled in accordance with regulation 46 of the old rules where the conditions are met.");
await sourceFile("mhra-labelling-transition", "The manufacturing date is the date of QP batch certification of the finished IMP.");
await writeFile(join(cache, "analysis-latest.json"), JSON.stringify(passing));
{
  const db = openDatabase(root);
  ensureCases(db, model);
  const first = await runReplay(db, model, root, { fixtureSet: "uk-labelling", extractionMode: "recorded" });
  assert.equal(first.comparison_status, "material_change");
  assert.deepEqual(first.evidence.map(item => item.found), [true, true], "both evidence passages resolve in the stored text");
  assert.equal(first.extraction.status, "verified");
  assert.equal(first.extraction.adopted, true);
  const second = await runReplay(db, model, root, { fixtureSet: "uk-labelling", extractionMode: "recorded" });
  assert.deepEqual(second.case_ids, first.case_ids, "identical inputs reuse the case");
  const detected = db.prepare("SELECT COUNT(*) AS n FROM outbox_event WHERE type = 'regulatory_change.detected'").get().n;
  assert.equal(detected, 1, "an identical replay does not detect the change again");
  assert.equal(Object.values(second.source_versions).every(item => item.new === false), true, "source versions are stored once per hash");
  await sourceFile("reg46-after", "46.  Labelling of investigational medicinal products   under Article 15.");
  const cosmetic = await runReplay(db, model, root, { fixtureSet: "uk-labelling", extractionMode: "recorded" });
  assert.equal(cosmetic.comparison_status, "no_relevant_change", "a whitespace-only change is not material");
  const impact = db.prepare("SELECT summary FROM impact_assessment WHERE id = ?").get(first.assessment_id);
  assert.equal(JSON.parse(impact.summary).objects, 43);
  console.log("ok  pipeline: material change detected once, identical inputs reuse the case, whitespace-only change ignored, evidence resolved, 43 objects assessed");
  closeDatabase(root);
}
await rm(join(temp, "data"), { recursive: true, force: true });
await sourceFile("reg46-after", "46. Labelling of investigational medicinal products under Part 7 as amended.");

// ---------- 3b. Settings: the monitoring schedule and connection requests, kept in the audit trail ----------
{
  const settings = await import("../regchain-ai/settings.mjs");
  const refused = (work, status, text) => assert.throws(work, error => error.statusCode === status && (!text || error.message.includes(text)));
  const sme = { by: "A. Novak · Regulatory SME", role: "reviewer" };
  const supply = { by: "P. Laine · Clinical Supply", role: "viewer" };
  const quality = { by: "M. Okafor · Quality owner", role: "owner" };
  assert.deepEqual(settings.readSettings(root).monitoring, settings.MONITORING_DEFAULTS, "the defaults until someone changes the schedule");
  refused(() => settings.saveMonitoring(root, { frequency: "weekly" }, supply), 403);
  refused(() => settings.saveMonitoring(root, { time: "25:00" }, sme), 422, "HH:MM");
  refused(() => settings.saveMonitoring(root, { frequency: "hourly" }, sme), 422);
  const saved = settings.saveMonitoring(root, { frequency: "weekly", weekday: 3, time: "07:30", onBlocked: "plan" }, sme);
  assert.equal(saved.monitoring.weekday, 3);
  assert.equal(saved.changed.by, sme.by);
  assert.equal(settings.saveMonitoring(root, saved.monitoring, quality).log.length, 1, "saving the same schedule again records nothing");
  refused(() => settings.requestConnection(root, { name: "Courier", holds: "Delivery status", access: "write", owner: "Logistics" }, supply), 422, "read-only or draft-only");
  refused(() => settings.requestConnection(root, { name: "Courier", holds: "Delivery status", access: "read-only", owner: "Logistics", address: "http://plain" }, supply), 422, "https://");
  const asked = settings.requestConnection(root, { name: "Courier tracking", holds: "Delivery status", access: "read-only", owner: "Logistics" }, supply);
  const courier = asked.connections[0];
  assert.equal(courier.status, "requested");
  refused(() => settings.requestConnection(root, { name: "courier TRACKING", holds: "Again", access: "read-only", owner: "Logistics" }, sme), 409);
  refused(() => settings.decideConnection(root, { id: courier.id, decision: "approved" }, sme), 403, "Quality owner");
  refused(() => settings.decideConnection(root, { id: courier.id, decision: "rejected", note: "" }, quality), 422, "why");
  assert.equal(settings.decideConnection(root, { id: courier.id, decision: "approved" }, quality).connections[0].status, "approved");
  refused(() => settings.decideConnection(root, { id: courier.id, decision: "rejected", note: "Changed my mind" }, quality), 409, "already approved");
  const own = settings.requestConnection(root, { name: "Temperature loggers", holds: "Excursion reports", access: "draft-only", owner: "Quality" }, quality).connections[1];
  refused(() => settings.decideConnection(root, { id: own.id, decision: "approved" }, quality), 409, "cannot also approve");
  assert.equal(settings.decideConnection(root, { id: own.id, decision: "rejected", note: "Not needed after all" }, quality).connections[1].status, "rejected", "turning down one's own request withdraws it");
  const db = openDatabase(root);
  assert.equal(verifyAudit(db).ok, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_entry WHERE type LIKE 'settings.%' OR type LIKE 'connection.%'").get().n, 5);
  console.log("ok  settings: schedule defaults, roles and validation; connection requests read-only or draft-only, four eyes on approval, all in the audit chain");
  closeDatabase(root);
}
await rm(join(temp, "data"), { recursive: true, force: true });

// ---------- 4. The /v1 API ----------
const api = createApi({ root, allowedOrigins: ["http://127.0.0.1:0"] });
const server = createServer((request, response) => api.handle(request, response, new URL(request.url, "http://127.0.0.1")));
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let cookie = "";
async function call(method, path, body, headers = {}) {
  const response = await fetch(base + path, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), "Sec-Fetch-Site": "same-origin", ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return { status: response.status, body: await response.json() };
}
const role = async value => assert.equal((await call("POST", "/v1/session", { role: value })).status, 200);
try {
  assert.equal((await call("GET", "/v1/health")).body.status, "ok");
  assert.equal((await call("GET", "/v1/openapi.json")).body.openapi, "3.1.0");
  const uk = (await call("GET", "/v1/cases/uk")).body;
  assert.equal(uk.workflow.draftSource, "ai", "the recorded passing check was adopted when the case was created");
  assert.equal((await call("POST", "/v1/cases/uk/commands", { action: "approve", revision: uk.workflow.revision, reason: "x" })).status, 401, "no role");
  await role("viewer");
  assert.equal((await call("POST", "/v1/cases/uk/commands", { action: "approve", revision: uk.workflow.revision, reason: "x" })).status, 403, "Clinical Supply cannot approve");
  await role("reviewer");
  assert.equal((await call("POST", "/v1/cases/uk/commands", { action: "approve", revision: 1, reason: "x" })).status, 409, "stale revision");
  assert.equal((await call("POST", "/v1/cases/uk/commands", { action: "approve", revision: uk.workflow.revision, reason: "" })).status, 422, "rationale required");
  assert.equal((await call("POST", "/v1/cases/uk/commands", { action: "approve", revision: uk.workflow.revision, reason: "x" }, { "Sec-Fetch-Site": "cross-site" })).status, 403, "other sites refused");
  assert.equal((await call("POST", "/v1/proposals/uk/decisions", { revision: uk.workflow.revision, outcome: "approve", rationale: "x" })).status, 400, "decisions need an Idempotency-Key");
  const decision = await call("POST", "/v1/proposals/uk/decisions", { revision: uk.workflow.revision, outcome: "approve", rationale: "Evidence checked", today: "2026-11-14" }, { "Idempotency-Key": "dec-1" });
  assert.equal(decision.status, 200);
  assert.equal(decision.body.workflow.stage, "published");
  assert.ok(decision.body.publication?.number === 2, "requirement version 2 published");
  const retry = await call("POST", "/v1/proposals/uk/decisions", { revision: uk.workflow.revision, outcome: "approve", rationale: "Evidence checked", today: "2026-11-14" }, { "Idempotency-Key": "dec-1" });
  assert.equal(retry.body.decision_id, decision.body.decision_id, "an exact retry returns the first result");
  assert.equal((await call("POST", "/v1/proposals/uk/decisions", { revision: uk.workflow.revision, outcome: "reject", rationale: "other" }, { "Idempotency-Key": "dec-1" })).status, 409, "same key, different request");
  const events = (await call("GET", "/v1/cases/uk/events")).body.events.map(event => event.type);
  for (const type of ["requirement_version.approved", "country_intelligence.updated", "downstream_action.required"]) assert.ok(events.includes(type), type);
  assert.ok((await call("GET", "/v1/cases/uk/events")).body.events.every(event => event.dispatch.status === "dispatched"), "outbox delivered");
  await role("verifier");
  assert.equal((await call("POST", "/v1/actions/QMS-2026-0117/acknowledgements", {})).status, 403, "only the owner acknowledges");
  await role("owner");
  const ack = await call("POST", "/v1/actions/QMS-2026-0117/acknowledgements", {}, { "Idempotency-Key": "ack-1" });
  assert.equal(ack.body.status, "acknowledged");
  await call("POST", "/v1/cases/uk/commands", { action: "implement", revision: decision.body.workflow.revision, reason: "QMS-REF-9" });
  await role("verifier");
  const verify = await call("POST", "/v1/cases/uk/commands", { action: "verify", revision: decision.body.workflow.revision, reason: "Complete" });
  assert.equal(verify.status, 409, "the case cannot close while its shipments are blocked");
  assert.match(verify.body.error, /still blocked/);
  const versions = (await call("GET", "/v1/requirements/GB%2FIMP_LABELING/versions?applicable_on=2026-05-01")).body;
  assert.deepEqual(versions.versions.map(item => item.number), [1, 2]);
  assert.equal(versions.applicable_version.number, 2);
  assert.equal((await call("GET", "/v1/evidence/EV-02")).body.excerpt, "the date of QP batch certification of the finished IMP");
  assert.ok((await call("GET", "/v1/cases/uk/impact")).body.findings.length === 43);
  // Shipment actions and change decisions.
  await role("viewer");
  assert.equal((await call("PUT", "/v1/shipment-actions/SHP-04", { action: "hold", reason: "" })).status, 422);
  assert.equal((await call("PUT", "/v1/shipment-actions/SHP-04", { action: "hold", reason: "Relabel first" })).body.by, "P. Laine · Clinical Supply");
  assert.equal((await call("GET", "/v1/shipment-actions")).body.actions["SHP-04"].action, "hold");
  assert.equal((await call("PUT", "/v1/change-decisions/import", { decision: "assessing", reason: "Watching" })).status, 403, "only the Regulatory SME decides on a change");
  await role("reviewer");
  assert.equal((await call("PUT", "/v1/change-decisions/import", { decision: "assessing", reason: "Watching" })).status, 200);
  // Reset for a rehearsal: versions from the earlier run are withdrawn, and the case can be approved again.
  const reset = (await call("POST", "/v1/cases/uk/reset", {})).body.workflow;
  assert.equal(reset.stage, "review");
  const again = await call("POST", "/v1/cases/uk/commands", { action: "approve", revision: reset.revision, reason: "Again", today: "2026-11-14" });
  assert.equal(again.status, 200, again.body.error);
  const after = (await call("GET", "/v1/requirements/GB%2FIMP_LABELING/versions")).body.versions;
  assert.deepEqual(after.map(item => `${item.number}:${item.status}`), ["1:in_force", "2:withdrawn", "2:in_force"]);
  // A deferred Spain case returns to review on its date, as the scheduler.
  const es = (await call("GET", "/v1/cases/es")).body.workflow;
  await call("POST", "/v1/cases/es/commands", { action: "defer", revision: es.revision, reason: "Wait", reviewOn: "2026-12-01", today: "2026-11-14" });
  const { db } = await api.context();
  returnDueDeferrals(db, model, "2026-12-01");
  const returned = caseRow(db, "es").state;
  assert.equal(returned.stage, "review");
  assert.equal(returned.events.at(-1).actor, "RegChain scheduler");
  assert.equal((await call("GET", "/v1/audit/verify")).body.ok, true, "the audit chain is intact after every step");
  console.log("ok  API: 401/403/409/422 and other-site refusals, idempotent decisions, outbox delivery, acknowledgement by the owner only, closing blocked while shipments are blocked,");
  console.log("    requirement history and date lookup, evidence, impact, shipment actions, change decisions, rehearsal reset, scheduled return from deferral, intact audit chain");
} finally {
  server.close();
  closeDatabase(root);
  await rm(temp, { recursive: true, force: true });
}
console.log("All server checks passed.");
