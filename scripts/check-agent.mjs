// Checks the agent layer without calling the Anthropic API:
// the rules match the dashboard, the verifier is strict, the eight MCP servers start and answer, scripted runs resolve
// different kinds of shipment, the portfolio run never promises the same kits or slot twice, approvals are re-checked
// on the server, the live loop works end to end with a stand-in AI client, and the Claude service setting picks the
// right models and request for each service.
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
process.env.REGCHAIN_DATA_DIR = join(testCache, "data");

const { loadData, allShipmentChecks, verifyOption } = await import("../regchain-ai/rules.mjs");
const { connectSystems, closeSystems, describeSystems, resolveShipment, resolvePortfolio } = await import("../regchain-ai/agent.mjs");
const { approvePlan, withdrawPlan, approvalLog } = await import("../regchain-ai/approvals.mjs");
const data = await loadData(root);

// 1. The same results as the dashboard's Shipment checks page.
const by = result => allShipmentChecks(data).filter(item => item.result === result).map(item => item.id).sort();
assert.deepEqual(by("Blocked"), ["SHP-01", "SHP-02", "SHP-03", "SHP-04", "SHP-05", "SHP-06", "SHP-08", "SHP-10", "SHP-ES-08", "SHP-ES-09", "SHP-ES-10", "SHP-IL-01", "SHP-IL-02", "SHP-IL-03"]);
assert.deepEqual(by("Confirm"), ["SHP-07", "SHP-09", "SHP-ES-05", "SHP-ES-06", "SHP-ES-07"]);
assert.deepEqual(by("Ready"), ["SHP-CY-01", "SHP-ES-01", "SHP-ES-02", "SHP-ES-03", "SHP-ES-04", "SHP-GR-01"]);
console.log("ok  rules: 14 blocked (SHP-IL-01 by the Brussels strike), 5 to confirm, 6 ready, as on the Shipments page");

// 1b. Israel: one booklet label can no longer serve two countries.
{
  const { checkShipment } = await import("../regchain-ai/rules.mjs");
  const il02 = checkShipment(data, "SHP-IL-02");
  assert.match(il02.checks.find(item => item.section === "regulatory" && /Israel-only/.test(item.requirement)).detail, /shared with GR and CY/);
  const il01 = checkShipment(data, "SHP-IL-01");
  assert.equal(il01.checks.find(item => item.section === "regulatory" && /Israel-only/.test(item.requirement)).result, "Pass", "kits imported before the date may keep the shared booklet");
  assert.equal(il01.checks.find(item => item.section === "risk").result, "Fail", "the courier cancelled its flight on the strike day");
  assert.equal(checkShipment(data, "SHP-GR-01").result, "Ready", "Greece keeps the booklet");
  assert.equal(checkShipment(data, "SHP-IL-03").checks.find(item => /Israeli working day/.test(item.requirement)).result, "Fail", "a Friday delivery fails in Israel");
  assert.equal(checkShipment(data, "SHP-CY-01").checks.find(item => /working day/.test(item.requirement) && item.section === "logistics" && /Delivered/.test(item.requirement)).result, "Pass", "a Monday delivery passes in Cyprus");
  assert.equal(verifyOption(data, "SHP-IL-02", [{ type: "swap_batch", batch_id: "Q-815" }]).passes, true, "Israel-only stock");
  assert.equal(verifyOption(data, "SHP-IL-02", [{ type: "relabel", relabel_date: "2026-12-08" }]).passes, true, "relabelled for Israel");
  assert.equal(verifyOption(data, "SHP-IL-02", [{ type: "advance_dispatch", new_dispatch_date: "2026-12-28" }]).passes, true, "imported before the date");
  assert.equal(verifyOption(data, "SHP-IL-02", [{ type: "advance_dispatch", new_dispatch_date: "2026-11-16" }]).feasible, false, "preparation would already have passed");
  assert.equal(verifyOption(data, "SHP-IL-03", [{ type: "swap_batch", batch_id: "Q-815" }]).passes, false, "still delivered on a Friday");
  assert.equal(verifyOption(data, "SHP-IL-03", [{ type: "swap_batch", batch_id: "Q-815" }, { type: "advance_dispatch", new_dispatch_date: "2027-01-11" }]).passes, true);
  assert.equal(verifyOption(data, "SHP-GR-01", [{ type: "relabel", relabel_date: "2026-12-08" }]).feasible, false, "relabelling is for UK and Israeli labels");
  console.log("ok  Israel: the shared booklet is refused from 3 Jan 2027, Greece and Cyprus keep it, Israeli sites receive Sunday to Thursday, three ways out verify");
}

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

// 4. Eight MCP servers; only the draft inbox can create anything.
const systems = await connectSystems(root);
const described = describeSystems(systems);
assert.equal(described.length, 8);
const writers = described.flatMap(system => system.tools.filter(tool => !tool.readOnly).map(tool => `${system.id}.${tool.name}`));
assert.deepEqual(writers, ["drafts.create_draft"]);
console.log(`ok  MCP: ${described.map(system => `${system.name} (${system.tools.length})`).join(", ")}; only drafts.create_draft writes, and only drafts`);

// 5. Scripted runs on each kind of shipment.
const expectations = { "SHP-04": "swap-J-203", "SHP-01": "relabel-2026-11-16", "SHP-ES-09": "fix-data", "SHP-03": "escalate", "SHP-07": "proceed-confirm", "SHP-ES-05": "proceed-confirm", "SHP-IL-03": "swap-Q-815", "SHP-IL-01": "reroute-AMS" };
const saved = {};
for (const [shipment, recommended] of Object.entries(expectations)) {
  const run = await resolveShipment({ root, shipmentId: shipment, mode: "scripted", systems });
  assert.equal(run.error, undefined, run.error);
  assert.equal(run.resolution.recommended, recommended, JSON.stringify(run.resolution));
  assert.ok(run.resolution.options.every(option => option.title && option.actions.length), "every option has a title and actions");
  if (recommended === "escalate") assert.ok(run.verification.every(item => !item.passes), "an escalation means no option passes");
  else assert.ok(run.verification.find(item => item.id === recommended).passes, "the recommended option must pass SupplyShield's own verification");
  assert.ok(run.drafts.length >= 1 && run.drafts.every(draft => draft.executed === false && draft.option_id === recommended));
  saved[shipment] = run;
  console.log(`ok  scripted ${shipment}: ${run.events.length} steps, ${run.events.filter(e => e.type === "tool_call").length} MCP calls, ${run.drafts.length} draft${run.drafts.length === 1 ? "" : "s"}, recommends ${recommended}`);
}
await closeSystems(systems);

// 6. The portfolio: every shipment that needs action, most urgent first, with nothing promised twice.
const portfolio = await resolvePortfolio({ root, mode: "scripted", onShipment: run => writeFile(join(testCache, `agent-run-${run.shipment}.json`), JSON.stringify(run)) });
const { record: board, runs } = portfolio;
assert.equal(board.error, undefined, board.error);
assert.deepEqual({ shipments: board.summary.shipments, plans: board.summary.plans, escalated: board.summary.escalated, reallocated: board.summary.reallocated }, { shipments: 19, plans: 17, escalated: 2, reallocated: 2 });
assert.deepEqual(board.board.map(row => row.shipment).slice(0, 4), ["SHP-04", "SHP-IL-01", "SHP-01", "SHP-03"], "most urgent first: SHP-IL-01 must be prepared by 16 Nov");
assert.equal(board.board.find(row => row.shipment === "SHP-IL-01").recommended, "reroute-AMS", "the strike's flight is replaced, not the shipment");
const moved = board.board.find(row => row.changed);
assert.equal(moved.shipment, "SHP-06");
assert.match(moved.note, /2026-11-16 slot.*SHP-01/);
assert.ok(runs["SHP-06"].drafts.some(draft => draft.withdrawn) && runs["SHP-06"].drafts.some(draft => !draft.withdrawn && draft.option_id === moved.recommended), "first-choice drafts withdrawn, new ones drafted");
// Israel-only stock covers one Israeli shipment: the more urgent one gets it, the other is relabelled.
const il03 = board.board.find(row => row.shipment === "SHP-IL-03");
assert.equal(board.board.find(row => row.shipment === "SHP-IL-02").recommended, "swap-Q-815");
assert.ok(il03.changed && /^relabel-/.test(il03.recommended) && /Q-815.*SHP-IL-02/.test(il03.note), il03.note);
// Nothing over-promised: add up every chosen plan.
const pool = { ...data, reservations: [] };
for (const row of board.board.filter(item => item.status === "plan")) {
  const option = runs[row.shipment].resolution.options.find(item => item.id === row.recommended);
  const check = verifyOption(pool, row.shipment, option.actions);
  assert.ok(check.passes, `${row.shipment}'s plan still passes with the plans before it counted`);
  pool.reservations.push(...check.reservations);
}
console.log(`ok  portfolio: ${board.summary.shipments} shipments, ${board.summary.plans} plans, ${board.summary.escalated} escalated, SHP-06 moved off the 16 Nov slot that SHP-01 needs, SHP-IL-03 relabelled because SHP-IL-02 takes the Israel-only kits; nothing promised twice`);

// 7. Approvals are re-checked on the server.
await approvePlan(root, { shipment: "SHP-01", option: "relabel-2026-11-16", by: "P. Laine · Clinical Supply", runAt: runs["SHP-01"].at });
// SHP-06's first choice now loses to SHP-01's approved hold.
const firstChoice06 = runs["SHP-06"].resolution.options.find(option => option.id === "relabel-2026-11-16");
await assert.rejects(approvePlan(root, { shipment: "SHP-06", option: firstChoice06.id, by: "P. Laine · Clinical Supply", runAt: runs["SHP-06"].at }), /does not pass SupplyShield's rules now.*SHP-01/);
await approvePlan(root, { shipment: "SHP-06", option: moved.recommended, by: "P. Laine · Clinical Supply", runAt: runs["SHP-06"].at });
await assert.rejects(approvePlan(root, { shipment: "SHP-04", option: "escalate", by: "P. Laine · Clinical Supply" }), /passes SupplyShield's rules now/);
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
// The orchestrator's system prompt is the SupplyShield master instructions plus its task, cached as one prefix.
const systemText = params => (Array.isArray(params.system) ? params.system.map(block => block.text).join("\n") : params.system);
function standIn() {
  const turns = { orchestrator: 0, supply: 0 };
  const reply = (content, stop_reason = "tool_use") => ({ content, stop_reason, usage: { input_tokens: 10, output_tokens: 5 } });
  const use = (name, input) => ({ type: "tool_use", id: `t${Math.random().toString(36).slice(2, 8)}`, name, input });
  const plan = [{ type: "swap_batch", batch_id: "J-203" }, { type: "record_authorisation_route", authorisation_route: "old_rules" }];
  return {
    messages: {
      stream(params) {
        const who = systemText(params).includes("orchestrator") ? "orchestrator" : "supply";
        if (who === "orchestrator") {
          assert.ok(Array.isArray(params.system) && /Non-negotiable country-scope rule/.test(params.system[0].text), "the orchestrator works under the SupplyShield master instructions");
          assert.equal(params.system.at(-1).cache_control?.type, "ephemeral", "tools and both system blocks are cached as one prefix");
        } else assert.equal(typeof params.system, "string", "specialists keep their short instructions");
        const step = turns[who]++;
        let message;
        if (who === "supply") {
          message = step === 0 ? reply([use("irt__get_depot_stock", { depot: "UK depot", product_id: "IMP-004" })]) : reply([{ type: "text", text: "J-203: 48 kits, label v2." }], "end_turn");
        } else {
          message = [
            reply([{ type: "text", text: "Reading the checks." }, use("specs__get_shipment_checks", { shipment_id: "SHP-04" })]),
            reply([use("delegate_to_agent", { agent: "supply", task: "Find IMP-004 batches at the UK depot." })]),
            reply([use("specs__verify_option", { shipment_id: "SHP-04", actions: plan })]),
            // A draft for an option that will fail SupplyShield's check: it must come back withdrawn.
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

// 9. Which Claude service: one setting, Claude models only, and one clear sentence for whatever is missing.
{
  const { claudeSettings, setupMessage, createClaude, credentialsRefused, PROVIDERS } = await import("../regchain-ai/claude.mjs");
  const { draftChange } = await import("../regchain-ai/analyze.mjs");
  const plain = claudeSettings({ ANTHROPIC_API_KEY: "test" });
  assert.equal(plain.provider, "anthropic");
  assert.ok(plain.configured && plain.serverFallbacks);
  assert.deepEqual(plain.models, { orchestrator: "claude-opus-5-5", specialist: "claude-sonnet-5-5", aiCheck: "claude-opus-5-5" });
  assert.equal(setupMessage(claudeSettings({}), true), "Add ANTHROPIC_API_KEY to the .env file next to serve-regchain.cjs, then restart RegChain.");
  const bedrock = claudeSettings({ REGCHAIN_AI_PROVIDER: "bedrock", AWS_REGION: "eu-central-1" });
  assert.ok(bedrock.configured && !bedrock.serverFallbacks);
  assert.deepEqual(bedrock.models, { orchestrator: "anthropic.claude-opus-5-5", specialist: "anthropic.claude-sonnet-5-5", aiCheck: "anthropic.claude-opus-5-5" });
  assert.match(setupMessage(bedrock, false), /npm install @anthropic-ai\/bedrock-sdk/);
  assert.deepEqual(claudeSettings({ REGCHAIN_AI_PROVIDER: "aws", AWS_REGION: "eu-west-1" }).missing, ["ANTHROPIC_AWS_WORKSPACE_ID"]);
  assert.ok(claudeSettings({ REGCHAIN_AI_PROVIDER: "google-cloud", ANTHROPIC_GOOGLE_CLOUD_WORKSPACE_ID: "wrkspc_test" }).configured);
  assert.match(setupMessage(claudeSettings({ REGCHAIN_AI_PROVIDER: "vertex" }), true), /CLOUD_ML_REGION/);
  assert.equal(claudeSettings({ REGCHAIN_AI_PROVIDER: "vertex", CLOUD_ML_REGION: "global" }).models.orchestrator, "claude-opus-5-5");
  assert.deepEqual(claudeSettings({ REGCHAIN_AI_PROVIDER: "Foundry" }).missing, ["ANTHROPIC_FOUNDRY_RESOURCE"]);
  assert.match(claudeSettings({ ANTHROPIC_API_KEY: "test", REGCHAIN_MODEL_SPECIALIST: "gpt-5" }).problems[0], /Claude models only/);
  assert.match(claudeSettings({ REGCHAIN_AI_PROVIDER: "openai" }).problems[0], /Use one of: anthropic, aws, bedrock, google-cloud, vertex, foundry/);
  assert.match(credentialsRefused({ status: 401 }, plain), /Anthropic API key was not accepted/);
  assert.match(credentialsRefused({ status: 403 }, bedrock), /Amazon Bedrock did not accept/);
  assert.equal(credentialsRefused({ status: 500 }, bedrock), null);

  // Through Amazon Bedrock: the agents and the AI check use Bedrock's model names, and the AI check leaves out the
  // server-side fallback that Bedrock does not offer.
  const saved = { REGCHAIN_AI_PROVIDER: process.env.REGCHAIN_AI_PROVIDER, AWS_REGION: process.env.AWS_REGION };
  Object.assign(process.env, { REGCHAIN_AI_PROVIDER: "bedrock", AWS_REGION: "eu-central-1" });
  try {
    await assert.rejects(createClaude({ load: async () => { throw new Error("not installed"); } }), /npm install @anthropic-ai\/bedrock-sdk/);
    const seen = new Map();
    const inner = standIn();
    const viaBedrock = await resolveShipment({ root, shipmentId: "SHP-04", mode: "live", client: { messages: { stream(params) {
      seen.set(systemText(params).includes("orchestrator") ? "orchestrator" : "supply", params.model);
      return inner.messages.stream(params);
    } } } });
    assert.equal(viaBedrock.error, undefined, viaBedrock.error);
    assert.equal(seen.get("orchestrator"), "anthropic.claude-opus-5-5");
    assert.equal(seen.get("supply"), "anthropic.claude-sonnet-5-5");
    assert.equal(viaBedrock.models.service, "Amazon Bedrock");
    const sources = [{ id: "v1", role: "before", text: "Old text." }, { id: "v2", role: "after", text: "New text." }];
    let sent;
    await draftChange(sources, { claude: claudeSettings(), client: { messages: { async create(params) {
      sent = params;
      return { model: params.model, stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] };
    } } } });
    assert.equal(sent.model, "anthropic.claude-opus-5-5");
    assert.ok(!("fallbacks" in sent) && !("betas" in sent), "Bedrock gets no server-side fallback");
  } finally {
    for (const [name, value] of Object.entries(saved)) value === undefined ? delete process.env[name] : (process.env[name] = value);
  }
  console.log(`ok  Claude service: ${Object.keys(PROVIDERS).length} services, Claude models only, a clear sentence for what is missing, and a live run through Amazon Bedrock with its own model names`);
}

(await import("../regchain-ai/db.mjs")).closeDatabase(root);
await rm(testCache, { recursive: true, force: true });
if (process.argv.includes("--save")) {
  await mkdir(realCache, { recursive: true });
  for (const [shipment, run] of Object.entries(saved)) await writeFile(join(realCache, `agent-run-${shipment}.json`), JSON.stringify(run, null, 2));
  console.log(`saved ${Object.keys(saved).length} scripted runs to ${realCache}`);
}
console.log("All agent checks passed.");
