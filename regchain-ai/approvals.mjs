// Approving an agent plan in RegChain.
// The server checks the plan again before it records the approval: against the rules, and against the kits and
// relabelling places that other approved plans already hold. An option that no longer passes cannot be approved,
// and nothing is promised twice. An approval changes nothing in a validated system: each draft is still approved there.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cacheDir } from "./sources.mjs";
import { loadData, readApprovals, verifyOptionSafe as verifyOption } from "./rules.mjs";
import { draftApprovedOption } from "./agent.mjs";

const refuse = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const approvalsFile = root => join(cacheDir(root), "agent-approvals.json");
const runFile = (root, shipment) => join(cacheDir(root), `agent-run-${shipment}.json`);
const logFile = root => join(cacheDir(root), "agent-approvals-log.json");

// Every approval and withdrawal is kept, in order, for the audit trail.
async function log(root, entry) {
  let entries = [];
  try { entries = JSON.parse(await readFile(logFile(root), "utf8")); } catch {}
  entries.push({ ...entry, at: new Date().toISOString() });
  await mkdir(cacheDir(root), { recursive: true });
  await writeFile(logFile(root), JSON.stringify(entries, null, 2));
}
export async function approvalLog(root) {
  try { return JSON.parse(await readFile(logFile(root), "utf8")); } catch { return []; }
}

async function saveApprovals(root, approvals) {
  await mkdir(cacheDir(root), { recursive: true });
  await writeFile(approvalsFile(root), JSON.stringify(approvals, null, 2));
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

export async function approvePlan(root, { shipment, option, by, runAt }) {
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
    if (passing) throw refuse(409, `"${passing.title}" passes RegChain's rules now. Approve it, or withdraw other plans, instead of escalating.`);
    entry = { option, title: "Escalation", actions: [] };
  } else {
    const chosen = options.find(item => item.id === option);
    if (!chosen) throw refuse(404, "This option is not in the agent run.");
    const check = verifyOption(data, shipment, chosen.actions);
    if (!check.passes) {
      const reasons = check.notes.filter(note => note.startsWith("Not feasible")).map(note => note.replace("Not feasible: ", "")).join(" ");
      throw refuse(409, `"${chosen.title}" does not pass RegChain's rules now: ${reasons || "the shipment would still be " + check.after.toLowerCase() + "."}`);
    }
    entry = { option, title: chosen.title, actions: chosen.actions, after: check.after };
    // A passing option other than the recommendation has no drafts yet: draft its changes now, through the draft inbox.
    if (!run.drafts.some(draft => !draft.withdrawn && draft.option_id === option)) {
      await draftApprovedOption({ root, run, option: chosen });
      await saveRun(root, run);
    }
  }
  const drafts = run.drafts.filter(draft => !draft.withdrawn && (draft.option_id ?? run.resolution.recommended) === option).map(draft => draft.draft_id);
  approvals[shipment] = { ...entry, by: String(by).slice(0, 120), at: new Date().toISOString(), runAt: run.at, mode: run.mode, drafts };
  await saveApprovals(root, approvals);
  await log(root, { event: option === "escalate" ? "escalation.acknowledged" : "plan.approved", shipment, option, title: entry.title, by: approvals[shipment].by, runAt: run.at, drafts });
  return { approval: approvals[shipment], run };
}

export async function withdrawPlan(root, { shipment, by }) {
  const approvals = await readApprovals(root);
  if (!approvals[shipment]) throw refuse(404, "No approved plan for this shipment.");
  const withdrawn = approvals[shipment];
  delete approvals[shipment];
  await saveApprovals(root, approvals);
  await log(root, { event: "plan.withdrawn", shipment, option: withdrawn.option, title: withdrawn.title, by: by ?? null });
  return { withdrawn: shipment, by: by ?? null, at: new Date().toISOString() };
}
