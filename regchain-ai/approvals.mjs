// Approving an agent plan in RegChain.
// The server checks the plan again before it records the approval: against the rules, and against the kits and
// relabelling places that other approved plans already hold. An option that no longer passes cannot be approved,
// and nothing is promised twice. An approval changes nothing in a validated system: each draft is still approved there.

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cacheDir } from "./sources.mjs";
import { loadData, readApprovals, verifyOptionSafe as verifyOption } from "./rules.mjs";
import { draftApprovedOption } from "./agent.mjs";
import { appendAudit, openDatabase, transaction } from "./db.mjs";
import { emptyScope } from "./monitoring.mjs";
import { archiveAlerts } from "./alerts.mjs";

const refuse = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const runFile = (root, shipment) => join(cacheDir(root), `agent-run-${shipment}.json`);
const LOG_TYPES = ["approval.imported", "plan.approved", "escalation.acknowledged", "plan.withdrawn", "approvals.archived", "approvals_and_plans.archived"];

// The approvals' history, from the hash-chained audit trail.
export async function approvalLog(root) {
  const db = openDatabase(root);
  return db.prepare(`SELECT * FROM audit_entry WHERE type IN (${LOG_TYPES.map(() => "?").join(", ")}) ORDER BY seq`).all(...LOG_TYPES).map(row => {
    const data = JSON.parse(row.data);
    return { event: row.type, shipment: row.subject_type === "shipment" ? row.subject_id : null, by: row.actor, at: row.occurred_at, ...data };
  });
}
// Every saved version of a run is kept: the latest one for the page, and a copy of each version for the audit trail.
export async function saveRun(root, run) {
  const body = JSON.stringify(run, null, 2);
  await mkdir(join(cacheDir(root), "agent-runs"), { recursive: true });
  await writeFile(runFile(root, run.shipment), body);
  await writeFile(join(cacheDir(root), "agent-runs", `${run.shipment}-${run.at.replace(/[:.]/g, "-")}-${run.events.length}.json`), body);
}
export async function lastRun(root, shipment) {
  try { return JSON.parse(await readFile(runFile(root, shipment), "utf8")); } catch { return null; }
}

export async function approvePlan(root, { shipment, option, by, runAt, role = null }) {
  if (!/^SHP-[A-Z0-9-]+$/.test(String(shipment))) throw refuse(400, "Unknown shipment.");
  if (!by) throw refuse(400, "Say who approves the plan.");
  const run = await lastRun(root, shipment);
  if (!run?.resolution) throw refuse(404, "There is no agent run for this shipment yet.");
  if (runAt && run.at !== runAt) throw refuse(409, "A newer agent run exists for this shipment. Open it before approving.");
  const approvals = await readApprovals(root);
  if (approvals[shipment]) throw refuse(409, `A plan for ${shipment} is already approved. Withdraw it first.`);
  const data = await loadData(root);
  const options = run.resolution.options ?? [];
  let entry;
  if (option === "escalate") {
    const passing = options.find(item => verifyOption(data, shipment, item.actions).passes);
    if (passing) throw refuse(409, `"${passing.title}" passes ClinRadar's rules now. Approve it, or withdraw other plans, instead of escalating.`);
    entry = { option, title: "Escalation", actions: [] };
  } else {
    const chosen = options.find(item => item.id === option);
    if (!chosen) throw refuse(404, "This option is not in the agent run.");
    const check = verifyOption(data, shipment, chosen.actions);
    if (!check.passes) {
      const reasons = check.notes.filter(note => note.startsWith("Not feasible")).map(note => note.replace("Not feasible: ", "")).join(" ");
      throw refuse(409, `"${chosen.title}" does not pass ClinRadar's rules now: ${reasons || "the shipment would still be " + check.after.toLowerCase() + "."}`);
    }
    entry = { option, title: chosen.title, actions: chosen.actions, after: check.after };
    // A passing option other than the recommendation has no drafts yet: draft its changes now, through the draft inbox.
    if (!run.drafts.some(draft => !draft.withdrawn && draft.option_id === option)) {
      await draftApprovedOption({ root, run, option: chosen });
      await saveRun(root, run);
    }
  }
  const drafts = run.drafts.filter(draft => !draft.withdrawn && (draft.option_id ?? run.resolution.recommended) === option).map(draft => draft.draft_id);
  const approval = { ...entry, by: String(by).slice(0, 120), at: new Date().toISOString(), runAt: run.at, mode: run.mode, drafts };
  const db = openDatabase(root);
  transaction(db, () => {
    if (db.prepare("SELECT 1 FROM agent_approval WHERE shipment_id = ?").get(shipment)) throw refuse(409, `A plan for ${shipment} is already approved. Withdraw it first.`);
    db.prepare("INSERT INTO agent_approval (shipment_id, option_id, title, actions, after, approved_by, role, approved_at, run_at, mode, drafts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(shipment, option, entry.title, JSON.stringify(entry.actions ?? []), entry.after ?? null, approval.by, role ?? null, approval.at, run.at, run.mode ?? null, JSON.stringify(drafts));
    appendAudit(db, { actor: approval.by, role: role ?? null, type: option === "escalate" ? "escalation.acknowledged" : "plan.approved", subjectType: "shipment", subjectId: shipment,
      detail: entry.title, data: { option, title: entry.title, runAt: run.at, drafts }, at: approval.at });
  });
  return { approval, run };
}

// Where each shipment's latest agent run stands: a plan that passes, a plan to review, or an escalation.
export async function planSummaries(root) {
  const dir = cacheDir(root);
  let names = [];
  try { names = (await readdir(dir)).filter(name => /^agent-run-SHP-[A-Z0-9-]+\.json$/.test(name)); } catch {}
  const summaries = {};
  for (const name of names) {
    try {
      const run = JSON.parse(await readFile(join(dir, name), "utf8"));
      if (!run.resolution) continue;
      const recommended = run.resolution.recommended;
      const verdict = (run.verification ?? []).find(item => item.id === recommended);
      const option = (run.resolution.options ?? []).find(item => item.id === recommended);
      const anyPasses = (run.verification ?? []).some(item => item.passes);
      summaries[run.shipment] = {
        shipment: run.shipment, runAt: run.at, mode: run.mode, recommended, title: option?.title ?? "Escalate",
        status: verdict?.passes ? "plan" : anyPasses ? "review" : "escalate", after: verdict?.after ?? null,
        allocation: run.resolution.allocationShort ?? "", drafts: run.drafts.filter(draft => !draft.withdrawn).length,
        calls: run.events.filter(event => event.type === "tool_call").length,
      };
    } catch {}
  }
  return summaries;
}

// Start again for a rehearsal: approvals are archived, never deleted, and the reset is logged.
// With plans: true, the latest runs move to the run history too, so every shipment starts with no plan.
export async function startFresh(root, { plans = false, empty = false, by = null } = {}) {
  // An empty workspace also disconnects the active-trial portfolio and clears the monitoring decisions (both stay in the trail).
  if (empty) emptyScope(root, { by });
  const dir = cacheDir(root);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await mkdir(join(dir, "agent-runs"), { recursive: true });
  const db = openDatabase(root);
  const archived = db.prepare("SELECT * FROM agent_approval").all();
  let moved = 0;
  if (plans) {
    let names = [];
    try { names = (await readdir(dir)).filter(name => /^agent-(run-SHP-[A-Z0-9-]+|portfolio-run)\.json$/.test(name)); } catch {}
    await mkdir(join(dir, "agent-runs", `archived-${stamp}`), { recursive: true });
    for (const name of names) { await rename(join(dir, name), join(dir, "agent-runs", `archived-${stamp}`, name)); moved++; }
  }
  // The audit entry keeps every archived approval in full, so nothing is lost. Open alerts are archived too, so the next
  // check of the rehearsal raises them again; they stay in the database and the trail.
  transaction(db, () => {
    db.prepare("DELETE FROM agent_approval").run();
    const alerts = archiveAlerts(db);
    appendAudit(db, { actor: by ?? "RegChain", type: plans ? "approvals_and_plans.archived" : "approvals.archived", subjectType: "rehearsal", subjectId: stamp,
      detail: `${archived.length} approvals archived${plans ? ", " + moved + " runs moved to the history" : ""}${alerts.archived ? ", " + alerts.archived + " alerts archived" : ""}`,
      data: { runsArchived: moved, approvals: archived, alertsArchived: alerts.archived, deliveriesCancelled: alerts.cancelled } });
  });
  return { archived: true, plans, runsArchived: moved, approvalsArchived: archived.length };
}

export async function withdrawPlan(root, { shipment, by, role = null }) {
  const approvals = await readApprovals(root);
  if (!approvals[shipment]) throw refuse(404, "No approved plan for this shipment.");
  const withdrawn = approvals[shipment];
  const db = openDatabase(root);
  transaction(db, () => {
    db.prepare("DELETE FROM agent_approval WHERE shipment_id = ?").run(shipment);
    appendAudit(db, { actor: by ?? "RegChain", role, type: "plan.withdrawn", subjectType: "shipment", subjectId: shipment, detail: withdrawn.title, data: { option: withdrawn.option, title: withdrawn.title } });
  });
  return { withdrawn: shipment, by: by ?? null, at: new Date().toISOString() };
}
