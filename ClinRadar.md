# ClinRadar

External risk and country regulatory intelligence for global clinical supply · 15 November 2026

ClinRadar was called RegChain AI until 15 November 2026. The product name changed on screen; the repository, the file names, the `regchain-ai/` folder and the `REGCHAIN_*` settings keep the old name so that nothing that runs today breaks.

## What it does

ClinRadar watches the outside world only where the company actually runs trials. It reads the authorised active-trial portfolio from the CTMS, monitors the countries with an operationally active trial, and recommends other countries with the evidence for each one, without ever switching them on by itself. It matches each external event and each regulatory change to the company's own planned shipments, facilities, routes, deadlines and operating constraints. It then says which shipment is affected, how sure it is, and what evidence is still missing. For a confirmed disruption, AI agents propose recovery options, fixed rules check every option, and a named person approves. Nothing changes in a validated system, in the Country Specifications or in a shipment instruction without that approval.

The goal is a company-specific risk assessment and a controlled action, not a feed of world news.

## Why: what the research found

The full report, with sources, is [ClinRadar-Research.md](ClinRadar-Research.md). In short:

- **Rule changes alone are a narrow problem.** Supply-relevant rule changes are few: at least 9 in 8 jurisdictions from 2022 to 2026, mostly announced well ahead, and several of them relaxations. Monitoring regulations is also already sold, by RegASK, Freyr, IQVIA, Clarivate and Veeva. The pitch "a missed rule change breaks clinical supply" has no evidence behind it.
- **Requirements that already exist but are missed on a given shipment are reported again and again.** Examples are permits that name quantities or sites, licences that must change when the contents change, exact-kit invoices, and the importer of record. Nobody publishes how often this happens. In the one multi-company study, the cross-border leg is the weak point: 80% of shipments to in-country depots arrived on time, against 97% of shipments to sites (Tufts CSDD, 2016).
- **Keeping patients supplied is a regulatory duty, and disruptions do hit trials.** ICH E6(R3) 3.15.3(c)(i) asks for timely supply "to avoid any interruption" of treatment. EMA counts systematic missed doses, unmanaged temperature excursions and IRT faults as serious breaches. Wars and closed airspace, COVID-19, comparator shortages and IT outages have all stopped or slowed trials.
- **Nobody links an external event or a country requirement to a specific planned shipment, then proposes a recovery for a person to approve.** The 2026 supply agents (Signant, Endpoint, Suvoda) flag risks inside their own systems. Veeva's Batch Release uses regulatory status per country, but only for marketed products. The fastest competitors to watch are Veeva and IQVIA, which already hold most of the pieces.

## How ClinRadar follows its brief

| # | The brief | How ClinRadar does it | Where |
|---|---|---|---|
| 1 | Retrieve the active studies and their operationally active countries from the CTMS | The CTMS snapshot (`ctms` in `demo-data/supply-network.json`) gives each study's status and each country's supply status: supplying, approved but not started, or closed. Agents read it through the CTMS MCP server (`get_active_studies`). | Monitoring scope |
| 2 | Monitor only those countries automatically | 16 countries with an operationally active trial are monitored for external risk and for regulatory and customs changes. These switches are locked on. The status policy in `config/supplyshield.yaml` leaves out 4 of the 22 studies: two completed (STUDY-018, STUDY-019 in Brazil), one suspended (STUDY-020) and one not yet recruiting (CTP-7842-201). | Monitoring scope |
| 3 | Monitor regulatory requirements and external risks there | Regulatory cases (UK labelling from the official legislation, plus illustrative Spain and Israel rules). External risk from UK FCDO travel advice and GDACS disaster alerts, read live for the monitored countries, and recorded events. | Signals |
| 4 | Recommend more countries on evidence | Facility dependencies (depots, the manufacturer, the active-ingredient supplier), documented transit routes, shared hubs (Dubai on the APAC resupply route), documented alternative departures (Luxembourg for Israel), land borders, sea neighbours, and current official advice. Each reason is shown. | Monitoring scope |
| 5 | Never switch a recommended country on by itself; two independent switches, off by default | Every recommended country has an External risk switch (Clinical Supply) and a Regulatory and customs switch (Regulatory SME). Both start off, and each change needs a reason. In the prepared workspace one recorded decision is on: P. Laine turned on external risk for Belgium on 2 Nov 2026, because the central EU depot is there. | Monitoring scope |
| 6 | No list of "hostile" countries; geopolitical exposure only on current authoritative evidence | No country list judges hostility. Official advice counts only as evidence on a country that already has a supply link or a border, and it always carries its source and date (UK FCDO, Open Government Licence). | `regchain-ai/supplyshield.mjs` |
| 7 | Match events to shipments, facilities, routes, deadlines and constraints | Every shipment has a route with the day of each leg: collection, road, flight, import clearance, delivery. An event matches by place (airport, facility, road country) and by day. The checks also apply depot working days, Israeli delivery days, preparation dates and import approval terms (port of entry, kits, consignee, validity). | Shipments, Signals |
| 8 | Separate an observed event, a potential exposure and a confirmed disruption | Four tiers, defined below, for every match and every signal. | Signals, Shipments |
| 9 | Investigate missing evidence with authorised tools; never invent | A match is confirmed only by a record from the courier or the depot, with its time. Without one, the match stays a potential exposure, and the screen names what is missing and who must confirm it. The agents read the courier and depot systems over MCP, and their instructions forbid guessing a status. A route through a country nobody monitors is never called clear: it needs a confirmation. | Signal page, plan page |
| 10 | Propose feasible mitigations and assign owners | The agents propose options, for example leave from Amsterdam instead of Brussels, or dispatch on 25 Nov. Fixed rules check each one. Each draft names its system and owner. | Plan page |
| 11 | Human approval before changing the country intelligence, regulated systems or shipment instructions | Country Specification edits go through the Regulatory SME's decision. Plans need Clinical Supply's approval. Every system change is a draft that someone approves in IRT, ERP, the depot, the courier, the QMS or the site portal. | Plan page, change cases |
| 12 | Keep evidence, timestamps, history and audit | Monitoring decisions, the CTMS connection, every check of the feeds, every approval and every agent run are in the hash-chained audit trail and the run history. | Settings, audit export |

With no CTMS connected, ClinRadar says that its monitoring scope cannot be determined and monitors nothing. It never assumes that every country with registered trials is in scope.

## The starter pack, built in

The team's ClinRadar starter pack has three files, and all of them are now in the repository:

| File | What ClinRadar does with it |
|---|---|
| `config/supplyshield.yaml` (the agent configuration) | The engine reads it at every check (`regchain-ai/yaml-lite.mjs`). It sets which study statuses count as active (RECRUITING, ENROLLING_BY_INVITATION, ACTIVE_NOT_RECRUITING, TREATMENT_ONGOING, FOLLOW_UP_ONGOING), what is left out by default (not yet recruiting, suspended, completed), which kinds of recommendation are made, which risk categories are monitored, the governance flags and the monitoring cadence. Recommended countries are never switched on automatically, even if the file says otherwise. |
| `ClinRadar-Master-Prompt.md` (the master prompt) | Its master agent instructions are the orchestrator's system prompt, followed by the per-shipment task. Both are sent as one cached prefix, so later turns read them from the cache. The specialists keep their short instructions. |
| `demo-data/country-catalogue-iso3166.csv` (the ISO 3166 catalogue) | It supplies the names and codes for any country a CTMS might send. It is a vocabulary, not a list of countries to monitor. |

What the pack added to the engine:

- **Four country groups.** Countries are CORE_ACTIVE (an active trial), RECOMMENDED (off), MANUALLY_ENABLED (a person turned it on) or EXCLUDED. An UNKNOWN or contradictory CTMS status becomes a review warning; it is never guessed. In the data, Portugal is the example: the CTMS says not started, while IRT shows a site activated.
- **Conditional studies.** A suspended or not-yet-recruiting study is left out by default. If product is still at a site, its country becomes an opt-in recommendation; Austria is the example, with STUDY-020 suspended and 24 kits still at the Vienna site.
- **Supranational rules.** EU rules are assessed for the active-trial EU countries, and no other EU country is switched on because of them.
- **Coverage per country.** The engine records what watches each country (live or recorded travel advice, GDACS alerts, a Country Specification) and names every gap. A country with no adjacency data is listed as border relation unknown; its neighbours are never guessed.
- **Three separate dimensions per signal.** Evidence strength (official source, two or more trusted sources, single source, unverified signal), exposure state (the four tiers below) and business priority (CRITICAL to INFO, from fixed rules on days left and site stock). There are no percentages and no probabilities. A confirmed disruption shows the patients behind it. SHP-IL-01's site in Tel Aviv has 13 days of stock, which runs out on 27 Nov 2026. If nobody acts, the courier's next free flight (25 Nov) delivers on Sunday 29 Nov, and 14 patients would go 2 days without treatment. That makes the priority CRITICAL.
- **Duplicates merged.** Two reports of the same event become one signal with two sources: the airport notice and the federal transport notice about the Belgian strike.
- **Tracking outages.** A courier tracking outage is lost visibility, never a lost shipment.
- **Insufficient data.** A shipment without a route on record says so instead of getting invented transit countries.
- **Recommendation reviews.** A recommendation can be dismissed with a reason, and restored. A country that is being monitored has to be switched off first.
- **The pack's tool names.** The MCP servers answer to the contract's names: `get_active_studies`, `get_study_countries`, `get_shipment_route`, `get_carrier_or_provider_status`, `get_land_neighbors`. A request to monitor a country can only be a draft for a person (target "ClinRadar monitoring").
- **The exact answer with no portfolio.** The agent gives the pack's sentence word for word (`scope.agentAnswer`); the screen shows the same meaning in the third person.

### The pack's thirty acceptance tests

| # | Test | Status | Where |
|---|---|---|---|
| 1 | Active trials in Greece and Germany monitor GR and DE only | Automated | `check:supplyshield` §8 |
| 2 | A completed study in Brazil adds no country | Automated | §1 (STUDY-019), §8 |
| 3 | Japan with all sites closed is not monitored | Automated | §8 |
| 4 | Greek land neighbours are suggestions, off; Cyprus is not a Greek land neighbour | Automated | §2, §8 |
| 5 | A documented route leg is suggested without a land border | Automated | §2 (Singapore, the UAE, Luxembourg) |
| 6 | A verified restriction gives a recommendation, never monitoring; no enemy table | Automated | §2: official advice counts only on a country with a link or a border, and stays off |
| 7 | Turning on external risk does not turn on regulatory monitoring | Automated | §5 |
| 8 | An EU rule is assessed for Germany without switching on the EU | Automated | §1, §8 |
| 9 | An official warning near a route is a potential exposure | Automated | §7 (GDACS flood, whole-country advice) |
| 10 | A carrier-confirmed delay is a confirmed disruption, with evidence and the time buffer | Automated | §3 |
| 11 | No route on record means insufficient data | Automated | §8 |
| 12 | A formatting-only change makes no proposal | Automated | `check:server` (pipeline) |
| 13 | Draft or consultation guidance is never labelled law | Partial | The cases record legal status; no automated consultation case in this version |
| 14 | Future effective dates and transitions are kept | Automated | `check:server` (requirement history and date lookup) |
| 15 | A missing regulator source is a coverage gap | Automated | §1 (Japan) |
| 16 | Two feeds about one event make one incident | Automated | §3, §8 |
| 17 | A broken feed is a coverage gap, never "no risk" | Automated | §8 |
| 18 | News without authority or route evidence restricts no shipment | Automated | §8 (FCDO advice for parts of Israel stays observed) |
| 19 | An unverified supplier headline does not make a batch unavailable | By design | Signals never change a batch's status; no supplier feed is connected yet |
| 20 | A tracking outage is not a lost shipment | Automated | §3, §8 |
| 21 | An AI interpretation cannot publish country records or clear holds | Automated | `check:server`, `check:ai` (AI gate, SME decision) |
| 22 | An approval retried with the same key is not duplicated | Automated | `check:server` (idempotent decisions) |
| 23 | An acknowledgement is not proof of implementation | Automated | `check:server` (the case stays open) |
| 24 | A country that becomes inactive during an open incident keeps its history | Partial | History and audit stay; there is no retirement workflow yet |
| 25 | A contradictory status gives a review warning | Automated | §1 (Portugal), §8 |
| 26 | Every claim traces to a source, record and date | By design | Each signal has its authority, time and link, or "illustrative"; each match names its record and time |
| 27 | Sea or air proximity is never called a land border | Automated | §2, §8 |
| 28 | Any active country in the ISO vocabulary works | Automated | §8 (Kenya) |
| 29 | An uncovered active country states its gaps | Automated | §1, §8 |
| 30 | A rejected proposal changes nothing | Automated | `check:server` (workflow sequences) |

### One design decision to keep in view

A regulatory change that waits for the Regulatory SME **holds** the shipments it affects: their checks fail, marked "pending change". The Country Specification itself changes only after the SME approves. Holding is the safe side for a rule that is already law, as the UK labelling rule is. The research report suggests the opposite, showing pending changes as a what-if until approval. That choice belongs to the team.

## The four tiers

| Tier | When |
|---|---|
| **Observed event** | A verified item in a monitored country that touches none of our shipments, collections or routes on those days. Example: the French road protest from 2 to 4 Dec 2026, when no shipment of ours is on French roads. |
| **Potential exposure** | It touches a shipment, a collection or a route on the day, but no authorised system has confirmed an impact. The missing evidence and its owner are named. Example: Ben Gurion runway works from 4 to 8 Jan 2027 and SHP-IL-02's flight on 5 Jan. |
| **Confirmed disruption** | An authorised system confirmed the impact, with a time. Example: the courier cancelled SHP-IL-01's flight from Brussels on 24 Nov 2026 (14 Nov, 08:10 UTC). |
| **Not affected after check** | It touched one of ours, and the carrier or depot confirmed normal operation. Example: SHP-03's truck is in Germany before the Belgian strike day. |

A confirmed disruption blocks the shipment and a potential exposure adds a confirmation; both are shown on the shipment's checks. A new route through a country ClinRadar does not monitor needs a person's decision first.

**No false assurance on unmonitored routes.** A booked route whose legs pass through a country that is not monitored for external risk is never shown as Ready for external risk. It gets a Confirm check, for example "External risk is not monitored on this route: Belgium (depot and departure). … Turn it on in Monitoring scope or confirm with the EMEA specialty courier." Only countries on the route legs count (collection, road, departure, hub, arrival, import clearance, delivery). In the prepared workspace Belgium is on, so no planned shipment crosses an unmonitored country and the counts stay at 14 blocked, 5 to confirm and 6 ready. Turn Belgium off and every shipment leaving the central EU depot becomes Confirm instead of Ready; SHP-IL-01 loses the strike Fail, because the strike is no longer seen, and gets this Confirm instead.

## The watch team

Four agents sweep every monitored country, one kind of hazard each. Every signal carries a `hazard` field, set by fixed rules from its category and source.

| Agent id | Name | Watches | Sources in the prototype |
|---|---|---|---|
| `weather` | Weather & natural hazards | GDACS alerts (floods, cyclones, earthquakes, wildfires, volcanic ash), weather warnings on lanes and facilities | GDACS (live or recorded), recorded weather warnings |
| `transport` | Strikes & transport | Labour action, airport, port and road notices, carrier and depot operations, tracking outages | Airport and transport-authority notices, courier and depot systems |
| `security` | Security & travel advice | UK FCDO travel advice, conflict, unrest, border closures | UK FCDO (live or recorded) |
| `regulatory` | Regulatory & customs | Rule changes waiting for the Regulatory SME, import permits and approvals | Country Specifications, UK legislation and MHRA guidance, EU rules, eTMF import approvals |

They run on Claude Haiku 5.5 (`REGCHAIN_MODEL_WATCH`): sweeping every country is cheap, high-volume scanning. The orchestrator stays on Claude Opus 5.5 and the specialists on Claude Sonnet 5.5. In **Plan all**, the orchestrator dispatches the four before triage, and triage uses what they found: patients first (SHP-IL-01 runs out on 27 Nov), then by preparation date. In a single-shipment run with a route risk, the orchestrator asks the matching watch agent to confirm the event, its evidence level and its duration before the logistics agent looks for alternatives.

To keep the story global, the recorded events include an illustrative US National Weather Service winter storm watch over the US depot in Allentown, Pennsylvania, on 16–17 Nov 2026. No collection is planned there on those days, so it is an observed event that touches a facility of ours. The weather agent also names what is not watched (the APAC depot in Singapore, the manufacturer in Switzerland, the supplier in India) and the red GDACS tropical cyclone alert in India from 1 to 3 Nov, which is context for a recommendation, not a signal.

The page gets `watch` (one summary per agent: `agent`, `name`, `hazard`, `sources`, `countries`, `regions`, `events`, `touching`, `confirmed`, `potential`, `top`, `gaps`, `finding`) and `regulatoryItems` in the ClinRadar payload. The portfolio run record keeps the same four summaries, each with the agent's own finding.

## The demonstration, in five minutes

| Time | Screen | What happens | What to say |
|---|---|---|---|
| 0:00 | Overview, empty workspace (`?empty`) | No portfolio is connected | "ClinRadar monitors nothing until it knows which trials we run. It doesn't watch the whole world." |
| 0:20 | First check | Connect the CTMS (read-only): 22 studies, 18 counted under the company's status policy; 16 countries operationally active; 5 excluded; Portugal's contradictory status waits for confirmation | "Only the countries where we actually supply patients, by the company's own definition of active." |
| 0:50 | Recommendations | 50 countries recommended, all off. Belgium comes first: it hosts the central EU depot, and 17 planned shipments leave from it. Austria has a suspended study with 24 kits still on site | "Belgium has no active site, so it isn't monitored automatically. The evidence says it should be, so I turn it on, with a reason." |
| 1:30 | Signals | The check finds the national strike in Belgium on 24 Nov: **confirmed disruption** for SHP-IL-01 (the courier cancelled the Brussels to Tel Aviv flight); SHP-03 **not affected after check**; the Ben Gurion works a **potential exposure** for SHP-IL-02 | "Three levels of certainty, each with its evidence. Nothing is a guess." |
| 2:30 | Agents in action, then the SHP-IL-01 plan | The agents read the route, the courier and the depot status, and the import approval (port of entry TLV). They propose leaving from Amsterdam (passes, same delivery date), Luxembourg (needs a monitoring decision first) and a 25 Nov dispatch (fails: the kits would arrive after the Tel Aviv stock runs out) | "Fixed rules check every option. The AI proposes, it doesn't decide." |
| 3:45 | Plan page | **Approve this plan** as Clinical Supply. Two drafts: a booking change for the courier and a new collection instruction for the depot | "Nothing has changed in any system yet. Each draft is approved where it belongs." |
| 4:30 | Audit | Export the audit record; Settings shows who turned Belgium on and why | "Every decision is traceable." |

Without an API key, the agents run as the scripted walkthrough (no AI) through the same MCP servers. Say so plainly. No live Claude run has been recorded yet.

## What is real, what is illustrative

- **Real:** the UK legislation and MHRA guidance read at run time for the UK labelling case. UK FCDO travel advice and GDACS alerts, read live by **Run the check**; the copy in `demo-data/recorded-feeds.json` was recorded on 15 Nov 2026 and keeps the demo working offline. Countries, borders, sea neighbours, cities and airports.
- **Illustrative, and labelled so on screen:** the Belgian strike on 24 Nov 2026, the Ben Gurion runway works, the French road protest, the Spanish note and the Israeli label rule.
- **Fictional:** the studies, sites, shipments, depots, manufacturer and supplier, courier and depot records, and import approvals.

## Code and data

| What | Where |
|---|---|
| Scope, recommendations, routes, matching, tiers, route checks | `regchain-ai/supplyshield.mjs` |
| Monitoring decisions and the CTMS connection, in the audit trail | `regchain-ai/monitoring.mjs` |
| Live feeds (FCDO, GDACS) with a recorded copy | `regchain-ai/feeds.mjs`, `scripts/record-feeds.mjs` (`npm run record:feeds`), `demo-data/recorded-feeds.json` |
| Route and import-approval checks inside every shipment check; the `reroute` action | `regchain-ai/rules.mjs` |
| CTMS and courier MCP servers; scope and signal tools; facility status; approval terms | `regchain-ai/mcp-servers.mjs` |
| ClinRadar orchestrator instructions; the scripted recovery of a confirmed disruption | `regchain-ai/agent.mjs` |
| Page endpoints: `GET /api/supplyshield`, `POST /api/supplyshield/monitoring`, `/portfolio`, `/check` | `serve-regchain.cjs` |
| Public read API: `GET /v1/monitoring-scope`, `/v1/signals`, `/v1/signals/{id}`, `/v1/shipments/{id}/risk` | `regchain-ai/api.mjs`, `regchain-ai/openapi.mjs` |
| Supply network, CTMS statuses, routes, permits, courier and depot records, geography | `demo-data/supply-network.json` |
| Recorded external events (illustrative) | `demo-data/external-signals.json` |
| Tests | `npm run check:supplyshield` (scope, recommendations, tiers, verifier, roles, audit, no portfolio, live feeds); `npm run check:agent` |

## Limits and next steps

- **Partial official advice.** FCDO advice that covers only parts of a country is shown, but it is not matched to sites until the named areas are mapped.
- **Country-level hazard alerts.** GDACS alerts are matched by country, not yet by location.
- **More sources:** EU weather warnings (MeteoAlarm), EASA conflict-zone bulletins, airport and strike notices, sanctions lists, and customs portals.
- **Real company data:** courier, depot and IRT connections through the same MCP tools; import approvals and their terms for every country; Country Specifications from the real documents (only with the company's approval).
- **Proof of the problem:** before building further, ask 5 to 10 supply teams for 12 months of holds, relabels and missed deliveries, with root causes. The case for ClinRadar is strongest if most of those events trace back to an existing requirement or an external event that nobody matched to the shipment in time.
- **GxP:** ClinRadar starts as decision support. Once it blocks shipments or edits controlled documents, it needs validation, Part 11 signatures and the company's own procedures ([RegChain-AI-Validation.md](RegChain-AI-Validation.md)).
