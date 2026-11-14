// Agentic resolution of a blocked shipment.
// An orchestrator agent (Claude) plans, delegates to specialist agents, reads the company's systems through MCP servers,
// verifies every option with fixed rules, and prepares drafts for people to approve. It never changes a validated record.
// "scripted" mode follows the same steps with coded decisions and no AI call, for tests and when no API key is set.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";
import { loadData, verifyOption, businessDaysAfter } from "./rules.mjs";

export const ORCHESTRATOR_MODEL = "claude-opus-5-5";
export const SPECIALIST_MODEL = "claude-sonnet-5-5";
export const SYSTEM_NAMES = { specs: "RegChain", irt: "IRT", erp: "ERP", depot: "Depot", etmf: "eTMF", drafts: "Draft inbox" };
const LIMITS = { orchestratorTurns: 16, specialistTurns: 8, toolCalls: 60 };

export const AGENTS = {
  orchestrator: {
    name: "Orchestrator", model: ORCHESTRATOR_MODEL,
    tools: ["specs__get_shipment_checks", "specs__get_country_specification", "specs__verify_option", "drafts__create_draft"],
    system: `You are the RegChain orchestrator for a clinical supply team. Your goal: make one planned investigational medicinal product (IMP) shipment compliant with its destination's Country Specification and on time, or escalate it to the right person.
You work through tools connected over MCP to the company's systems. The validated systems (IRT, ERP, depot, eTMF) are read-only to you. You cannot change any record. The only thing you can create is a draft in the draft inbox, which a qualified person approves in the target system.
How to work:
1. Read the shipment's checks with specs__get_shipment_checks to see what blocks it.
2. Delegate fact-finding with delegate_to_agent: "supply" (stock, batches, QP release plans), "logistics" (relabelling slots, label approvals, site stock, couriers), "records" (trial authorisation records and site contacts in the eTMF), "communications" (short messages in English and the local language). Give each a precise task with ids.
3. Build two or three options. An option is a list of actions: swap_batch, relabel, delay, record_authorisation_route, book_qp_release, obtain_pharmacy_code, create_label_specification, proceed.
4. Verify every option with specs__verify_option. Recommend only an option that passes. If none passes, recommend escalation and say who must decide.
5. For the recommended option, create the drafts a person must approve with drafts__create_draft, one per target system.
6. Finish by calling submit_resolution.
Rules: use only facts from tool results. Never state that anything was done or approved. Write dates as YYYY-MM-DD. Be brief.`,
  },
  supply: {
    name: "Supply agent", model: SPECIALIST_MODEL,
    tools: ["irt__get_shipment", "irt__get_depot_stock", "erp__get_batches", "erp__get_batch", "erp__get_qp_plan"],
    system: "You are the supply specialist. Using IRT and ERP, which are read-only, answer the task with facts: batches of the same product in stock at the shipment's depot, with kits, QP dates and label versions, and QP release plans. Reply in at most six short lines with ids, numbers and dates. You cannot change anything.",
  },
  logistics: {
    name: "Logistics agent", model: SPECIALIST_MODEL,
    tools: ["irt__get_shipment", "irt__get_site_stock", "depot__get_relabel_capacity", "depot__get_courier_options", "erp__get_label_approval"],
    system: "You are the logistics specialist. Using the depot system, ERP label approvals and IRT site stock, all read-only, answer the task with facts: relabelling slots and turnaround, label approval status, days of stock at the site, courier transit and weekend operation. Reply in at most six short lines. You cannot change anything.",
  },
  records: {
    name: "Records agent", model: SPECIALIST_MODEL,
    tools: ["etmf__get_trial_authorisation", "etmf__get_site_contact", "irt__get_shipment"],
    system: "You are the records specialist. Using the eTMF, which is read-only, find trial authorisation records and site contacts. Say what IRT records and what the eTMF holds, with document references. Reply in at most five short lines. You cannot change anything.",
  },
  communications: {
    name: "Communications agent", model: SPECIALIST_MODEL,
    tools: ["specs__get_country_specification"],
    system: "You draft short, clear messages for approvers or trial sites, in English and, for sites outside English-speaking countries, also in the local language. Use only the facts in the task. Return the text only; you do not send anything.",
  },
};

const DELEGATE_TOOL = {
  name: "delegate_to_agent",
  description: "Ask a specialist agent to find facts or draft text. Returns the specialist's answer.",
  input_schema: { type: "object", properties: { agent: { type: "string", enum: ["supply", "logistics", "records", "communications"] }, task: { type: "string" } }, required: ["agent", "task"] },
};
const ACTION_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["swap_batch", "relabel", "delay", "record_authorisation_route", "book_qp_release", "obtain_pharmacy_code", "create_label_specification", "proceed"] },
    batch_id: { type: "string" }, relabel_date: { type: "string" }, new_dispatch_date: { type: "string" }, authorisation_route: { type: "string" }, qp_date: { type: "string" },
  },
  required: ["type"],
};
const SUBMIT_TOOL = {
  name: "submit_resolution",
  description: "Submit the final resolution: the root cause, two or three verified options, the recommended option (or escalation) and the draft ids created.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string" }, root_cause: { type: "string" },
      options: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, actions: { type: "array", items: ACTION_SCHEMA }, why: { type: "string" }, risks: { type: "string" } }, required: ["id", "title", "actions", "why"] } },
      recommended: { type: "string", description: "The id of the recommended option, or 'escalate'." },
      escalation: { type: "string" },
      draft_ids: { type: "array", items: { type: "string" } },
    },
    required: ["summary", "root_cause", "options", "recommended"],
  },
};

// Start one MCP server per system and connect to each as an MCP client.
export async function connectSystems(root) {
  const systems = {};
  for (const system of Object.keys(SYSTEM_NAMES)) {
    const client = new Client({ name: "regchain-orchestrator", version: "0.1.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, "regchain-ai", "mcp-servers.mjs"), system], cwd: root, stderr: "ignore" }));
    const { tools } = await client.listTools();
    systems[system] = { client, tools };
  }
  return systems;
}
export async function closeSystems(systems) {
  await Promise.all(Object.values(systems).map(({ client }) => client.close().catch(() => {})));
}
export function describeSystems(systems) {
  return Object.entries(systems).map(([id, { tools }]) => ({ id, name: SYSTEM_NAMES[id], tools: tools.map(tool => ({ name: tool.name, readOnly: Boolean(tool.annotations?.readOnlyHint) })) }));
}

function toolDefinitions(systems, names) {
  return names.map(name => {
    const [system, tool] = name.split("__");
    const definition = systems[system].tools.find(item => item.name === tool);
    return { name, description: `[${SYSTEM_NAMES[system]}${definition.annotations?.readOnlyHint ? ", read-only" : ", draft-only"}] ${definition.description}`, input_schema: definition.inputSchema };
  });
}
const shortText = (text, size = 420) => (text.length > size ? text.slice(0, size - 1) + "…" : text);

// One run: resolve one shipment. `emit` receives each step as it happens.
export async function resolveShipment({ root, shipmentId, mode = "live", client, emit = () => {}, systems: given }) {
  const data = await loadData(root);
  const systems = given ?? await connectSystems(root);
  const record = { at: new Date().toISOString(), shipment: shipmentId, mode, models: mode === "live" ? { orchestrator: ORCHESTRATOR_MODEL, specialists: SPECIALIST_MODEL } : null,
    systems: describeSystems(systems), events: [], drafts: [], usage: { input_tokens: 0, output_tokens: 0 }, resolution: null, verification: [] };
  let seq = 0;
  let toolCalls = 0;
  const send = event => {
    const full = { seq: ++seq, at: new Date().toISOString(), ...event };
    record.events.push(full);
    emit(full);
  };
  // Every MCP call goes through here, so each one is logged with its agent, system, input and result.
  const call = async (agent, system, tool, input) => {
    if (++toolCalls > LIMITS.toolCalls) throw new Error("The run reached its limit of tool calls.");
    send({ agent, type: "tool_call", system: SYSTEM_NAMES[system], tool, input });
    const result = await systems[system].client.callTool({ name: tool, arguments: input });
    const text = result.content?.map(part => part.text ?? "").join("") ?? "";
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    if (system === "drafts" && parsed?.draft_id) {
      record.drafts.push(parsed);
      send({ agent, type: "draft", system: SYSTEM_NAMES.drafts, text: `${parsed.draft_id}: ${parsed.title} · ${parsed.status}` });
    } else {
      send({ agent, type: "tool_result", system: SYSTEM_NAMES[system], tool, text: shortText(text.replace(/\s+/g, " ")) });
    }
    return { text, parsed };
  };
  try {
    if (mode === "live") await liveRun({ shipmentId, client, systems, call, send, record });
    else await scriptedRun({ shipmentId, data, call, send, record });
    // RegChain verifies every option itself, whatever the agents said.
    record.verification = (record.resolution?.options ?? []).map(option => ({ id: option.id, ...verifyOption(data, shipmentId, option.actions) }));
    send({ agent: "verifier", type: "verified", text: record.verification.map(item => `${item.id}: ${item.passes ? "passes" : "does not pass"} (${({ Ready: "ready to ship", Confirm: "confirm before dispatch", Blocked: "still blocked" })[item.after] ?? item.after}${item.feasible ? "" : ", not feasible"})`).join(" · ") || "No options to verify." });
  } catch (error) {
    send({ agent: "orchestrator", type: "error", text: error.message });
    record.error = error.message;
  } finally {
    if (!given) await closeSystems(systems);
  }
  send({ agent: "orchestrator", type: "done", text: record.error ? "The run stopped." : "Resolution ready for approval." });
  return record;
}

async function liveRun({ shipmentId, client, systems, call, send, record }) {
  const api = client ?? new (await import("@anthropic-ai/sdk")).default();
  const loop = async (agentId, task) => {
    const agent = AGENTS[agentId];
    const isOrchestrator = agentId === "orchestrator";
    const tools = [...toolDefinitions(systems, agent.tools), ...(isOrchestrator ? [DELEGATE_TOOL, SUBMIT_TOOL] : [])];
    const messages = [{ role: "user", content: task }];
    for (let turn = 0; turn < (isOrchestrator ? LIMITS.orchestratorTurns : LIMITS.specialistTurns); turn++) {
      const stream = api.messages.stream({ model: agent.model, max_tokens: 8000, thinking: { type: "adaptive" }, system: agent.system, tools, messages });
      const message = await stream.finalMessage();
      record.usage.input_tokens += message.usage?.input_tokens ?? 0;
      record.usage.output_tokens += message.usage?.output_tokens ?? 0;
      const text = message.content.filter(block => block.type === "text").map(block => block.text).join("").trim();
      if (message.stop_reason === "refusal") throw new Error(`${agent.name} declined the request.`);
      if (message.stop_reason === "max_tokens") throw new Error(`${agent.name}'s answer was cut off.`);
      const uses = message.content.filter(block => block.type === "tool_use");
      if (text && (isOrchestrator || !uses.length)) send({ agent: agentId, type: "message", text: shortText(text, 900) });
      if (!uses.length) return text;
      messages.push({ role: "assistant", content: message.content });
      const results = [];
      for (const use of uses) {
        if (use.name === "submit_resolution") {
          record.resolution = use.input;
          send({ agent: agentId, type: "resolution", text: use.input.summary });
          return use.input;
        }
        let content;
        if (use.name === "delegate_to_agent") {
          send({ agent: agentId, type: "delegate", to: use.input.agent, text: use.input.task });
          content = await loop(use.input.agent, use.input.task);
          send({ agent: use.input.agent, type: "report", text: shortText(String(content), 900) });
        } else {
          const [system, tool] = use.name.split("__");
          if (!agent.tools.includes(use.name)) content = JSON.stringify({ error: "This tool is not available to this agent." });
          else content = (await call(agentId, system, tool, use.input)).text;
        }
        results.push({ type: "tool_result", tool_use_id: use.id, content: String(content) });
      }
      messages.push({ role: "user", content: results });
    }
    throw new Error(`${agent.name} reached its step limit.`);
  };
  send({ agent: "orchestrator", type: "goal", text: `Make ${shipmentId} compliant with its destination's Country Specification and on time, or escalate it.` });
  await loop("orchestrator", `Resolve shipment ${shipmentId}. Today is 2026-11-14.`);
  if (!record.resolution) throw new Error("The orchestrator finished without a resolution.");
}

// The same steps with coded decisions and no AI call.
// Plain words for each action, for the drafts people read in their own systems.
const actionText = action => ({
  swap_batch: `Ship batch ${action.batch_id} instead`,
  relabel: `Relabel the batch at the depot on ${action.relabel_date}`,
  delay: `Move the dispatch to ${action.new_dispatch_date}`,
  record_authorisation_route: `Record the trial's authorisation route as ${String(action.authorisation_route).replace("_", " ")}`,
  book_qp_release: `Book the QP release for ${action.qp_date}`,
  obtain_pharmacy_code: "Ask the site for its hospital pharmacy code",
  create_label_specification: "Start the label specification",
  proceed: "Proceed as planned",
}[action.type] ?? action.type);

async function scriptedRun({ shipmentId, data, call, send, record }) {
  let siteMessage = "";
  const say = (agent, text) => send({ agent, type: "message", text });
  const delegate = (to, text) => send({ agent: "orchestrator", type: "delegate", to, text });
  const report = (agent, text) => send({ agent, type: "report", text });
  send({ agent: "orchestrator", type: "goal", text: `Make ${shipmentId} compliant with its destination's Country Specification and on time, or escalate it.` });
  const { parsed: checks } = await call("orchestrator", "specs", "get_shipment_checks", { shipment_id: shipmentId });
  const view = checks.shipment;
  const blocking = checks.checks.filter(item => ["Fail", "Missing", "Decision"].includes(item.result));
  say("orchestrator", blocking.length ? `${shipmentId} is blocked by: ${blocking.map(item => item.detail).join(" ")}` : `${shipmentId} is not blocked; checking what needs confirming.`);
  const options = [];
  const has = section => blocking.some(item => item.section === section);
  if (view.countryId === "uk") {
    let route = null;
    if (has("permits")) {
      delegate("records", `Find the authorisation record for ${view.trial} in GB and compare it with IRT.`);
      const { parsed: auth } = await call("records", "etmf", "get_trial_authorisation", { trial_id: view.trial, country: "GB" });
      if (auth?.route && auth.route !== "unknown") route = { type: "record_authorisation_route", authorisation_route: auth.route };
      report("records", auth?.route ? `IRT records "${auth.irtRecord}", but the eTMF holds ${auth.document} (${auth.reference}): ${auth.route.replace("_", " ")}.` : "No authorisation record in the eTMF.");
    }
    const { parsed: batch } = await call("supply", "erp", "get_batch", { batch_id: view.batch });
    if (has("regulatory") || has("import")) {
      delegate("supply", `Find batches of ${batch.product} at the ${view.depot} that could replace ${view.batch} for ${view.kits} kits.`);
      const { parsed: stock } = await call("supply", "irt", "get_depot_stock", { depot: view.depot, product_id: batch.product });
      const candidates = stock.filter(item => item.batch !== view.batch && item.kits >= view.kits && item.qp_certified && item.label && (!item.label.legacy || item.qp_certified < data.ukEffective)).slice(0, 2);
      report("supply", candidates.length ? candidates.map(item => `${item.batch}: ${item.kits} kits, QP ${item.qp_certified}, label v${item.label.version}${item.label.legacy ? " (legacy, pre-cutoff)" : " (updated)"}`).join("; ") : `No other batch of ${batch.product} with enough kits and a compliant label.`);
      for (const item of candidates) options.push({ id: `swap-${item.batch}`, title: `Swap to batch ${item.batch}${route ? " and record the authorisation route" : ""}`, actions: [{ type: "swap_batch", batch_id: item.batch }, ...(route ? [route] : [])],
        why: `${item.batch} has ${item.kits} kits at the ${view.depot} and a${item.label.legacy ? " pre-cutoff" : "n updated"} label.`, risks: "The site receives a different batch number; IRT must reassign the kits." });
    }
    if (has("regulatory")) {
      delegate("logistics", `Check relabelling for ${view.batch} (${batch.product}) at the ${view.depot}, the label approval and the stock at ${view.siteId}.`);
      const { parsed: approval } = await call("logistics", "erp", "get_label_approval", { product_id: batch.product, country: "UK" });
      const { parsed: capacity } = await call("logistics", "depot", "get_relabel_capacity", { depot: view.depot });
      const { parsed: site } = await call("logistics", "irt", "get_site_stock", { site_id: view.siteId });
      const slot = capacity.slots?.find(item => item.kits >= view.kits && item.date >= data.today);
      report("logistics", `Updated UK label for ${batch.product}: ${approval.status}${approval.expected ? ", expected " + approval.expected : ""}. Next slot: ${slot ? slot.date + " (" + slot.kits + " kits)" : "none"}; turnaround ${capacity.turnaroundBusinessDays} business day. Site stock: ${site.days_of_supply} days.`);
      if (slot) options.push({ id: `relabel-${slot.date}`, title: `Relabel ${view.batch} on ${slot.date}${route ? " and record the authorisation route" : ""}`, actions: [{ type: "relabel", relabel_date: slot.date }, ...(route ? [route] : [])],
        why: "Keeps the planned batch; the depot applies the approved updated label.", risks: "Relabelling needs QA release before dispatch." });
      const delayTo = businessDaysAfter(view.dispatch, 3);
      options.push({ id: "delay", title: `Delay dispatch to ${delayTo}`, actions: [{ type: "delay", new_dispatch_date: delayTo }], why: "Buys time for a decision.", risks: "The site runs down its stock." });
    }
  } else if (view.countryId === "es") {
    const actions = [];
    if (has("import")) {
      delegate("supply", `Check the QP release plan for batch ${view.batch}.`);
      const { parsed: plan } = await call("supply", "erp", "get_qp_plan", { batch_id: view.batch });
      report("supply", `Batch ${view.batch}: ${plan.status}; earliest QP release ${plan.earliestRelease} at the ${plan.qpSite}.`);
      if (plan.earliestRelease) actions.push({ type: "book_qp_release", qp_date: plan.earliestRelease });
    }
    if (has("invoice")) {
      delegate("records", `Find the contact for ${view.siteId} to obtain its hospital pharmacy code.`);
      const { parsed: contact } = await call("records", "etmf", "get_site_contact", { site_id: view.siteId });
      report("records", `${contact.contact}, via the ${contact.channel}; usually answers in ${contact.typicalResponseBusinessDays} business days.`);
      actions.push({ type: "obtain_pharmacy_code" });
      delegate("communications", `Draft a short request, in Spanish and English, asking ${contact.contact} for its hospital pharmacy code for the new delivery notes.`);
      siteMessage = "ES: Necesitamos el código del servicio de farmacia del hospital para los albaranes de entrega en español que se exigen desde el 1 de marzo de 2027. ¿Pueden facilitárnoslo? · EN: We need your hospital pharmacy code for the Spanish delivery notes required from 1 March 2027. Could you send it to us?";
      report("communications", siteMessage);
    }
    options.push({ id: "fix-data", title: actions.map(item => item.type === "book_qp_release" ? `Book the QP release on ${item.qp_date}` : "Obtain the pharmacy code").join(" and "), actions, why: "Fixes the missing data before the preparation date.", risks: "Depends on the QP slot and the site's answer." });
    options.push({ id: "hold", title: "Hold the shipment", actions: [{ type: "proceed" }], why: "Shown for comparison.", risks: "Leaves the shipment blocked." });
  } else {
    const { parsed: batch } = await call("supply", "erp", "get_batch", { batch_id: view.batch });
    delegate("logistics", `Check the ${view.countryId.toUpperCase()} label specification for ${batch.product} and the stock at ${view.siteId}.`);
    const { parsed: approval } = await call("logistics", "erp", "get_label_approval", { product_id: batch.product, country: view.countryId.toUpperCase() });
    const { parsed: site } = await call("logistics", "irt", "get_site_stock", { site_id: view.siteId });
    report("logistics", `${view.countryId.toUpperCase()} label specification for ${batch.product}: ${approval.status}${approval.leadBusinessDays ? ", " + approval.leadBusinessDays + " business days" : ""}. Site stock: ${site.days_of_supply} days.`);
    options.push({ id: "label-spec", title: "Create the label specification", actions: [{ type: "create_label_specification" }], why: "The missing specification is the only block.", risks: "Lead time." });
    if (approval.leadBusinessDays) {
      const ready = businessDaysAfter(data.today, approval.leadBusinessDays);
      const delayTo = businessDaysAfter(ready, 1);
      options.push({ id: "label-spec-delay", title: `Create the label specification and dispatch on ${delayTo}`, actions: [{ type: "create_label_specification" }, { type: "delay", new_dispatch_date: delayTo }], why: "Waits for the specification.", risks: `The site has ${site.days_of_supply} days of stock.` });
    }
  }
  // Verify each option, as the live orchestrator must.
  for (const option of options) {
    const { parsed } = await call("orchestrator", "specs", "verify_option", { shipment_id: shipmentId, actions: option.actions });
    option.passes = parsed.passes;
  }
  const passing = options.filter(option => option.passes);
  const recommended = passing.sort((a, b) => a.actions.some(item => item.type === "delay") - b.actions.some(item => item.type === "delay"))[0];
  if (recommended) {
    const targets = { swap_batch: ["IRT", "Shipment change request"], relabel: ["Depot", "Relabelling work order"], delay: ["IRT", "Dispatch date change"], record_authorisation_route: ["IRT", "Record correction"],
      book_qp_release: ["ERP", "QP slot booking"], obtain_pharmacy_code: ["Site portal", "Request for the pharmacy code"], create_label_specification: ["QMS", "Label specification request"] };
    for (const action of recommended.actions.filter(item => targets[item.type])) {
      const [target, kind] = targets[action.type];
      await call("orchestrator", "drafts", "create_draft", { target_system: target, kind, shipment_id: shipmentId, title: `${kind} for ${shipmentId}`,
        body: `${actionText(action)}. Part of the plan "${recommended.title}", checked against RegChain's rules on ${data.today}. A person approves it in ${target}.${action.type === "obtain_pharmacy_code" && siteMessage ? " Message: " + siteMessage : ""}` });
    }
  } else {
    await call("orchestrator", "drafts", "create_draft", { target_system: "QMS", kind: "Escalation", shipment_id: shipmentId, title: `Escalation for ${shipmentId}`,
      body: `No option passes RegChain's rules: ${options.map(option => option.title).join("; ")}. Regulatory Affairs and Clinical Supply decide whether to delay, split or cancel the shipment.` });
  }
  record.resolution = {
    summary: recommended ? `Recommended: ${recommended.title}.` : "No option passes; escalate.",
    root_cause: blocking.map(item => item.detail).join(" ") || "Nothing blocks the shipment.",
    options: options.map(({ passes, ...option }) => option),
    recommended: recommended?.id ?? "escalate",
    escalation: recommended ? "" : "Regulatory Affairs and Clinical Supply decide whether to delay or cancel the shipment.",
    draft_ids: record.drafts.map(item => item.draft_id),
  };
  send({ agent: "orchestrator", type: "resolution", text: record.resolution.summary });
}
