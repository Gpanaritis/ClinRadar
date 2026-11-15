// Checks the agent layer without calling the Google API:
// the rules match the dashboard, the verifier is strict, the eight MCP servers start and answer, scripted runs resolve
// different kinds of shipment, the portfolio run never promises the same kits or slot twice, approvals are re-checked
// on the server, the live loop works end to end with a stand-in AI client, and the Gemini service setting picks the
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

// 4b. The watch team: four agents on the watch model, each with read-only tools that exist on the ClinRadar server.
{
  const { AGENTS, WATCH_AGENTS, WATCH_MODEL } = await import("../regchain-ai/agent.mjs");
  assert.deepEqual(WATCH_AGENTS, ["weather", "transport", "security", "regulatory"]);
  assert.equal(WATCH_MODEL, "gemini-3.5-flash-lite");
  assert.deepEqual(WATCH_AGENTS.map(id => AGENTS[id].name), ["Weather & natural hazards", "Strikes & transport", "Security & travel advice", "Regulatory & customs"]);
  const specsTools = described.find(system => system.id === "specs").tools;
  for (const id of WATCH_AGENTS) {
    assert.equal(AGENTS[id].model, "gemini-3.5-flash-lite");
    assert.ok(AGENTS[id].tools.includes("specs__get_watch_brief") && AGENTS[id].tools.every(name => name.startsWith("specs__") && specsTools.some(tool => tool.name === name.split("__")[1] && tool.readOnly)), `${id}: read-only ClinRadar tools only`);
    assert.match(AGENTS[id].system, /Never treat a single unverified source as confirmed/);
    assert.match(AGENTS[id].system, /No probabilities/);
  }
  assert.equal(AGENTS.orchestrator.model, "gemini-3.8-flash");
  assert.equal(AGENTS.logistics.model, "gemini-3.8-flash");
  const read = async (tool, args) => JSON.parse((await systems.specs.client.callTool({ name: tool, arguments: args })).content[0].text);
  const weather = await read("get_risk_signals", { hazard: "weather" });
  assert.ok(weather.length >= 3 && weather.every(item => item.hazard === "weather"), "the hazard filter returns only that kind");
  assert.ok(weather.some(item => item.id === "SIG-US-WINTER-1116" && item.region === "North America"), "a non-European natural hazard near our US depot");
  const europe = await read("get_risk_signals", { region: "Europe" });
  assert.ok(europe.length && europe.every(item => item.region === "Europe"));
  assert.equal((await read("get_risk_signals", {})).length, data.supplyshield.signals.length, "without filters, every signal as before");
  assert.deepEqual((await read("get_risk_signals", { shipment_id: "SHP-IL-01", hazard: "transport" })).matches.map(item => item.signal), ["SIG-BE-STRIKE-1124"]);
  assert.deepEqual((await read("get_risk_signals", { shipment_id: "SHP-IL-01", hazard: "weather" })).matches, []);
  const brief = await read("get_watch_brief", { hazard: "transport" });
  assert.equal(brief.monitored_countries.length, data.supplyshield.scope.monitored.external.length);
  assert.equal(brief.most_relevant[0], "SIG-BE-STRIKE-1124");
  const regulatoryBrief = await read("get_watch_brief", { hazard: "regulatory" });
  assert.ok(regulatoryBrief.items.some(item => item.id === "RC-IL-001" && item.touching.includes("SHP-IL-02")), "the regulatory watch sees which shipments each change affects");
  // Enterprise risk alerts, read-only, optionally for one kind of hazard.
  assert.ok(specsTools.some(tool => tool.name === "get_enterprise_alerts" && tool.readOnly));
  assert.ok(["weather", "transport", "security"].every(id => AGENTS[id].tools.includes("specs__get_enterprise_alerts")) && !AGENTS.regulatory.tools.includes("specs__get_enterprise_alerts"));
  const enterpriseAll = await read("get_enterprise_alerts", {});
  assert.deepEqual([enterpriseAll.received, enterpriseAll.matched, enterpriseAll.notMatched, enterpriseAll.gaps], [7, 3, 3, 1]);
  const enterpriseTransport = await read("get_enterprise_alerts", { hazard: "transport" });
  assert.ok(enterpriseTransport.alerts.length === 3 && enterpriseTransport.alerts.every(item => item.hazard === "transport"));
  assert.equal(enterpriseTransport.alerts.find(item => item.id === "ERS-26-114-0031").result, "merged into SIG-BE-STRIKE-1124");
  console.log(`ok  watch team: ${WATCH_AGENTS.length} agents on ${WATCH_MODEL} with read-only tools; get_risk_signals filters by hazard and region; get_watch_brief gives sources, countries and gaps; get_enterprise_alerts gives what the enterprise risk system alerted and what ClinRadar made of it`);
}

// 5. Scripted runs on each kind of shipment.
const expectations = { "SHP-04": "swap-J-203", "SHP-01": "relabel-2026-11-16", "SHP-ES-09": "fix-data", "SHP-03": "escalate", "SHP-07": "proceed-confirm", "SHP-ES-05": "proceed-confirm", "SHP-IL-03": "swap-Q-815", "SHP-IL-01": "reroute-AMS" };
const saved = {};
for (const [shipment, recommended] of Object.entries(expectations)) {
  const run = await resolveShipment({ root, shipmentId: shipment, mode: "scripted", systems });
  assert.equal(run.error, undefined, run.error);
  assert.equal(run.resolution.recommended, recommended, JSON.stringify(run.resolution));
  assert.ok(run.resolution.options.every(option => option.title && option.actions.length), "every option has a title and actions");
  if (recommended === "escalate") assert.ok(run.verification.every(item => !item.passes), "an escalation means no option passes");
  else assert.ok(run.verification.find(item => item.id === recommended).passes, "the recommended option must pass ClinRadar's own verification");
  assert.ok(run.drafts.length >= 1 && run.drafts.every(draft => draft.executed === false && draft.option_id === recommended));
  saved[shipment] = run;
  console.log(`ok  scripted ${shipment}: ${run.events.length} steps, ${run.events.filter(e => e.type === "tool_call").length} MCP calls, ${run.drafts.length} draft${run.drafts.length === 1 ? "" : "s"}, recommends ${recommended}`);
}
// SHP-IL-01: the master agent asks the transport watch agent to confirm the strike before logistics looks for alternatives.
{
  const events = saved["SHP-IL-01"].events;
  const delegations = events.filter(event => event.type === "delegate");
  assert.equal(delegations[0].to, "transport", "the watch agent for the hazard is consulted first");
  assert.ok(events.indexOf(delegations[0]) < events.findIndex(event => event.type === "delegate" && event.to === "logistics"));
  assert.ok(events.some(event => event.agent === "transport" && event.type === "tool_call" && event.system === "ClinRadar" && event.input.hazard === "transport"));
  const confirmation = events.find(event => event.agent === "transport" && event.type === "report").text;
  assert.match(confirmation, /^Confirmed disruption, one day \(2026-11-24\)/);
  assert.match(confirmation, /two or more trusted sources/);
  assert.match(confirmation, /courier booking system confirmed SHP-IL-01's flight BRU → TLV on 2026-11-24 cancelled/);
  assert.match(confirmation, /SHP-03.*not affected/);
  console.log("ok  SHP-IL-01: the transport watch agent confirms the strike (one day, two trusted sources, courier-confirmed cancellation, SHP-03 not affected) before logistics finds the Amsterdam reroute");
}
await closeSystems(systems);

// 6. The portfolio: every shipment that needs action, most urgent first, with nothing promised twice.
const portfolio = await resolvePortfolio({ root, mode: "scripted", onShipment: run => writeFile(join(testCache, `agent-run-${run.shipment}.json`), JSON.stringify(run)) });
const { record: board, runs } = portfolio;
assert.equal(board.error, undefined, board.error);
assert.deepEqual({ shipments: board.summary.shipments, plans: board.summary.plans, escalated: board.summary.escalated, reallocated: board.summary.reallocated }, { shipments: 19, plans: 17, escalated: 2, reallocated: 2 });
assert.deepEqual(board.board.map(row => row.shipment).slice(0, 4), ["SHP-IL-01", "SHP-04", "SHP-01", "SHP-03"], "patients first (SHP-IL-01 runs out on 27 Nov), then by preparation date");
// Before triage, the master agent sends the four watch agents across the monitored countries.
{
  const events = board.events;
  const triageAt = events.findIndex(event => event.type === "triage");
  const before = events.slice(0, triageAt);
  assert.deepEqual(before.filter(event => event.type === "delegate").map(event => event.to), ["weather", "transport", "security", "regulatory"]);
  assert.deepEqual(before.filter(event => event.type === "report").map(event => event.agent), ["weather", "transport", "security", "regulatory"]);
  assert.ok(["weather", "transport", "security", "regulatory"].every(id => before.some(event => event.agent === id && event.type === "tool_call" && event.system === "ClinRadar")));
  assert.ok(!events.slice(triageAt).some(event => event.type === "delegate" && !event.nested && ["weather", "transport", "security", "regulatory"].includes(event.to)), "the sweep comes before triage");
  assert.match(before.find(event => event.agent === "transport" && event.type === "report").text, /^Strikes & transport: 4 events in 17 monitored countries; 1 confirmed disruption — SHP-IL-01's flight BRU → TLV on 24 Nov cancelled \(courier\); SHP-03 checked, not affected\./);
  assert.match(before.find(event => event.agent === "weather" && event.type === "report").text, /US depot \(Allentown, Pennsylvania\).*winter storm watch/);
  assert.ok(["weather", "transport", "security"].every(id => before.some(event => event.agent === id && event.type === "tool_call" && event.tool === "get_enterprise_alerts" && event.input.hazard === id)), "the watch agents read the enterprise alerts of their own kind");
  assert.match(before.find(event => event.agent === "transport" && event.type === "report").text, /Enterprise risk system: 3 alerts, 1 touches our network \(merged into SIG-BE-STRIKE-1124\), 1 coverage gap/);
  assert.equal(board.watch.find(item => item.agent === "weather").enterprise.matched, 2);
  assert.match(events[triageAt].text, /^Patients first: SHP-IL-01 runs out on 27 Nov \(14 patients\)/);
  assert.deepEqual(events[triageAt].patientsFirst, ["SHP-IL-01"]);
  assert.deepEqual(board.watch.map(item => [item.agent, item.name, item.hazard]), [["weather", "Weather & natural hazards", "weather"], ["transport", "Strikes & transport", "transport"], ["security", "Security & travel advice", "security"], ["regulatory", "Regulatory & customs", "regulatory"]]);
  assert.ok(board.watch.every(item => item.finding && Array.isArray(item.top) && item.countries > 0 && item.regions.length));
  assert.equal(board.watch.find(item => item.agent === "transport").top[0], "SIG-BE-STRIKE-1124");
  console.log("ok  portfolio watch sweep: weather, transport, security and regulatory report before triage; triage puts SHP-IL-01's patients first; the run record keeps the four findings");
}
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
await assert.rejects(approvePlan(root, { shipment: "SHP-06", option: firstChoice06.id, by: "P. Laine · Clinical Supply", runAt: runs["SHP-06"].at }), /does not pass ClinRadar's rules now.*SHP-01/);
await approvePlan(root, { shipment: "SHP-06", option: moved.recommended, by: "P. Laine · Clinical Supply", runAt: runs["SHP-06"].at });
await assert.rejects(approvePlan(root, { shipment: "SHP-04", option: "escalate", by: "P. Laine · Clinical Supply" }), /passes ClinRadar's rules now/);
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
// The orchestrator's system prompt is the ClinRadar master instructions plus its task, cached as one prefix.
const systemText = params => params.config.systemInstruction;
function standIn() {
  const turns = { orchestrator: 0, supply: 0 };
  const reply = (parts, finishReason = "STOP") => ({ candidates: [{ content: { role: "model", parts }, finishReason }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } });
  const use = (name, args) => ({ functionCall: { id: `t${Math.random().toString(36).slice(2, 8)}`, name, args }, thoughtSignature: "test-signature" });
  const plan = [{ type: "swap_batch", batch_id: "J-203" }, { type: "record_authorisation_route", authorisation_route: "old_rules" }];
  return {
    models: {
      async generateContent(params) {
        const who = systemText(params).includes("orchestrator") ? "orchestrator" : "supply";
        if (who === "orchestrator") {
          assert.match(params.config.systemInstruction, /Non-negotiable country-scope rule/, "the orchestrator works under the ClinRadar master instructions");
        } else assert.equal(typeof params.config.systemInstruction, "string", "specialists keep their short instructions");
        for (const content of params.contents.filter(item => item.role === "model")) {
          for (const part of content.parts.filter(item => item.functionCall)) assert.equal(part.thoughtSignature, "test-signature", "tool turns retain Gemini thought signatures");
        }
        for (const part of params.contents.flatMap(item => item.parts).filter(item => item.functionResponse)) {
          assert.ok(part.functionResponse.name && part.functionResponse.response.result, "tool results return Gemini function responses");
        }
        const step = turns[who]++;
        let message;
        if (who === "supply") {
          message = step === 0 ? reply([use("irt__get_depot_stock", { depot: "UK depot", product_id: "IMP-004" })]) : reply([{ text: "J-203: 48 kits, label v2." }], "STOP");
        } else {
          message = [
            reply([{ text: "Reading the checks." }, use("specs__get_shipment_checks", { shipment_id: "SHP-04" })]),
            reply([use("delegate_to_agent", { agent: "supply", task: "Find IMP-004 batches at the UK depot." })]),
            reply([use("specs__verify_option", { shipment_id: "SHP-04", actions: plan })]),
            // A draft for an option that will fail ClinRadar's check: it must come back withdrawn.
            reply([use("drafts__create_draft", { target_system: "IRT", kind: "Dispatch date change", shipment_id: "SHP-04", option_id: "B", title: "Delay", body: "Unverified." })]),
            reply([use("drafts__create_draft", { target_system: "IRT", kind: "Shipment change request", shipment_id: "SHP-04", option_id: "A", title: "Swap to J-203", body: "Verified." })]),
            reply([use("submit_resolution", { summary: "Swap to J-203.", root_cause: "Legacy label after the cutoff.", options: [{ id: "A", title: "Swap to J-203", actions: plan, why: "Updated label." }, { id: "B", title: "Delay to 2026-11-30", actions: [{ type: "delay", new_dispatch_date: "2026-11-30" }], why: "Time." }], recommended: "A" })]),
          ][step];
        }
        assert.ok(params.config.tools[0].functionDeclarations.every(tool => /^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)), "tool names must be valid");
        return message;
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

// 8b. The live watch sweep with a stand-in AI: each watch agent runs on the watch model, and its reads stay pinned to its
// own kind of hazard even when it asks for another.
{
  const { runWatchSweep } = await import("../regchain-ai/agent.mjs");
  const seen = [];
  const turns = {};
  const client = { models: { async generateContent(params) {
    const id = ["Weather & natural hazards", "Strikes & transport", "Security & travel advice", "Regulatory & customs"].find(name => params.config.systemInstruction.includes(`"${name}" watch agent`));
    seen.push({ id, model: params.model, tools: params.config.tools[0].functionDeclarations.map(tool => tool.name) });
    const step = (turns[id] = (turns[id] ?? 0) + 1);
    const parts = step === 1
      ? [{ functionCall: { id: `w${seen.length}`, name: "specs__get_watch_brief", args: { hazard: "security" } } }]
      : [{ text: `${id}: checked.` }];
    const message = { candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } };
    return message;
  } } };
  const sweepSystems = await connectSystems(root, ["specs"]);
  const record = { events: [], usage: { input_tokens: 0, output_tokens: 0 } };
  const sweepData = await loadData(root);
  const send = event => { record.events.push(event); return event; };
  const findings = await runWatchSweep({ root, data: sweepData, mode: "live", client, systems: sweepSystems, send, record });
  await closeSystems(sweepSystems);
  assert.deepEqual(findings.map(item => item.finding), ["Weather & natural hazards: checked.", "Strikes & transport: checked.", "Security & travel advice: checked.", "Regulatory & customs: checked."]);
  assert.ok(seen.every(item => item.model === "gemini-3.5-flash-lite"), "the configured watch model");
  assert.deepEqual(record.events.filter(event => event.type === "tool_call").map(event => event.input.hazard), ["weather", "transport", "security", "regulatory"], "each watch agent reads only its own hazard");
  assert.ok(!seen.some(item => item.tools.includes("delegate_to_agent") || item.tools.includes("drafts__create_draft")), "watch agents cannot delegate or draft");
  assert.ok(findings.every(item => item.model === "gemini-3.5-flash-lite"));
  console.log("ok  live watch sweep (stand-in AI): four watch agents on gemini-3.5-flash-lite, reads pinned to their own hazard, no delegation or drafts");
}

// 9. Gemini setup, credentials and SDK construction, without a network call.
{
  const { geminiSettings, geminiStatus, setupMessage, createGemini, credentialsRefused, responseParts, tokenUsage, DEFAULT_MODELS } = await import("../regchain-ai/gemini.mjs");
  const plain = geminiSettings({ GEMINI_API_KEY: "test" });
  assert.equal(plain.provider, "gemini");
  assert.ok(plain.configured);
  assert.deepEqual(plain.models, DEFAULT_MODELS);
  assert.equal(geminiSettings({ GEMINI_API_KEY: "test", REGCHAIN_MODEL_WATCH: "gemini-custom" }).models.watch, "gemini-custom");
  assert.match(geminiSettings({ GEMINI_API_KEY: "test", REGCHAIN_MODEL_WATCH: "other-model" }).problems[0], /Gemini models only/);
  assert.equal(setupMessage(geminiSettings({}), true), "Add GEMINI_API_KEY to the .env file next to serve-regchain.cjs, then restart RegChain.");
  assert.ok(!geminiSettings({ GEMINI_API_KEY: " " }).configured);
  assert.match(geminiSettings({ REGCHAIN_AI_PROVIDER: "bedrock" }).problems[0], /must be "gemini"/);
  assert.match(credentialsRefused({ status: 401 }), /Gemini API key was not accepted/);
  assert.match(credentialsRefused({ status: 403 }), /Gemini API key was not accepted/);
  assert.match(credentialsRefused({ status: 400, message: "API key not valid" }), /Gemini API key was not accepted/);
  assert.equal(credentialsRefused({ status: 500 }), null);
  await assert.rejects(createGemini({ env: {} }), /Add GEMINI_API_KEY/);
  await assert.rejects(createGemini({ env: { GEMINI_API_KEY: "test" }, load: async () => { throw new Error("not installed"); } }), /Run npm install/);
  let options;
  await createGemini({ env: { GEMINI_API_KEY: " test " }, load: async name => {
    assert.equal(name, "@google/genai");
    return { GoogleGenAI: class { constructor(config) { options = config; } } };
  } });
  assert.equal(options.apiKey, "test");
  assert.equal(options.vertexai, false);
  assert.ok(!JSON.stringify(geminiStatus({ GEMINI_API_KEY: "secret-test-key" })).includes("secret-test-key"));
  assert.throws(() => responseParts({ candidates: [{ finishReason: "MAX_TOKENS" }] }), /cut off/);
  assert.throws(() => responseParts({ promptFeedback: { blockReason: "SAFETY" } }), /declined/);
  assert.throws(() => responseParts({ candidates: [{ finishReason: "SAFETY" }] }), /declined/);
  assert.throws(() => responseParts({}), /no answer/);
  assert.deepEqual(tokenUsage({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 3, cachedContentTokenCount: 2 } }), { input_tokens: 10, output_tokens: 8, cache_read_input_tokens: 2 });
  console.log("ok  Gemini configuration, key validation, SDK construction, blocked/truncated replies and usage accounting");
}

// 10. Exercise the actual Google SDK serializer with an in-memory HTTP transport.
{
  const { GoogleGenAI } = await import("@google/genai");
  const { draftChange } = await import("../regchain-ai/analyze.mjs");
  const requests = [];
  const client = new GoogleGenAI({ apiKey: "transport-test-key", vertexai: false, httpOptions: { fetch: async (url, options) => {
    assert.ok(String(url).startsWith("https://generativelanguage.googleapis.com/"));
    assert.equal(new Headers(options.headers).get("x-goog-api-key"), "transport-test-key");
    const body = JSON.parse(options.body);
    requests.push(body);
    const parts = body.generationConfig?.responseMimeType === "application/json"
      ? [{ text: JSON.stringify({ summary: "SDK transport test" }) }]
      : requests.length === 2
        ? [{ functionCall: { name: "specs__get_shipment_checks", args: { shipment_id: "SHP-04" } }, thoughtSignature: "transport-signature" }]
        : [{ functionCall: { name: "submit_resolution", args: { summary: "Needs expert review.", root_cause: "Transport test.", options: [], recommended: "escalate" } } }];
    return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }], modelVersion: "gemini-transport-test", usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 4 } }), { headers: { "content-type": "application/json" } });
  } } });
  const sources = [{ id: "v1", role: "before", text: "Old text." }, { id: "v2", role: "after", text: "New text." }];
  const checked = await draftChange(sources, { client });
  assert.equal(checked.model, "gemini-transport-test");
  assert.equal(checked.draft.summary, "SDK transport test");
  assert.equal(checked.usage.input_tokens, 7);
  assert.deepEqual(requests[0].generationConfig.responseJsonSchema.properties.claims.items.properties.sourceId.enum, ["v1", "v2"]);
  assert.ok(requests[0].systemInstruction.parts[0].text.includes("Regulatory Affairs"));
  const run = await resolveShipment({ root, shipmentId: "SHP-04", mode: "live", client });
  assert.equal(run.error, undefined, run.error);
  assert.ok(requests[1].tools[0].functionDeclarations.some(tool => tool.name === "delegate_to_agent" && tool.parametersJsonSchema));
  assert.ok(requests[1].contents[0].parts[0].text.includes("SHP-04"));
  assert.equal(requests[2].contents[1].parts[0].thoughtSignature, "transport-signature");
  assert.equal(requests[2].contents[2].parts[0].functionResponse.name, "specs__get_shipment_checks");
  assert.ok(requests[2].contents[2].parts[0].functionResponse.response.result);
  console.log("ok  Google SDK HTTP serialization: API key header, source schema, system prompt and agent function declarations");
}

(await import("../regchain-ai/db.mjs")).closeDatabase(root);
await rm(testCache, { recursive: true, force: true });
if (process.argv.includes("--save")) {
  await mkdir(realCache, { recursive: true });
  for (const [shipment, run] of Object.entries(saved)) await writeFile(join(realCache, `agent-run-${shipment}.json`), JSON.stringify(run, null, 2));
  console.log(`saved ${Object.keys(saved).length} scripted runs to ${realCache}`);
}
console.log("All agent checks passed.");
