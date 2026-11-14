// MCP servers for the RegChain agents, one per system: node regchain-ai/mcp-servers.mjs <system>
// Validated systems (IRT, ERP, depot, eTMF) expose read-only tools. The draft inbox only creates drafts:
// nothing here changes a validated record, and every draft needs approval in its own system.
// The data is the fictional demo data in demo-data/. In production each server would sit in front of the real system.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadData, checkShipment, allShipmentChecks, verifyOption, shipmentView, sectionNames } from "./rules.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SYSTEMS = {
  specs: "RegChain Country Specifications and shipment checks",
  irt: "IRT/RTSM (validated, read-only)",
  erp: "ERP batch records (validated, read-only)",
  depot: "Depot and labelling (validated, read-only)",
  etmf: "eTMF (validated, read-only)",
  drafts: "RegChain draft inbox (draft-only)",
};
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const json = value => ({ content: [{ type: "text", text: JSON.stringify(value, null, 1) }] });
const ACTION_TYPES = ["swap_batch", "relabel", "delay", "record_authorisation_route", "book_qp_release", "obtain_pharmacy_code", "create_label_specification", "proceed"];

export function registerTools(server, system, data) {
  const { portfolio, spain, specs, ops } = data;
  const batchInfo = id => {
    const batch = portfolio.batches.find(item => item.id === id);
    if (batch) {
      const label = portfolio.label_specs.find(item => item.id === batch.label_spec_id);
      const studyCountry = portfolio.study_countries.find(item => item.id === batch.study_country_id);
      return { batch: batch.id, product: batch.product_id, trial: batch.study_id, country: studyCountry.country_code, qp_certified: batch.finished_imp_qp_certification_date,
        label: label ? { spec: label.id, version: label.version, jurisdiction: label.jurisdiction, legacy: label.legacy_reference } : null };
    }
    const xz = spain.trial.batches.find(item => item.id === id);
    return xz ? { batch: xz.id, product: "XZ-417", trial: spain.trial.id, qp_release: xz.qp, label: { spec: spain.trial.labelSpec.id, languages: spain.trial.labelSpec.languages } } : null;
  };
  if (system === "specs") {
    server.registerTool("list_shipments_needing_action", { title: "Shipments needing action", description: "Lists planned shipments that are blocked or need a check before dispatch, with the specification sections involved.", inputSchema: {}, annotations: READ },
      async () => json(allShipmentChecks(data).filter(item => item.result !== "Ready").map(item => ({ shipment: item.id, country: item.country, dispatch: item.dispatch, prepare_by: item.prepareBy, result: item.result,
        issues: item.checks.filter(check => ["Fail", "Missing", "Decision", "Confirm"].includes(check.result)).map(check => `${sectionNames[check.section]}: ${check.result} · ${check.detail}`) }))));
    server.registerTool("get_shipment_checks", { title: "Shipment checks", description: "Checks one planned shipment against its destination's Country Specification and returns every check with its result.", inputSchema: { shipment_id: z.string() }, annotations: READ },
      async ({ shipment_id }) => json({ shipment: shipmentView(data, shipment_id), ...checkShipment(data, shipment_id) }));
    server.registerTool("get_country_specification", { title: "Country Specification", description: "Returns a country's specification (country id uk, de, fr, es or us), or one section of it.", inputSchema: { country: z.string(), section: z.string().optional() }, annotations: READ },
      async ({ country, section }) => {
        const spec = specs[country];
        if (!spec) return json({ error: `No specification for ${country}.` });
        const sections = section ? { [section]: spec.sections[section] } : spec.sections;
        return json({ country, version: spec.version, published: spec.published, next_scheduled_update: spec.next, sections: Object.fromEntries(Object.entries(sections).filter(([, value]) => value).map(([id, value]) => [id, { name: sectionNames[id], owner: value.owner, items: value.items }])) });
      });
    server.registerTool("verify_option", { title: "Verify an option", description: "Tests a proposed option for a shipment against the specification rules and operational feasibility (stock, relabelling slots, label approvals, site stock, QP plan). Fixed rules, no AI. An option passes only if it is feasible and the shipment is no longer blocked.",
      inputSchema: { shipment_id: z.string(), actions: z.array(z.object({ type: z.enum(ACTION_TYPES), batch_id: z.string().optional(), relabel_date: z.string().optional(), new_dispatch_date: z.string().optional(), authorisation_route: z.string().optional(), qp_date: z.string().optional() })) }, annotations: READ },
      async ({ shipment_id, actions }) => json(verifyOption(data, shipment_id, actions)));
  }
  if (system === "irt") {
    server.registerTool("get_shipment", { title: "Shipment", description: "Returns a planned shipment: site, dispatch and delivery dates, batch, kits, depot and carrier.", inputSchema: { shipment_id: z.string() }, annotations: READ },
      async ({ shipment_id }) => json(shipmentView(data, shipment_id) ?? { error: "Unknown shipment." }));
    server.registerTool("get_depot_stock", { title: "Depot stock", description: "Returns kits in stock at a depot by batch, optionally for one product. Depots: 'UK depot', 'Central EU depot, Belgium'.", inputSchema: { depot: z.string(), product_id: z.string().optional() }, annotations: READ },
      async ({ depot, product_id }) => {
        const stock = ops.depotStock[depot];
        if (!stock) return json({ error: `Unknown depot ${depot}.` });
        return json(Object.entries(stock).map(([batch, kits]) => ({ ...batchInfo(batch), kits })).filter(item => !product_id || item.product === product_id));
      });
    server.registerTool("get_site_stock", { title: "Site stock", description: "Returns how many days of supply a trial site holds.", inputSchema: { site_id: z.string() }, annotations: READ },
      async ({ site_id }) => json({ site: site_id, days_of_supply: ops.siteStockDays[site_id] ?? null }));
  }
  if (system === "erp") {
    server.registerTool("get_batches", { title: "Batches", description: "Returns the batches of a product with QP certification dates and label specifications.", inputSchema: { product_id: z.string() }, annotations: READ },
      async ({ product_id }) => json([...portfolio.batches.map(item => item.id), ...spain.trial.batches.map(item => item.id)].map(batchInfo).filter(item => item?.product === product_id)));
    server.registerTool("get_batch", { title: "Batch", description: "Returns one batch with its QP date and label specification.", inputSchema: { batch_id: z.string() }, annotations: READ },
      async ({ batch_id }) => json(batchInfo(batch_id) ?? { error: "Unknown batch." }));
    server.registerTool("get_label_approval", { title: "Label approval", description: "Returns the approval status of a product's label text for a country (UK, DE).", inputSchema: { product_id: z.string(), country: z.string() }, annotations: READ },
      async ({ product_id, country }) => json(ops.labelApprovals[country]?.[product_id] ?? { status: "no record" }));
    server.registerTool("get_qp_plan", { title: "QP release plan", description: "Returns the QP release plan for a batch: status and earliest release date.", inputSchema: { batch_id: z.string() }, annotations: READ },
      async ({ batch_id }) => json(ops.qpPlan[batch_id] ?? { status: "no plan on record" }));
  }
  if (system === "depot") {
    server.registerTool("get_relabel_capacity", { title: "Relabelling capacity", description: "Returns the relabelling slots at a depot, with kits per slot and the turnaround in business days.", inputSchema: { depot: z.string() }, annotations: READ },
      async ({ depot }) => json(ops.relabel[depot] ?? { error: `Unknown depot ${depot}.` }));
    server.registerTool("get_courier_options", { title: "Courier options", description: "Returns transit times and weekend operation for an approved carrier.", inputSchema: { carrier: z.string() }, annotations: READ },
      async ({ carrier }) => json(ops.couriers[carrier] ?? { error: `Unknown carrier ${carrier}.` }));
  }
  if (system === "etmf") {
    server.registerTool("get_trial_authorisation", { title: "Trial authorisation", description: "Returns the authorisation record for a trial in a country (GB, ES, ...), with the document and its eTMF reference, and what IRT records.", inputSchema: { trial_id: z.string(), country: z.string() }, annotations: READ },
      async ({ trial_id, country }) => json(ops.trialAuthorisations[`${trial_id}|${country}`] ?? { status: "no record in the eTMF" }));
    server.registerTool("get_site_contact", { title: "Site contact", description: "Returns the contact and channel for a trial site.", inputSchema: { site_id: z.string() }, annotations: READ },
      async ({ site_id }) => json(ops.siteContacts[site_id] ?? { status: "no contact on record" }));
  }
  if (system === "drafts") {
    let count = 0;
    server.registerTool("create_draft", { title: "Create a draft",
      description: "Creates a draft action for a person to approve in the target validated system: a change request, a relabelling work order, a QP slot booking, a record correction or a message. It never executes anything and never changes a validated record.",
      inputSchema: { target_system: z.enum(["IRT", "ERP", "Depot", "QMS", "eTMF", "Site portal"]), kind: z.string(), shipment_id: z.string(), title: z.string(), body: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
      async input => json({ draft_id: `DRAFT-${input.shipment_id}-${String(++count).padStart(2, "0")}`, status: `Draft · needs approval in ${input.target_system}`, executed: false, ...input }));
  }
}

const isMain = process.argv[1] && resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase();
if (isMain) {
  const system = process.argv[2];
  if (!SYSTEMS[system]) {
    console.error(`Usage: node regchain-ai/mcp-servers.mjs <${Object.keys(SYSTEMS).join("|")}>`);
    process.exit(1);
  }
  const server = new McpServer({ name: `regchain-${system}`, version: "0.1.0" });
  registerTools(server, system, await loadData(root));
  await server.connect(new StdioServerTransport());
}
