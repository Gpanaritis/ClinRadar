// MCP servers for the RegChain agents, one per system: node regchain-ai/mcp-servers.mjs <system>
// Validated systems (IRT, ERP, depot, eTMF) expose read-only tools. The draft inbox only creates drafts:
// nothing here changes a validated record, and every draft needs approval in its own system.
// The data is the fictional demo data in demo-data/. In production each server would sit in front of the real system.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadData, checkShipment, allShipmentChecks, verifyOptionSafe, shipmentView, sectionNames, watchBriefs } from "./rules.mjs";
import { HAZARDS } from "./supplyshield.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SYSTEMS = {
  specs: "SupplyShield: Country Specifications, shipment checks, monitoring scope and external signals",
  irt: "IRT/RTSM (validated, read-only)",
  erp: "ERP batch records (validated, read-only)",
  depot: "Depot and labelling (validated, read-only)",
  etmf: "eTMF (validated, read-only)",
  ctms: "CTMS: the active-trial portfolio (validated, read-only)",
  courier: "Courier booking and tracking (read-only)",
  drafts: "SupplyShield draft inbox (draft-only)",
};
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const json = value => ({ content: [{ type: "text", text: JSON.stringify(value, null, 1) }] });
const ACTION_TYPES = ["swap_batch", "relabel", "delay", "advance_dispatch", "reroute", "record_authorisation_route", "book_qp_release", "obtain_pharmacy_code", "create_label_specification", "proceed"];

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
    const il = data.israel?.trial.batches.find(item => item.id === id);
    if (il) {
      const label = data.israel.trial.labels.find(item => item.id === il.label);
      return { batch: il.id, product: data.israel.trial.product, trial: data.israel.trial.id, qp_release: il.qp, expiry: il.expiry, label: { spec: label.id, type: label.type, countries: label.countries, languages: label.languages } };
    }
    const xz = spain.trial.batches.find(item => item.id === id);
    return xz ? { batch: xz.id, product: "XZ-417", trial: spain.trial.id, qp_release: xz.qp, label: { spec: spain.trial.labelSpec.id, languages: spain.trial.labelSpec.languages } } : null;
  };
  if (system === "specs") {
    server.registerTool("list_shipments_needing_action", { title: "Shipments needing action", description: "Lists planned shipments that are blocked or need a check before dispatch, with the specification sections involved.", inputSchema: {}, annotations: READ },
      async () => json(allShipmentChecks(data).filter(item => item.result !== "Ready").map(item => ({ shipment: item.id, country: item.country, dispatch: item.dispatch, prepare_by: item.prepareBy, result: item.result,
        issues: item.checks.filter(check => ["Fail", "Missing", "Decision", "Confirm"].includes(check.result)).map(check => `${sectionNames[check.section]}: ${check.result} · ${check.detail}`) }))));
    server.registerTool("list_commitments", { title: "Commitments", description: "Lists the stock and relabelling capacity already promised to plans people approved in RegChain. Options must not use these kits or slot places again.", inputSchema: {}, annotations: READ },
      async () => json(data.reservations ?? []));
    server.registerTool("get_shipment_checks", { title: "Shipment checks", description: "Checks one planned shipment against its destination's Country Specification and returns every check with its result.", inputSchema: { shipment_id: z.string() }, annotations: READ },
      async ({ shipment_id }) => json({ shipment: shipmentView(data, shipment_id), ...checkShipment(data, shipment_id) }));
    server.registerTool("get_country_specification", { title: "Country Specification", description: "Returns a country's specification (country id uk, de, fr, es, us, il, gr or cy), or one section of it.", inputSchema: { country: z.string(), section: z.string().optional() }, annotations: READ },
      async ({ country, section }) => {
        const spec = specs[country];
        if (!spec) return json({ error: `No specification for ${country}.` });
        const sections = section ? { [section]: spec.sections[section] } : spec.sections;
        // A change waiting for the Regulatory SME: the shipment checks hold shipments against it (the safe side), but the
        // Country Specification itself changes only after approval.
        const held = "SupplyShield's shipment checks hold shipments against it until the Regulatory SME decides; the Country Specification itself changes only after that approval.";
        const pending = { uk: { id: "RC-UK-001", text: `The amended Part 7 labelling rules apply from 2026-04-28. ${held}` },
          es: { id: data.spain.case.id, text: `From ${data.spain.case.effective}: ${data.spain.case.policy} ${held}` },
          ...(data.israel ? { il: { id: "RC-IL-001", text: `From ${data.israel.case.effective}: ${data.israel.case.summary} ${held}` } } : {}) }[country];
        return json({ country, version: spec.version, published: spec.published, next_scheduled_update: spec.next, sections: Object.fromEntries(Object.entries(sections).filter(([, value]) => value).map(([id, value]) => [id, { name: sectionNames[id], owner: value.owner, items: value.items,
          ...(value.case && pending ? { pending_change: `${pending.id} is waiting for approval and changes this section. ${pending.text}` } : {}) }])) });
      });
    server.registerTool("verify_option", { title: "Verify an option", description: "Tests a proposed option for a shipment against the specification rules, the external events on its route and operational feasibility (stock, relabelling slots, label approvals, site stock, QP plan, courier departures, import approval terms, monitoring coverage). Fixed rules, no AI. An option passes only if it is feasible and the shipment is no longer blocked.",
      inputSchema: { shipment_id: z.string(), actions: z.array(z.object({ type: z.enum(ACTION_TYPES), batch_id: z.string().optional(), relabel_date: z.string().optional(), new_dispatch_date: z.string().optional(), authorisation_route: z.string().optional(), qp_date: z.string().optional(), via: z.string().optional().describe("For reroute: the departure airport code, for example AMS.") })) }, annotations: READ },
      async ({ shipment_id, actions }) => json(verifyOptionSafe(data, shipment_id, actions)));
    const ss = data.supplyshield;
    server.registerTool("get_monitoring_scope", { title: "Monitoring scope", description: "Returns which countries SupplyShield monitors and why: countries with an operationally active trial (automatic), recommended countries with their evidence and whether a person turned monitoring on, and registered countries that are not operationally active. Agents cannot change the scope.", inputSchema: {}, annotations: READ },
      async () => json(!ss ? { status: "unavailable" } : ss.scope.status !== "determined" ? { status: ss.scope.status, message: ss.scope.message } : {
        status: "determined", source: ss.scope.source,
        monitored_for_external_risk: ss.scope.monitored.external.map(code => ({ code, name: ss.names[code] ?? code })),
        monitored_for_regulatory_and_customs: ss.scope.monitored.regulatory.map(code => ({ code, name: ss.names[code] ?? code })),
        recommended: ss.scope.recommendations.filter(item => item.group !== "proximity").map(item => ({ code: item.code, name: item.name, group: item.group, external_on: item.monitoring.external.on, regulatory_on: item.monitoring.regulatory.on, evidence: item.reasons.map(reason => `${reason.label}: ${reason.text}`) })),
        proximity_only_recommended: ss.scope.recommendations.filter(item => item.group === "proximity").length,
        registered_not_operational: ss.scope.notInScope.map(item => ({ code: item.code, name: item.name, entries: item.entries })),
      }));
    server.registerTool("get_land_neighbors", { title: "Land and sea neighbours", description: "Returns a country's land-border neighbours and, separately, its sea neighbours, from the reference geography table. A sea neighbour is never a land border. Countries without adjacency data return BORDER_RELATION_UNKNOWN instead of a guess.", inputSchema: { country_code: z.string() }, annotations: READ },
      async ({ country_code }) => {
        const code = String(country_code).toUpperCase();
        const geography = data.network?.geography ?? {};
        const names = ss?.names ?? {};
        if (geography.land?.[code] === undefined) return json({ country: code, name: names[code] ?? code, status: "BORDER_RELATION_UNKNOWN", source: geography.source ?? null });
        return json({ country: code, name: names[code] ?? code, land: geography.land[code].map(item => ({ code: item, name: names[item] ?? item })), sea: (geography.sea?.[code] ?? []).map(item => ({ code: item, name: names[item] ?? item })), source: geography.source });
      });
    const regionOf = code => data.network?.geography?.regions?.[code] ?? "Other";
    server.registerTool("get_risk_signals", { title: "External signals", description: "Returns the external events SupplyShield detected in monitored countries and how each one touches our shipments: confirmed disruption (an authorised system confirmed the impact), potential exposure (touches the route on the day, not confirmed; names the missing evidence), not affected after check, or observed. Give a shipment_id for that shipment's matches and route. Optional filters: hazard (weather, transport, security or regulatory) and region (for example Europe, Middle East, North America, Asia, Oceania).",
      inputSchema: { shipment_id: z.string().optional(), hazard: z.enum(Object.keys(HAZARDS)).optional().describe("Only this kind of hazard."), region: z.string().optional().describe("Only events in countries of this region.") }, annotations: READ },
      async ({ shipment_id, hazard, region }) => {
        if (!ss) return json({ status: "unavailable" });
        const inRegion = code => !region || regionOf(code).toLowerCase() === String(region).toLowerCase();
        if (shipment_id) return json({ shipment: shipment_id, route: ss.routes[shipment_id] ?? null, matches: (ss.byShipment[shipment_id] ?? []).filter(match => (!hazard || match.hazard === hazard) && inRegion(ss.signals.find(item => item.id === match.signal)?.country)) });
        return json(ss.signals.filter(signal => (!hazard || signal.hazard === hazard) && inRegion(signal.country)).map(signal => ({ id: signal.id, title: signal.title, hazard: signal.hazard, tier: signal.tierName, priority: signal.priority,
          country: signal.country, region: regionOf(signal.country), window: signal.window, evidence: signal.evidenceName, sources: (signal.sources ?? []).map(source => source.authority),
          illustrative: Boolean(signal.illustrative), live: Boolean(signal.live), counts: signal.counts,
          matches: signal.matches.map(match => `${match.shipment} · ${match.label} on ${match.date} · ${match.tier}`), notes: signal.notes })));
      });
    server.registerTool("get_watch_brief", { title: "Watch brief", description: "For one kind of hazard (weather, transport, security or regulatory): the sources watched, every monitored country with its region, how many events were found and how many touch our shipments, routes or facilities, the most relevant event ids, and the coverage gaps. For regulatory: the rule changes and import approvals with the planned shipments each affects.",
      inputSchema: { hazard: z.enum(Object.keys(HAZARDS)) }, annotations: READ },
      async ({ hazard }) => {
        if (!ss || ss.scope.status !== "determined") return json({ hazard, status: ss?.scope.status ?? "unavailable", message: ss?.scope.message ?? "SupplyShield is not available." });
        const { watch, regulatory } = watchBriefs(data);
        const entry = watch.find(item => item.hazard === hazard);
        const codes = ss.scope.monitored[HAZARDS[hazard].kind] ?? [];
        return json({ hazard, agent: entry.agent, name: entry.name, covers: entry.covers, sources: entry.sources,
          monitored_countries: codes.map(code => ({ code, name: ss.names[code] ?? code, region: regionOf(code) })), regions: entry.regions,
          events: entry.events, touching_our_network: entry.touching, confirmed: entry.confirmed, potential: entry.potential, most_relevant: entry.top,
          coverage_gaps: entry.gaps.map(gap => gap.text),
          ...(hazard === "weather" ? { alerts_outside_scope_near_our_facilities: ss.feeds?.gdacs?.nearOurFacilities ?? [] } : {}),
          ...(hazard === "regulatory" ? { items: regulatory.map(({ short: _short, ...item }) => item) } : {}) });
      });
  }
  if (system === "ctms") {
    server.registerTool("get_active_studies", { title: "Active studies", description: "Returns the studies in the CTMS with their status and, per country, whether the company supplies investigational product there (supplying), the country is approved but not started, or closed.", inputSchema: {}, annotations: READ },
      async () => {
        const ctms = data.network?.ctms;
        if (!ctms || data.scopeState?.connected === false) return json({ status: "not connected", message: "No authoritative active-trial portfolio is connected." });
        const titles = Object.fromEntries([...portfolio.studies.map(item => [item.id, item.title]), [spain.trial.id, spain.trial.title], ...(data.israel ? [[data.israel.trial.id, data.israel.trial.title]] : [])]);
        return json({ system: ctms.system, snapshot_at: ctms.snapshot_at, definition: ctms.definition, active_statuses: data.supplyshield?.scope?.config?.activeStatuses ?? null,
          studies: ctms.studies.map(item => ({ ...item, title: titles[item.id] ?? item.id })) });
      });
    server.registerTool("get_study_countries", { title: "Study countries", description: "Returns, for the given studies, each country with its CTMS status (ACTIVE, NOT_STARTED, CLOSED or UNKNOWN) and any note. UNKNOWN means the owner must confirm it; it is never treated as active or inactive.", inputSchema: { study_ids: z.array(z.string()) }, annotations: READ },
      async ({ study_ids }) => {
        const ctms = data.network?.ctms;
        if (!ctms || data.scopeState?.connected === false) return json({ status: "not connected", message: "No authoritative active-trial portfolio is connected." });
        return json(ctms.studies.filter(item => study_ids.includes(item.id)).map(item => ({ study: item.id, status: item.status, countries: item.countries })));
      });
  }
  if (system === "courier") {
    const records = id => (data.network?.operational_status ?? []).filter(item => item.shipment === id);
    const route = ({ shipment_id }) => json(data.supplyshield?.routes?.[shipment_id] ?? { shipment: shipment_id, status: "INSUFFICIENT_DATA", error: "No route on record for this shipment. Do not guess transit countries." });
    const status = ({ shipment_id }) => { const items = records(shipment_id); return json(items.length ? items : { shipment: shipment_id, status: "no status recorded yet: the courier has not confirmed or changed anything for this shipment" }); };
    const routeHelp = "Returns the legs of a planned shipment from the depot to the site, with the day of each leg: collection, road, flight (departure, any hub, arrival), import clearance and delivery.";
    const statusHelp = "Returns what the courier's booking and tracking systems report for a shipment's legs: booked, operating, cancelled or held, with the time each record was made.";
    server.registerTool("get_route", { title: "Shipment route", description: routeHelp, inputSchema: { shipment_id: z.string() }, annotations: READ }, route);
    server.registerTool("get_shipment_route", { title: "Shipment route (starter-pack name)", description: routeHelp, inputSchema: { shipment_id: z.string() }, annotations: READ }, route);
    server.registerTool("get_courier_status", { title: "Courier status", description: statusHelp, inputSchema: { shipment_id: z.string() }, annotations: READ }, status);
    server.registerTool("get_carrier_or_provider_status", { title: "Carrier status (starter-pack name)", description: statusHelp, inputSchema: { shipment_id: z.string() }, annotations: READ }, status);
    server.registerTool("get_departure_alternatives", { title: "Departure alternatives", description: "Returns the qualified departure airports the courier can use for a shipment's air route, with weekdays flown, road time from the depot, temperature qualification, and whether each country on the way is monitored for external risk.", inputSchema: { shipment_id: z.string() }, annotations: READ },
      async ({ shipment_id }) => {
        const route = data.supplyshield?.routes?.[shipment_id];
        if (!route || route.mode !== "air") return json({ shipment: shipment_id, options: [], note: "Only air routes have alternative departures." });
        const monitored = data.supplyshield.scope.monitored?.external ?? [];
        return json({ shipment: shipment_id, booked_departure: route.departure, options: (data.network.departure_alternatives ?? []).filter(item => item.lane === route.lane).map(item => {
          const airport = data.network.airports[item.airport];
          return { airport: item.airport, name: airport?.name, country: airport?.country, booked: Boolean(item.booked), days: item.days, road_hours_from_depot: item.roadHours, qualified: item.qualified, monitored_for_external_risk: monitored.includes(airport?.country) };
        }) });
      });
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
      async ({ product_id }) => json([...portfolio.batches.map(item => item.id), ...spain.trial.batches.map(item => item.id), ...(data.israel?.trial.batches.map(item => item.id) ?? [])].map(batchInfo).filter(item => item?.product === product_id)));
    server.registerTool("get_batch", { title: "Batch", description: "Returns one batch with its QP date and label specification.", inputSchema: { batch_id: z.string() }, annotations: READ },
      async ({ batch_id }) => json(batchInfo(batch_id) ?? { error: "Unknown batch." }));
    server.registerTool("get_label_approval", { title: "Label approval", description: "Returns the approval status of a product's label text for a country (UK, DE, IL).", inputSchema: { product_id: z.string(), country: z.string() }, annotations: READ },
      async ({ product_id, country }) => json(ops.labelApprovals[country]?.[product_id] ?? { status: "no record" }));
    server.registerTool("get_qp_plan", { title: "QP release plan", description: "Returns the QP release plan for a batch: status and earliest release date.", inputSchema: { batch_id: z.string() }, annotations: READ },
      async ({ batch_id }) => json(ops.qpPlan[batch_id] ?? { status: "no plan on record" }));
  }
  if (system === "depot") {
    server.registerTool("get_relabel_capacity", { title: "Relabelling capacity", description: "Returns the relabelling slots at a depot, with kits per slot and the turnaround in business days.", inputSchema: { depot: z.string() }, annotations: READ },
      async ({ depot }) => json(ops.relabel[depot] ?? { error: `Unknown depot ${depot}.` }));
    server.registerTool("get_courier_options", { title: "Courier options", description: "Returns transit times and weekend operation for an approved carrier.", inputSchema: { carrier: z.string() }, annotations: READ },
      async ({ carrier }) => json(ops.couriers[carrier] ?? { error: `Unknown carrier ${carrier}.` }));
    server.registerTool("get_facility_status", { title: "Facility status", description: "Returns what a facility's own system reports for a day or for every recorded day: open, reduced (for example no outbound collections) or closed. Facilities: DEPOT-UK, DEPOT-BE, PACK-NL, DEPOT-US, DEPOT-SG.", inputSchema: { facility: z.string(), date: z.string().optional() }, annotations: READ },
      async ({ facility, date }) => {
        const items = (data.network?.operational_status ?? []).filter(item => item.facility === facility && (!date || item.date === date));
        return json(items.length ? items : { facility, date: date ?? null, status: "open: no exception recorded" });
      });
  }
  if (system === "etmf") {
    server.registerTool("get_trial_authorisation", { title: "Trial authorisation", description: "Returns the authorisation record for a trial in a country (GB, ES, ...), with the document and its eTMF reference, and what IRT records.", inputSchema: { trial_id: z.string(), country: z.string() }, annotations: READ },
      async ({ trial_id, country }) => json(ops.trialAuthorisations[`${trial_id}|${country}`] ?? { status: "no record in the eTMF" }));
    server.registerTool("get_import_approval", { title: "Import approval", description: "Returns the import approval on record for a shipment (for example the Israeli Ministry of Health approval): status, number or request date, and its terms: port of entry, kits, consignee and validity.", inputSchema: { shipment_id: z.string() }, annotations: READ },
      async ({ shipment_id }) => {
        const approval = ops.importApprovals?.[shipment_id];
        const terms = (data.network?.permits ?? []).find(item => item.shipment === shipment_id);
        return json(approval || terms ? { ...(approval ?? {}), ...(terms ? { terms: { port_of_entry: terms.portOfEntry, kits: terms.kits, consignee: terms.consignee, valid_until: terms.validUntil, holder: terms.holder } } : {}) } : { status: "no import approval on record" });
      });
    server.registerTool("get_site_contact", { title: "Site contact", description: "Returns the contact and channel for a trial site.", inputSchema: { site_id: z.string() }, annotations: READ },
      async ({ site_id }) => json(ops.siteContacts[site_id] ?? { status: "no contact on record" }));
  }
  if (system === "drafts") {
    const counts = {};
    server.registerTool("create_draft", { title: "Create a draft",
      description: "Creates a draft action for a person to approve in the target validated system: a change request, a relabelling work order, a QP slot booking, a record correction or a message. It never executes anything and never changes a validated record.",
      inputSchema: { target_system: z.enum(["IRT", "ERP", "Depot", "QMS", "eTMF", "Site portal", "Courier", "SupplyShield monitoring"]).describe("SupplyShield monitoring: a request that a person turns on monitoring for a recommended country; agents never turn it on themselves."), kind: z.string(), shipment_id: z.string(), option_id: z.string().optional().describe("The option this draft belongs to, or 'escalate'."), title: z.string(), body: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
      async input => json({ draft_id: `DRAFT-${input.shipment_id}-${String((counts[input.shipment_id] = (counts[input.shipment_id] ?? 0) + 1)).padStart(2, "0")}`, status: `Draft · needs approval in ${input.target_system}`, executed: false, ...input }));
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
