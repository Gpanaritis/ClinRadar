// Checks the agent layer without calling the Anthropic API:
// the rules match the dashboard, the verifier is strict, the six MCP servers start and answer, scripted runs resolve
// different kinds of shipment, the portfolio run never promises the same kits or slot twice, approvals are re-checked
// on the server, and the live loop works end to end with a stand-in AI client.
// Usage: node scripts/check-agent.mjs [--save]   (--save writes the scripted runs as recorded results, for UI testing)
// Every check runs in a temporary cache, so approvals on this computer never change the results.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const realCache = process.env.REGCHAIN_CACHE_DIR || join(root, ".regchain-cache");
const testCache = await mkdtemp(join(tmpdir(), "regchain-agent-check-"));
process.env.REGCHAIN_CACHE_DIR = testCache;

const { loadData, allShipmentChecks, verifyOption } = await import("../regchain-ai/rules.mjs");
const { connectSystems, closeSystems, describeSystems, resolveShipment, resolvePortfolio } = await import("../regchain-ai/agent.mjs");
const { approvePlan, withdrawPlan, approvalLog } = await import("../regchain-ai/approvals.mjs");
const data = await loadData(root);

// 1. The same results as the dashboard's Shipment checks page.
const by = result => allShipmentChecks(data).filter(item => item.result === result).map(item => item.id).sort();
assert.deepEqual(by("Blocked"), ["SHP-01", "SHP-02", "SHP-03", "SHP-04", "SHP-05", "SHP-06", "SHP-08", "SHP-10", "SHP-ES-08", "SHP-ES-09", "SHP-ES-10"]);
assert.deepEqual(by("Confirm"), ["SHP-07", "SHP-09", "SHP-ES-05", "SHP-ES-06", "SHP-ES-07"]);
assert.deepEqual(by("Ready"), ["SHP-ES-01", "SHP-ES-02", "SHP-ES-03", "SHP-ES-04"]);
console.log("ok  rules: 11 blocked, 5 to confirm, 4 ready, as on the Shipment checks page");

// 2. The verifier is strict: partial, infeasible and too-late options fail.
assert.equal(verifyOption(data, "SHP-04", [{ type: "swap_batch", batch_id: "J-203" }]).passes, false, "the route is still missing");
assert.equal(verifyOption(data, "SHP-04", [{ type: "swap_batch", batch_id: "J-203" }, { type: "record_authorisation_route", authorisation_route: "old_rules" }]).passes, true);
assert.equal(verifyOption(data, "SHP-04", [{ type: "delay", new_dispatch_date: "2026-11-26" }]).feasible, false, "6 days of stock");
assert.equal(verifyOption(data, "SHP-05", [{ type: "relabel", relabel_date: "2026-11-18" }]).feasible, false, "label not approved");
const late = verifyOption(data, "SHP-04", [{ type: "relabel", relabel_date: "2026-11-16" }, { type: "record_authorisation_route", authorisation_route: "old_rules" }]);
assert.equal(late.feasible, false, "kits relabelled on 16 Nov are ready after preparation starts on 14 Nov");
assert.match(late.notes.join(" "), /after preparation starts on 2026-11-14/);
assert.equal(verifyOption(data, "SHP-04", [{ type: "relabel", relabel_date: "2026-11-16" }, { type: "delay", new_dispatch_date: "2026-11-23" }, { type: "record_authorisation_route", authorisation_route: "old_rules" }]).passes, true);
console.log("ok  verifier: partial, infeasible and too-late options fail; relabelling must finish before preparation");

// 3. Commitments: kits and slot places held by another shipment's plan are not available.
const held = { ...data, reservations: [{ kind: "relabel", depot: "UK depot", date: "2026-11-16", kits: 10, shipment: "SHP-01" }, { kind: "stock", depot: "UK depot", batch: "J-203", kits: 40, shipment: "SHP-99" }] };
assert.equal(verifyOption(held, "SHP-06", [{ type: "relabel", relabel_date: "2026-11-16" }]).passes, false, "10 of 20 places held, 14 needed");
assert.equal(verifyOption(held, "SHP-06", [{ type: "relabel", relabel_date: "2026-11-18" }]).passes, true);
assert.equal(verifyOption(held, "SHP-04", [{ type: "swap_batch", batch_id: "J-203" }, { type: "record_authorisation_route", authorisation_route: "old_rules" }]).feasible, false, "40 of 48 kits held, 12 needed");
assert.equal(verifyOption(held, "SHP-01", [{ type: "relabel", relabel_date: "2026-11-16" }, { type: "delay", new_dispatch_date: "2026-11-23" }]).passes, true, "a shipment's own hold does not count against it");
console.log("ok  commitments: kits and relabelling places promised to other shipments are not offered again");

// 4. Six MCP servers; only the draft inbox can create anything.
const systems = await connectSystems(root);
const described = describeSystems(systems);
assert.equal(described.length, 6);
const writers = described.flatMap(system => system.tools.filter(tool => !tool.readOnly).map(tool => `${system.id}.${tool.name}`));
assert.deepEqual(writers, ["drafts.create_draft"]);
console.log(`ok  MCP: ${described.map(system => `${system.name} (${system.tools.length})`).join(", ")}; only drafts.create_draft writes, and only drafts`);

// 5. Scripted runs on each kind of shipment.
const expectations = { "SHP-04": "swap-J-203", "SHP-01": "relabel-2026-11-16", "SHP-ES-09": "fix-data", "SHP-03": "escalate", "SHP-07": "proceed-confirm", "SHP-ES-05": "proceed-confirm" };
const saved = {};
for (const [shipment, recommended] of Object.entries(expectations)) {
  const run = await resolveShipment({ root, shipmentId: shipment, mode: "scripted", systems });
  assert.equal(run.error, undefined, run.error);
  assert.equal(run.resolution.recommended, recommended, JSON.stringify(run.resolution));
  assert.ok(run.resolution.options.every(option => option.title && option.actions.length), "every option has a title and actions");
  if (recommended === "escalate") assert.ok(run.verification.every(item => !item.passes), "an escalation means no option passes");
  else assert.ok(run.verification.find(item => item.id === recommended).passes, "the recommended option must pass RegChain's own verification");
  assert.ok(run.drafts.length >= 1 && run.drafts.every(draft => draft.executed === false && draft.option_id === recommended));
  saved[shipment] = run;
  console.log(`ok  scripted ${shipment}: ${run.events.length} steps, ${run.events.filter(e => e.type === "tool_call").length} MCP calls, ${run.drafts.length} draft${run.drafts.length === 1 ? "" : "s"}, recommends ${recommended}`);
}
await closeSystems(systems);

// 6. The portfolio: every shipment that needs action, most urgent first, with nothing promised twice.
const portfolio = await resolvePortfolio({ root, mode: "scripted", onShipment: run => writeFile(join(testCache, `agent-run-${run.shipment}.json`), JSON.stringify(run)) });
const { record: board, runs } = portfolio;
assert.equal(board.error, undefined, board.error);
assert.deepEqual({ shipments: board.summary.shipments, plans: board.summary.plans, escalated: board.summary.escalated, reallocated: board.summary.reallocated }, { shipments: 16, plans: 14, escalated: 2, reallocated: 1 });
assert.deepEqual(board.board.map(row => row.shipment).slice(0, 3), ["SHP-04", "SHP-01", "SHP-03"], "most urgent first");
const moved = board.board.find(row => row.changed);
assert.equal(moved.shipment, "SHP-06");
assert.match(moved.note, /2026-11-16 slot.*SHP-01/);
assert.ok(runs["SHP-06"].drafts.some(draft => draft.withdrawn) && runs["SHP-06"].drafts.some(draft => !draft.withdrawn && draft.option_id === moved.recommended), "first-choice drafts withdrawn, new ones drafted");
// Nothing over-promised: add up every chosen plan.
const pool = { ...data, reservations: [] };
for (const row of board.board.filter(item => item.status === "plan")) {
  const option = runs[row.shipment].resolution.options.find(item => item.id === row.recommended);
  const check = verifyOption(pool, row.shipment, option.actions);
  assert.ok(check.passes, `${row.shipment}'s plan still passes with the plans before it counted`);
  pool.reservations.push(...check.reservations);
}
console.log(`ok  portfolio: ${board.summary.shipments} shipments, ${board.summary.plans} plans, ${board.summary.escalated} escalated, SHP-06 moved off the 16 Nov slot that SHP-01 needs; nothing promised twice`);

// 7. Approvals are re-checked on the server.
await approvePlan(root, { shipment: "SHP-01", option: "relabel-2026-11-16", by: "P. Laine · Clinical Supply", runAt: runs["SHP-01"].at });
// SHP-06's first choice now loses to SHP-01's approved hold.
const firstChoice06 = runs["SHP-06"].resolution.options.find(option => option.id === "relabel-2026-11-16");
await assert.rejects(approvePlan(root, { shipment: "SHP-06", option: firstChoice06.id, by: "P. Laine · Clinical Supply", runAt: runs["SHP-06"].at }), /does not pass RegChain's rules now.*SHP-01/);
await approvePlan(root, { shipment: "SHP-06", option: moved.recommended, by: "P. Laine · Clinical Supply", runAt: runs["SHP-06"].at });
await assert.rejects(approvePlan(root, { shipment: "SHP-04", option: "escalate", by: "P. Laine · Clinical Supply" }), /passes RegChain's rules now/);
await approvePlan(root, { shipment: "SHP-03", option: "escalate", by: "P. Laine · Clinical Supply" });
await assert.rejects(approvePlan(root, { shipment: "SHP-01", option: "relabel-2026-11-16", by: "P. Laine · Clinical Supply" }), /already approved/);
await assert.rejects(approvePlan(root, { shipment: "SHP-02", option: "swap-H-108", by: "P. Laine · Clinical Supply", runAt: "2020-01-01T00:00:00.000Z" }), /newer agent run/);
// SHP-04's relabelling alternative needs 12 places on 16 Nov: none while SHP-01 holds 10 of the 20.
const alternative = runs["SHP-04"].resolution.options.find(option => option.actions.some(action => action.type === "relabel"));
await assert.rejects(approvePlan(root, { shipment: "SHP-04", option: alternative.id, by: "P. Laine · Clinical Supply" }), /10 already promised to SHP-01/);
await withdrawPlan(root, { shipment: "SHP-01", by: "P. Laine · Clinical Supply" });
const after = await loadData(root);
assert.ok(!after.reservations.some(item => item.shipment === "SHP-01"), "a withdrawn plan frees what it held");
// Now it fits, and a passing option other than the recommendation gets its own drafts when it is approved.
const approved = await approvePlan(root, { shipment: "SHP-04", option: alternative.id, by: "P. Laine · Clinical Supply" });
assert.ok(approved.approval.drafts.length >= 2 && approved.run.drafts.filter(draft => draft.option_id === "swap-J-203").every(draft => draft.withdrawn));
assert.deepEqual((await approvalLog(root)).map(entry => entry.event), ["plan.approved", "plan.approved", "escalation.acknowledged", "plan.withdrawn", "plan.approved"]);
console.log("ok  approvals: re-checked on the server, refused when stale, already approved or no longer passing; withdrawals free their holds; every step logged");

// 8. The live loop with a stand-in AI client: delegation, MCP calls, verification, a draft and the resolution.
function standIn() {
  const turns = { orchestrator: 0, supply: 0 };
  const reply = (content, stop_reason = "tool_use") => ({ content, stop_reason, usage: { input_tokens: 10, output_tokens: 5 } });
  const use = (name, input) => ({ type: "tool_use", id: `t${Math.random().toString(36).slice(2, 8)}`, name, input });
  const plan = [{ type: "swap_batch", batch_id: "J-203" }, { type: "record_authorisation_route", authorisation_route: "old_rules" }];
  return {
    messages: {
      stream(params) {
        const who = params.system.includes("orchestrator") ? "orchestrator" : "supply";
        const step = turns[who]++;
        let message;
        if (who === "supply") {
          message = step === 0 ? reply([use("irt__get_depot_stock", { depot: "UK depot", product_id: "IMP-004" })]) : reply([{ type: "text", text: "J-203: 48 kits, label v2." }], "end_turn");
        } else {
          message = [
            reply([{ type: "text", text: "Reading the checks." }, use("specs__get_shipment_checks", { shipment_id: "SHP-04" })]),
            reply([use("delegate_to_agent", { agent: "supply", task: "Find IMP-004 batches at the UK depot." })]),
            reply([use("specs__verify_option", { shipment_id: "SHP-04", actions: plan })]),
            // A draft for an option that will fail RegChain's check: it must come back withdrawn.
            reply([use("drafts__create_draft", { target_system: "IRT", kind: "Dispatch date change", shipment_id: "SHP-04", option_id: "B", title: "Delay", body: "Unverified." })]),
            reply([use("drafts__create_draft", { target_system: "IRT", kind: "Shipment change request", shipment_id: "SHP-04", option_id: "A", title: "Swap to J-203", body: "Verified." })]),
            reply([use("submit_resolution", { summary: "Swap to J-203.", root_cause: "Legacy label after the cutoff.", options: [{ id: "A", title: "Swap to J-203", actions: plan, why: "Updated label." }, { id: "B", title: "Delay to 2026-11-30", actions: [{ type: "delay", new_dispatch_date: "2026-11-30" }], why: "Time." }], recommended: "A" })]),
          ][step];
        }
        assert.ok(params.tools.every(tool => /^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)), "tool names must be valid");
        return { finalMessage: async () => message };
      },
    },
  };
}
const live = await resolveShipment({ root, shipmentId: "SHP-04", mode: "live", client: standIn() });
assert.equal(live.error, undefined, live.error);
assert.ok(live.events.some(event => event.type === "delegate" && event.to === "supply"));
assert.ok(live.events.some(event => event.agent === "supply" && event.type === "tool_call" && event.system === "IRT"));
assert.equal(live.verification.find(item => item.id === "A").passes, true);
assert.equal(live.drafts.length, 2);
assert.ok(live.drafts.find(draft => draft.option_id === "B").withdrawn && !live.drafts.find(draft => draft.option_id === "A").withdrawn, "drafts of a failing option are withdrawn");
console.log(`ok  live loop (stand-in AI): ${live.events.length} steps, delegation to the supply agent, MCP calls, verification, and a draft for a failing option withdrawn`);

await rm(testCache, { recursive: true, force: true });
if (process.argv.includes("--save")) {
  await mkdir(realCache, { recursive: true });
  for (const [shipment, run] of Object.entries(saved)) await writeFile(join(realCache, `agent-run-${shipment}.json`), JSON.stringify(run, null, 2));
  console.log(`saved ${Object.keys(saved).length} scripted runs to ${realCache}`);
}
console.log("All agent checks passed.");
