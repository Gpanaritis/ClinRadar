// Checks the agent layer without calling the Anthropic API:
// the rules match the dashboard, the six MCP servers start and answer, the scripted run resolves three
// different blocked shipments, and the live loop works end to end with a stand-in AI client.
// Usage: node scripts/check-agent.mjs [--save]   (--save writes the scripted runs as recorded results, for UI testing)

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadData, allShipmentChecks, verifyOption } from "../regchain-ai/rules.mjs";
import { connectSystems, closeSystems, describeSystems, resolveShipment } from "../regchain-ai/agent.mjs";
import { cacheDir } from "../regchain-ai/sources.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = await loadData(root);

// 1. The same results as the dashboard's Shipment checks page.
const by = result => allShipmentChecks(data).filter(item => item.result === result).map(item => item.id).sort();
assert.deepEqual(by("Blocked"), ["SHP-01", "SHP-02", "SHP-03", "SHP-04", "SHP-05", "SHP-06", "SHP-08", "SHP-10", "SHP-ES-08", "SHP-ES-09", "SHP-ES-10"]);
assert.deepEqual(by("Confirm"), ["SHP-07", "SHP-09", "SHP-ES-05", "SHP-ES-06", "SHP-ES-07"]);
assert.deepEqual(by("Ready"), ["SHP-ES-01", "SHP-ES-02", "SHP-ES-03", "SHP-ES-04"]);
console.log("ok  rules: 11 blocked, 5 to confirm, 4 ready, as on the Shipment checks page");

// 2. The verifier is strict: a partial fix does not pass, an infeasible one does not pass.
assert.equal(verifyOption(data, "SHP-04", [{ type: "relabel", relabel_date: "2026-11-16" }]).passes, false);
assert.equal(verifyOption(data, "SHP-04", [{ type: "swap_batch", batch_id: "J-203" }, { type: "record_authorisation_route", authorisation_route: "old_rules" }]).passes, true);
assert.equal(verifyOption(data, "SHP-04", [{ type: "delay", new_dispatch_date: "2026-11-26" }]).feasible, false);
assert.equal(verifyOption(data, "SHP-05", [{ type: "relabel", relabel_date: "2026-11-18" }]).feasible, false);
console.log("ok  verifier: partial and infeasible options fail; swap J-203 plus the eTMF route passes");

// 3. Six MCP servers; only the draft inbox can create anything.
const systems = await connectSystems(root);
const described = describeSystems(systems);
assert.equal(described.length, 6);
const writers = described.flatMap(system => system.tools.filter(tool => !tool.readOnly).map(tool => `${system.id}.${tool.name}`));
assert.deepEqual(writers, ["drafts.create_draft"]);
console.log(`ok  MCP: ${described.map(system => `${system.name} (${system.tools.length})`).join(", ")}; only drafts.create_draft writes, and only drafts`);

// 4. Scripted runs on three kinds of block.
// SHP-03 must be escalated: the German label specification takes 15 business days and the site has 7 days of stock.
const expectations = { "SHP-04": "swap-J-203", "SHP-ES-09": "fix-data", "SHP-03": "escalate" };
const saved = {};
for (const [shipment, recommended] of Object.entries(expectations)) {
  const run = await resolveShipment({ root, shipmentId: shipment, mode: "scripted", systems });
  assert.equal(run.error, undefined, run.error);
  assert.equal(run.resolution.recommended, recommended, JSON.stringify(run.resolution));
  if (recommended === "escalate") assert.ok(run.verification.every(item => !item.passes), "an escalation means no option passes");
  else assert.ok(run.verification.find(item => item.id === recommended).passes, "the recommended option must pass RegChain's own verification");
  assert.ok(run.drafts.length >= 1 && run.drafts.every(draft => draft.executed === false));
  saved[shipment] = run;
  console.log(`ok  scripted ${shipment}: ${run.events.length} steps, ${run.events.filter(e => e.type === "tool_call").length} MCP calls, ${run.drafts.length} draft${run.drafts.length === 1 ? "" : "s"}, recommends ${recommended}`);
}

// 5. The live loop with a stand-in AI client: delegation, MCP calls, verification, a draft and the resolution.
function standIn() {
  const turns = { orchestrator: 0, supply: 0 };
  const reply = (content, stop_reason = "tool_use") => ({ content, stop_reason, usage: { input_tokens: 10, output_tokens: 5 } });
  const use = (name, input) => ({ type: "tool_use", id: `t${Math.random().toString(36).slice(2, 8)}`, name, input });
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
            reply([use("specs__verify_option", { shipment_id: "SHP-04", actions: [{ type: "swap_batch", batch_id: "J-203" }, { type: "record_authorisation_route", authorisation_route: "old_rules" }] })]),
            reply([use("drafts__create_draft", { target_system: "IRT", kind: "Shipment change request", shipment_id: "SHP-04", title: "Swap to J-203", body: "Verified." })]),
            reply([use("submit_resolution", { summary: "Swap to J-203.", root_cause: "Legacy label after the cutoff.", options: [{ id: "A", title: "Swap to J-203", actions: [{ type: "swap_batch", batch_id: "J-203" }, { type: "record_authorisation_route", authorisation_route: "old_rules" }], why: "Updated label." }], recommended: "A" })]),
          ][step];
        }
        assert.ok(params.tools.every(tool => /^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)), "tool names must be valid");
        return { finalMessage: async () => message };
      },
    },
  };
}
const live = await resolveShipment({ root, shipmentId: "SHP-04", mode: "live", client: standIn(), systems });
assert.equal(live.error, undefined, live.error);
assert.ok(live.events.some(event => event.type === "delegate" && event.to === "supply"));
assert.ok(live.events.some(event => event.agent === "supply" && event.type === "tool_call" && event.system === "IRT"));
assert.equal(live.verification[0].passes, true);
assert.equal(live.drafts.length, 1);
console.log(`ok  live loop (stand-in AI): ${live.events.length} steps, delegation to the supply agent, MCP calls, verification and a draft`);

await closeSystems(systems);
if (process.argv.includes("--save")) {
  const dir = cacheDir(root);
  await mkdir(dir, { recursive: true });
  for (const [shipment, run] of Object.entries(saved)) await writeFile(join(dir, `agent-run-${shipment}.json`), JSON.stringify(run, null, 2));
  console.log(`saved ${Object.keys(saved).length} scripted runs to ${dir}`);
}
console.log("All agent checks passed.");
