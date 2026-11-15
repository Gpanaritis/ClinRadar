// Governed change cases, server side. The workflow rules are the dashboard's own, ported line for line
// (scripts/check-server.mjs runs the page's code beside this module and compares every state).
// The server is the system of record: the role comes from the session, every step is checked here, and each
// step stores the case, its proposal, decision, published versions, Quality action, audit entries and outbox
// events in one transaction.

import { createImpact } from "./impact.mjs";
import { sectionNames as specSectionNames } from "./rules.mjs";
import { addOutboxEvent, appendAudit, auditFor, canonical, newId, sha256, transaction } from "./db.mjs";

const countryNames = { uk: "United Kingdom", de: "Germany", fr: "France", us: "United States", es: "Spain" };
const specCountryName = id => countryNames[id] ?? id;
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const athens = new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" });
function scheduleDate(value) {
  if (!value) return "—";
  const parts = Object.fromEntries(athens.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return Number(parts.day) + " " + monthNames[Number(parts.month) - 1] + " " + parts.year + ", " + parts.hour + ":" + parts.minute + " Athens time";
}
export const ROLES = { viewer: "Clinical Supply", reviewer: "Regulatory SME", owner: "Quality owner", verifier: "Quality verifier" };
const workflowPeople = { viewer: "P. Laine", owner: "M. Okafor", verifier: "L. Chen" };

export function createCaseModel(data) {
  const countrySpecs = data.specs;
  const spain = data.spain;
  const impact = createImpact(data);
  const ukCase = {
    id: "RC-UK-001", requirement: "GB/IMP_LABELING", effective: "2026-04-28", snapshot: "PORTFOLIO-01",
    baseline: countrySpecs.uk.sections.regulatory.items[0],
    policy: "Apply amended Part 7 from 28 April 2026, with the Schedule 14 paragraph 6 transition where its conditions are met.",
    initialText: "For each applicable UK IMP batch, record the finished-IMP QP date, trial cohort, intended use and approved label reference. Route missing dates, cutoff-day batches and unresolved variations to Regulatory Affairs.",
    evidence: [
      { id: "EV-01", source: "statute", tier: 1, kind: "Binding instrument", locator: "Regulation 32 and Schedule 14 paragraph 6", excerpt: "labelled in accordance with regulation 46 of the old rules" },
      { id: "EV-02", source: "transition", tier: 2, kind: "Official guidance", locator: "Transition for labeling of IMPs", excerpt: "the date of QP batch certification of the finished IMP" },
    ],
    key: "uk", country: "uk", jurisdiction: "GB", topic: "IMP_LABELING", reviewer: "A. Novak", preparedAt: "2026-11-14T09:42:00Z", taskId: "QMS-2026-0117", receipt: "LOCAL-REC-02",
    edits: state => [{ section: "regulatory", replaces: ukCase.baseline, text: state.policy ?? ukCase.policy }, { section: "regulatory", replaces: "", text: "Supply instruction: " + state.draft }],
  };
  const esCase = spain ? {
    ...spain.case, key: "es", country: "es", jurisdiction: "ES", topic: "IMP_SHIPPING_DOCUMENTS", reviewer: "C. Ruiz", taskId: "QMS-2026-0118", receipt: "LOCAL-REC-03",
    snapshot: "PORTFOLIO-01 + " + spain.trial.id, initialText: spain.case.instruction,
    baseline: "Delivery note in English or Spanish. No advance notice to the hospital pharmacy.",
    evidence: spain.case.evidence.map(item => ({ ...item, source: spain.notice.id, tier: 2, kind: "Information note", locator: item.point })),
    edits: state => state.sectionEdits ?? spain.case.sectionEdits,
  } : null;
  const governedCases = esCase ? { uk: ukCase, es: esCase } : { uk: ukCase };
  const caseOf = state => governedCases[state?.caseId ?? "uk"];

  // With named users, the signed-in person acts; without, the case's named people for each role.
  let actorOverride = null;
  function asActor(actor, work) {
    const previous = actorOverride;
    actorOverride = actor?.name ? actor : null;
    try { return work(); } finally { actorOverride = previous; }
  }
  function roleName(role, state) {
    if (actorOverride && actorOverride.role === role) return actorOverride.name + " · " + ROLES[role];
    const person = role === "reviewer" ? caseOf(state)?.reviewer : workflowPeople[role];
    return person && ROLES[role] ? person + " · " + ROLES[role] : undefined;
  }
  function initialWorkflow(caseId = "uk") {
    const governed = governedCases[caseId];
    return { schema: 1, caseId, stage: "review", revision: 1, draft: governed.initialText, decision: null, publication: null, task: null, events: [{
      eventId: governed.id + "-01", type: "case.prepared", actor: "ClinRadar monitor", at: governed.preparedAt,
      revision: 1, detail: caseId === "uk" ? "Source evidence compared and portfolio assessment prepared." : "New information note found on publication and the trial's Spanish shipments assessed.",
    }] };
  }
  function appendWorkflowEvent(state, type, role, now, detail) {
    const eventId = caseOf(state).id + "-" + String(state.events.length + 1).padStart(2, "0");
    state.events.push({ eventId, type, actor: roleName(role, state) ?? (role === "scheduler" ? "ClinRadar scheduler" : role === "ai" ? "ClinRadar check" : "ClinRadar publisher"), at: now, revision: state.revision, detail });
  }
  function workflowStep(state, command, role, now) {
    const { action, revision } = command;
    const reason = String(command.reason ?? "").trim();
    if (revision !== state.revision) throw Error("This proposal revision changed. Review the latest version.");
    if (["approve", "edit", "reject", "investigate", "defer", "resume"].includes(action)) {
      if (role !== "reviewer") throw Error("Switch to the Regulatory SME role to record a review decision.");
      if (action === "resume") {
        if (!["investigating", "deferred", "rejected"].includes(state.stage)) throw Error("There is no held proposal to resume.");
        if (!reason) throw Error("Record what changed or why review should resume.");
        state.revision++;
        state.stage = "review";
        state.decision = null;
        appendWorkflowEvent(state, "proposal.review_resumed", role, now, reason);
        return;
      }
      if (state.stage !== "review") throw Error("This revision is no longer awaiting a decision.");
      if (!reason) throw Error("Enter a decision rationale.");
      const instruction = String(command.instruction ?? "").trim();
      if (action === "edit") {
        if (!instruction || instruction === state.draft) throw Error("Edit the operational instruction before choosing Edit & approve.");
        state.revision++;
        state.draft = instruction;
        state.draftSource = "sme";
        appendWorkflowEvent(state, "proposal.edited", role, now, instruction);
      }
      if (["approve", "edit"].includes(action) && command.override) appendWorkflowEvent(state, "proposal.ai_check_overridden", role, now, "Approved without a passing AI check. " + reason);
      const reviewOn = command.reviewOn;
      if (action === "defer" && (!/^\d{4}-\d{2}-\d{2}$/.test(reviewOn ?? "") || reviewOn <= (command.today ?? now.slice(0, 10)))) throw Error("Choose a future return-to-review date.");
      if (action === "approve" && command.instruction != null && instruction !== state.draft) throw Error("Use Edit & approve to publish a modified instruction.");
      state.decision = { action, rationale: reason, actor: roleName(role, state), time: now, revision: state.revision, reviewOn: action === "defer" ? reviewOn : null };
      appendWorkflowEvent(state, "proposal." + ({ approve: "approved", edit: "approved", reject: "rejected", investigate: "investigation_requested", defer: "deferred" }[action]), role, now, reason + (action === "defer" ? " · Return " + reviewOn : ""));
      if (action === "reject" || action === "investigate" || action === "defer") {
        state.stage = { reject: "rejected", investigate: "investigating", defer: "deferred" }[action];
        return;
      }
      state.stage = "published";
      const governed = caseOf(state);
      const spec = countrySpecs[governed.country];
      const sectionEdits = governed.edits(state);
      state.publication = { version: spec.version + 1, previousVersion: spec.version, revision: state.revision, at: now, inForce: command.today ?? now.slice(0, 10), effective: governed.effective, policy: state.policy ?? governed.policy, instruction: state.draft,
        sectionEdits, source: state.draftSource ?? "seed", evidenceIds: governed.evidence.map(item => item.id) };
      const sectionList = [...new Set(sectionEdits.map(edit => edit.section))].map(id => specSectionNames[id] ?? id).join(", ");
      appendWorkflowEvent(state, "country_record.published", "publisher", now, specCountryName(governed.country) + " Country Specification v" + (spec.version + 1) + " · " + sectionList + " · " + governed.requirement + " · Receipt " + governed.receipt);
      if (governed.key === "uk") {
        const summary = impact.ukImpactSummary();
        state.task = { id: governed.taskId, owner: roleName("owner", state), status: "assigned", evidence: null, assignedAt: now, dueOn: summary.earliest,
          version: spec.version + 1, revision: state.revision, studyIds: [...summary.act.trials, ...summary.check.trials],
          batchIds: [...summary.act.batches, ...summary.check.batches].map(batch => batch.id),
          shipmentIds: summary.act.shipments.map(item => item.id), checkShipmentIds: summary.check.shipments.map(item => item.id),
          lookbackBatchIds: summary.lookback.map(batch => batch.id) };
      } else {
        const summary = impact.spainImpact();
        state.task = { id: governed.taskId, owner: roleName("owner", state), status: "assigned", evidence: null, assignedAt: now, dueOn: summary.first?.prepareBy ?? governed.effective,
          version: spec.version + 1, revision: state.revision, studyIds: [spain.trial.id], batchIds: [], shipmentIds: summary.affected.map(item => item.id),
          siteIds: summary.missing.map(site => site.id) };
      }
      appendWorkflowEvent(state, "quality_task.assigned", "publisher", now, "Quality task assigned for " + state.task.studyIds.join(", ") + ".");
      return;
    }
    const task = state.task;
    if (!task || state.stage !== "published") throw Error("A published specification update and an open Quality task are required.");
    if (action === "ack" && role === "owner" && task.status === "assigned") {
      task.status = "acknowledged";
      appendWorkflowEvent(state, "quality_task.acknowledged", role, now, "Owner acknowledged receipt. Implementation is pending.");
      return;
    }
    if (action === "implement" && role === "owner" && task.status === "acknowledged") {
      if (!reason) throw Error("Enter the implementation evidence reference.");
      task.evidence = { reference: reason, at: now, submittedBy: roleName(role, state) };
      task.status = "submitted";
      appendWorkflowEvent(state, "quality_task.evidence_submitted", role, now, reason);
      return;
    }
    if (action === "return" && role === "verifier" && task.status === "submitted") {
      if (!reason) throw Error("Record why the evidence needs revision.");
      task.status = "acknowledged";
      appendWorkflowEvent(state, "quality_task.evidence_returned", role, now, reason);
      return;
    }
    if (action === "verify" && role === "verifier" && task.status === "submitted" && task.evidence) {
      const personOf = label => String(label ?? "").split(" · ")[0].trim().toLowerCase();
      if ([state.decision?.actor, task.evidence.submittedBy].map(personOf).includes(personOf(roleName("verifier", state)))) throw Error("The verifier must be a different person from the approver and the owner.");
      if (!reason) throw Error("Enter the basis for verifying the evidence.");
      task.status = "verified";
      appendWorkflowEvent(state, "quality_task.verified", role, now, reason);
      state.stage = "closed";
      appendWorkflowEvent(state, "case.closed", "publisher", now, "Publication reconciled and Quality evidence verified.");
      return;
    }
    throw Error("This action is unavailable for the selected role and task status.");
  }
  // A passing AI check becomes the proposal under review, as a new revision; never past review, never over an SME edit, once per run.
  function adoptAiDraft(state, result, now) {
    if (state.stage !== "review" || !result?.verification?.verified || state.draftSource === "sme" || state.aiRunAt === result.at) return false;
    const draft = result.draft ?? {};
    const instruction = String(draft.proposedRequirement ?? "").trim();
    if (!instruction) return false;
    const governed = caseOf(state);
    if (governed.key !== "uk") {
      const known = countrySpecs[governed.country].sections;
      const edits = (Array.isArray(draft.sectionEdits) ? draft.sectionEdits : []).map(edit => ({ section: String(edit?.section ?? ""), replaces: String(edit?.replaces ?? "").trim(), text: String(edit?.text ?? "").trim() }))
        .filter(edit => known[edit.section] && edit.text);
      if (!edits.length) return false;
      state.sectionEdits = edits;
    }
    state.revision++;
    state.policy = String(draft.requirementStatement || draft.summary || governed.policy).trim();
    state.conditions = [draft.scope, ...(draft.transition?.conditions ?? [])].map(item => String(item ?? "").trim()).filter(Boolean);
    state.draft = instruction;
    state.draftSource = "ai";
    state.aiRunAt = result.at;
    state.aiModel = result.model;
    appendWorkflowEvent(state, "proposal.ai_draft_adopted", "ai", now, "Draft from " + result.model + " became revision " + state.revision + " after all " + result.verification.checks.length + " checks passed.");
    return true;
  }
  // Record an AI check on the case (once per run), and adopt its draft when it passes.
  function recordAnalysis(state, result, now) {
    if (!result) return false;
    let logged = false;
    if (!state.events.some(event => event.aiRunAt === result.at)) {
      const checks = result.verification.checks;
      appendWorkflowEvent(state, result.verification.verified ? "ai_check.passed" : "ai_check.failed", "ai", now,
        result.model + " · run " + scheduleDate(Date.parse(result.at)) + " · " + checks.filter(check => check.ok).length + " of " + checks.length + " checks passed");
      state.events[state.events.length - 1].aiRunAt = result.at;
      logged = true;
    }
    const adopted = adoptAiDraft(state, result, now);
    return logged || adopted;
  }
  // The sections of a country's specification once a case's edits are applied.
  function publishedSections(state) {
    const governed = caseOf(state);
    const spec = countrySpecs[governed.country];
    const sections = structuredClone(spec.sections);
    const plain = text => String(text ?? "").replace(/\s+/g, " ").trim();
    for (const edit of governed.edits(state)) {
      const section = sections[edit.section] ?? (sections[edit.section] = { items: [] });
      const at = edit.replaces ? section.items.findIndex(line => plain(line) === plain(edit.replaces)) : -1;
      if (at >= 0) section.items[at] = edit.text; else section.items.push(edit.text);
    }
    return sections;
  }
  return { governedCases, caseOf, roleName, asActor, initialWorkflow, workflowStep, adoptAiDraft, recordAnalysis, publishedSections, impact, countrySpecs,
    portfolioSeed: data.portfolio, spainSeed: data.spain?.trial ?? null };
}

// ---------- Storage ----------
const statusOf = message => (/role|different person/i.test(message) ? 403 : /revision changed/i.test(message) ? 409 : 422);

// Create each governed case once, with its baseline requirement and specification versions.
export function ensureCases(db, model, { analyses = {}, now = new Date().toISOString() } = {}) {
  for (const [key, governed] of Object.entries(model.governedCases)) {
    if (db.prepare("SELECT 1 FROM change_case WHERE case_key = ?").get(key)) continue;
    transaction(db, () => {
      const state = model.initialWorkflow(key);
      model.recordAnalysis(state, analyses[key], now);
      const id = governed.id;
      db.prepare(`INSERT INTO change_case (id, case_key, jurisdiction, topic, requirement_key, classification, detected_at, correlation_id, state, state_version, updated_at)
        VALUES (?, ?, ?, ?, ?, 'material', ?, ?, ?, 1, ?)`).run(id, key, governed.jurisdiction, governed.topic, governed.requirement, governed.preparedAt, id, JSON.stringify(state), now);
      const spec = model.countrySpecs[governed.country];
      if (!db.prepare("SELECT 1 FROM specification_version WHERE country = ? AND version = ? AND status = 'in_force'").get(governed.country, spec.version)) {
        db.prepare("INSERT INTO specification_version (id, country, version, sections, published_at) VALUES (?, ?, ?, ?, ?)")
          .run(newId("spec"), governed.country, spec.version, JSON.stringify(spec.sections), (spec.published ?? now.slice(0, 10)) + "T00:00:00Z");
      }
      db.prepare("INSERT INTO requirement_version (id, requirement_key, number, body, evidence_ids, published_at) VALUES (?, ?, 1, ?, '[]', ?)")
        .run(newId("req"), governed.requirement, JSON.stringify({ text: governed.baseline }), (spec.published ?? now.slice(0, 10)) + "T00:00:00Z");
      storeProposal(db, id, state);
      for (const event of state.events) auditEvent(db, governed, event, null);
    });
  }
}
export function caseRow(db, key) {
  const row = db.prepare("SELECT * FROM change_case WHERE case_key = ? OR id = ?").get(key, key);
  return row ? { ...row, state: JSON.parse(row.state) } : null;
}
function storeProposal(db, caseId, state) {
  const payload = { revision: state.revision, policy: state.policy ?? null, draft: state.draft, conditions: state.conditions ?? null, sectionEdits: state.sectionEdits ?? null };
  db.prepare("INSERT OR IGNORE INTO proposal (id, case_id, revision, source, payload, payload_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(newId("prop"), caseId, state.revision, state.draftSource ?? "seed", JSON.stringify(payload), sha256(canonical(payload)), new Date().toISOString());
}
function auditEvent(db, governed, event, role) {
  appendAudit(db, { actor: event.actor, role, type: event.type, subjectType: "change_case", subjectId: governed.id, detail: event.detail ?? "",
    data: { eventId: event.eventId, revision: event.revision, aiRunAt: event.aiRunAt ?? null }, correlationId: governed.id, at: event.at });
}

// Store a new state and everything that follows from the steps that produced it.
function persist(db, model, row, before, state, role, now) {
  const governed = model.caseOf(state);
  const fresh = state.events.slice(before.events.length);
  for (const event of fresh) auditEvent(db, governed, event, role);
  if (state.revision !== before.revision) storeProposal(db, row.id, state);
  let decisionId = null;
  if (state.decision && state.decision.time === now && state.decision !== before.decision) {
    decisionId = newId("dec");
    const proposal = db.prepare("SELECT id FROM proposal WHERE case_id = ? AND revision = ?").get(row.id, state.decision.revision);
    db.prepare("INSERT INTO decision (id, case_id, proposal_id, revision, outcome, rationale, actor, role, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(decisionId, row.id, proposal?.id ?? null, state.decision.revision, state.decision.action, state.decision.rationale, state.decision.actor, role, now);
  }
  const version = row.state_version + 1;
  const emit = (type, data, evidenceIds = []) => addOutboxEvent(db, { type, aggregateType: "change_case", aggregateId: row.id, aggregateVersion: version, correlationId: row.id, evidenceIds, data, at: now });
  if (state.publication && !before.publication) {
    const prior = db.prepare("SELECT id, number FROM requirement_version WHERE requirement_key = ? AND status = 'in_force' ORDER BY number DESC LIMIT 1").get(governed.requirement);
    const requirementId = newId("req");
    db.prepare(`INSERT INTO requirement_version (id, requirement_key, number, prior_id, body, applicable_from, in_force_from, evidence_ids, case_id, decision_id, receipt, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(requirementId, governed.requirement, (prior?.number ?? 0) + 1, prior?.id ?? null,
      JSON.stringify({ policy: state.publication.policy, instruction: state.publication.instruction, sectionEdits: state.publication.sectionEdits }),
      state.publication.effective, state.publication.inForce, JSON.stringify(state.publication.evidenceIds), row.id, decisionId, governed.receipt, now);
    db.prepare("INSERT INTO specification_version (id, country, version, sections, published_at, case_id, decision_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(newId("spec"), governed.country, state.publication.version, JSON.stringify(model.publishedSections(state)), now, row.id, decisionId);
    const task = state.task;
    db.prepare("INSERT OR REPLACE INTO action (id, case_id, decision_id, target, owner, due_on, status, scope, created_at, updated_at) VALUES (?, ?, ?, 'qms', ?, ?, ?, ?, ?, ?)")
      .run(task.id, row.id, decisionId, task.owner, task.dueOn ?? null, task.status, JSON.stringify({ studies: task.studyIds, batches: task.batchIds, shipments: task.shipmentIds, checkShipments: task.checkShipmentIds ?? [], sites: task.siteIds ?? [] }), now, now);
    const evidence = state.publication.evidenceIds;
    emit("requirement_version.approved", { requirement_version_id: requirementId, requirement_key: governed.requirement, decision_id: decisionId, revision: state.revision }, evidence);
    emit("country_intelligence.updated", { country: governed.country, version: state.publication.version, receipt: governed.receipt, decision_id: decisionId }, evidence);
    emit("downstream_action.required", { action_id: task.id, decision_id: decisionId, requirement_version_id: requirementId, target: "mock_qms", owner: task.owner, due_at: task.dueOn,
      study_ids: task.studyIds, batch_ids: task.batchIds, shipment_ids: [...task.shipmentIds, ...(task.checkShipmentIds ?? [])] }, evidence);
  }
  if (state.task && before.task && state.task.status !== before.task.status) {
    db.prepare("UPDATE action SET status = ?, updated_at = ? WHERE id = ?").run(state.task.status, now, state.task.id);
    const type = { acknowledged: before.task.status === "submitted" ? "implementation_evidence.returned" : "downstream_action.acknowledged", submitted: "downstream_action.implemented", verified: "implementation_evidence.verified" }[state.task.status];
    if (type) emit(type, { action_id: state.task.id, status: state.task.status, evidence: state.task.evidence?.reference ?? null });
  }
  if (state.stage === "closed" && before.stage !== "closed") emit("change.closed", { case_id: row.id, reason: "Publication reconciled and Quality evidence verified." });
  if (state.stage !== before.stage && ["rejected"].includes(state.stage)) emit("proposal.rejected", { case_id: row.id, revision: state.revision, decision_id: decisionId });
  db.prepare("UPDATE change_case SET state = ?, state_version = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(state), version, now, row.id);
}

// Apply one command as the session's role. Returns the new state, or throws with an HTTP status.
export function applyCommand(db, model, key, command, { role, actor = null, now = new Date().toISOString(), analysis = null, unresolved = () => [] } = {}) {
  return transaction(db, () => {
    const row = caseRow(db, key);
    if (!row) throw Object.assign(new Error("Unknown case."), { statusCode: 404 });
    if (!ROLES[role]) throw Object.assign(new Error("Choose a role first."), { statusCode: 401 });
    const before = row.state;
    const state = structuredClone(before);
    const action = command.action;
    // The AI gate, enforced here as well as on screen: a failed check blocks approval; no check needs a recorded override.
    if (["approve", "edit"].includes(action)) {
      if (analysis && !analysis.verification?.verified) throw Object.assign(new Error("The latest AI check failed, so approval is blocked. Re-run the AI check, reject, or request an investigation."), { statusCode: 422 });
      if (!analysis && !command.override) throw Object.assign(new Error("Run the AI check first, or tick the override and give your reason."), { statusCode: 422 });
    }
    // A case cannot close while shipments it covers are still blocked with nothing recorded.
    if (action === "verify") {
      const open = unresolved(state);
      if (open.length) throw Object.assign(new Error("Can't close yet: " + open.join(", ") + " still blocked with no recorded action."), { statusCode: 409 });
    }
    try {
      model.asActor(actor ? { ...actor, role } : null, () => model.workflowStep(state, { ...command, override: ["approve", "edit"].includes(action) ? Boolean(command.override && !analysis) : false }, role, now));
    } catch (error) {
      throw Object.assign(error, { statusCode: error.statusCode ?? statusOf(error.message) });
    }
    persist(db, model, row, before, state, role, now);
    return state;
  });
}

// Record an AI check against a case: logged once per run, adopted as the proposal when it passes.
export function applyAnalysis(db, model, key, result, { now = new Date().toISOString() } = {}) {
  return transaction(db, () => {
    const row = caseRow(db, key);
    if (!row || !result) return row?.state ?? null;
    const before = row.state;
    const state = structuredClone(before);
    if (!model.recordAnalysis(state, result, now)) return before;
    persist(db, model, row, before, state, "ai", now);
    return state;
  });
}

// Start a case again for a rehearsal. The audit trail keeps everything; published versions from the earlier run are withdrawn.
export function resetCase(db, model, key, { role, actor = null, now = new Date().toISOString(), analysis = null } = {}) {
  return transaction(db, () => {
    const row = caseRow(db, key);
    if (!row) throw Object.assign(new Error("Unknown case."), { statusCode: 404 });
    const governed = model.governedCases[row.case_key];
    appendAudit(db, { actor: model.asActor(actor ? { ...actor, role } : null, () => model.roleName(role, row.state)) ?? "RegChain", role, type: "case.reset", subjectType: "change_case", subjectId: row.id,
      detail: "Case started again. The earlier run stays in the audit trail.", data: { previous_state_sha256: sha256(canonical(row.state)), previous_stage: row.state.stage }, correlationId: row.id, at: now });
    db.prepare("UPDATE requirement_version SET status = 'withdrawn' WHERE case_id = ? AND status = 'in_force'").run(row.id);
    db.prepare("UPDATE specification_version SET status = 'withdrawn' WHERE case_id = ? AND status = 'in_force'").run(row.id);
    db.prepare("UPDATE action SET status = 'withdrawn', updated_at = ? WHERE case_id = ?").run(now, row.id);
    const state = model.initialWorkflow(row.case_key);
    model.recordAnalysis(state, analysis, now);
    for (const event of state.events.slice(1)) auditEvent(db, governed, event, "ai");
    storeProposal(db, row.id, state);
    db.prepare("UPDATE change_case SET state = ?, state_version = state_version + 1, updated_at = ? WHERE id = ?").run(JSON.stringify(state), now, row.id);
    return state;
  });
}

// A deferred case returns to the review queue on its date, as the RegChain scheduler.
export function returnDueDeferrals(db, model, today, now = new Date().toISOString()) {
  for (const key of Object.keys(model.governedCases)) {
    transaction(db, () => {
      const row = caseRow(db, key);
      if (!row || row.state.stage !== "deferred" || !(row.state.decision?.reviewOn <= today)) return;
      const before = row.state;
      const state = structuredClone(before);
      state.revision++;
      state.stage = "review";
      state.decision = null;
      const governed = model.governedCases[key];
      state.events.push({ eventId: governed.id + "-" + String(state.events.length + 1).padStart(2, "0"), type: "proposal.returned_on_due_date", actor: "ClinRadar scheduler", at: now, revision: state.revision,
        detail: "Deferred case returned to the review queue on its scheduled date." });
      persist(db, model, row, before, state, "scheduler", now);
    });
  }
}

export function caseView(db, model, key) {
  const row = caseRow(db, key);
  if (!row) return null;
  const governed = model.governedCases[row.case_key];
  return {
    id: row.id, key: row.case_key, jurisdiction: row.jurisdiction, topic: row.topic, requirement_key: row.requirement_key, classification: row.classification,
    detected_at: row.detected_at, state_version: row.state_version, updated_at: row.updated_at, effective: governed.effective,
    evidence: governed.evidence.map(item => ({ id: item.id, locator: item.locator, kind: item.kind, tier: item.tier, excerpt: item.excerpt ?? null })),
    proposals: db.prepare("SELECT id, revision, source, payload_sha256, created_at FROM proposal WHERE case_id = ? ORDER BY revision").all(row.id),
    decisions: db.prepare("SELECT id, revision, outcome, rationale, actor, role, decided_at FROM decision WHERE case_id = ? ORDER BY decided_at").all(row.id),
    workflow: row.state,
    audit_entries: auditFor(db, "change_case", row.id).length,
  };
}
