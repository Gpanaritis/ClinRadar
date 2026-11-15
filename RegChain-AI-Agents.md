# ClinRadar · Agents that resolve blocked and disrupted shipments

*15 November 2026. Design note for the hackathon team: what the agent layer does, how it is built, and how it fits validated clinical systems. ClinRadar was called RegChain AI; see [ClinRadar.md](ClinRadar.md).*

## What it does

The Shipments page finds the problem: 14 of 25 planned shipments are blocked and 5 need a confirmation. One of the blocked shipments, SHP-IL-01, is blocked by an external event: the courier cancelled its flight from Brussels on the Belgian strike day. The agent layer works on the next question, **what do we do about it?**

Fixing a blocked shipment today means asking several teams. Supply checks for another batch, the depot looks for a relabelling slot, Regulatory finds the authorisation letter in the eTMF, and someone writes to the site. Each answer sits in a different validated system. When several shipments are blocked at once, the same kits or the same relabelling slot can easily be promised twice.

**Shipments › Needs action** is the work queue: every shipment that needs action, most urgent first. Opening one shows its plan page, where a team of AI agents works on that shipment:

- An **orchestrator**, instructed as ClinRadar, reads the failed checks, the external signals on the shipment's route, the monitoring scope, the destination's Country Specification and what other plans already hold, and decides what it needs to know. It keeps an observed event, a potential exposure and a confirmed disruption apart, and never treats one as another without evidence.
- It **delegates** to specialists. Each one can use only the tools of its own systems:
  - the **supply agent** works with IRT and ERP: stock, batches and QP plans;
  - the **logistics agent** works with the depot, the courier, ERP and IRT: the route and the day of each leg, the courier's and the depot's status, qualified alternative departures, relabelling, label approvals, site stock;
  - the **records agent** works with the eTMF: authorisations, import approvals and their terms (port of entry, kits, consignee, validity), site contacts;
  - the **communications agent** writes messages to sites in English and the local language.
- It can also ask the **watch team**: four agents, each sweeping every monitored country for one kind of hazard, read-only and limited to that kind:
  - **Weather & natural hazards** (`weather`): GDACS alerts (floods, cyclones, earthquakes, wildfires, volcanic ash) and official weather warnings on our lanes and facilities;
  - **Strikes & transport** (`transport`): labour action, airport, port and road notices, carrier and depot operations, courier tracking outages;
  - **Security & travel advice** (`security`): UK FCDO travel advice, conflict, unrest, border closures;
  - **Regulatory & customs** (`regulatory`): the regulatory changes waiting for the Regulatory SME, import permits and approvals.

  When a route check fails because of an external event, the orchestrator first asks the watch agent for that hazard to confirm the event, its evidence level and how long it lasts; only then does the logistics agent look for alternatives. For SHP-IL-01 the transport watch agent confirms a one-day strike on 24 Nov, reported by two trusted sources, with the courier's cancellation of the BRU → TLV flight on record and SHP-03 checked and not affected; logistics then finds the Amsterdam departure.
- The orchestrator builds two or three options and **checks each one** with RegChain's rule engine before recommending it.
- It **drafts** the changes for the recommended option, for example a shipment change request in IRT or a relabelling work order for the depot. Each draft names the option it belongs to.
- **RegChain's verifier**, which uses fixed rules and no AI, checks every option again. A draft for an option that fails is withdrawn. Only passing options can be approved.
- A **named person in Clinical Supply** approves the plan in RegChain. The server checks it once more before recording it. Each draft still has to be approved in its own validated system.

**Plan all with AI agents**, on Shipments, does this for every shipment that needs action, as one orchestrated run:

1. **Watch sweep.** The orchestrator sends the four watch agents across the monitored countries, one kind of hazard each. Each reports one business finding, for example "Strikes & transport: 4 events in 17 monitored countries; 1 confirmed disruption — SHP-IL-01's flight BRU → TLV on 24 Nov cancelled (courier); SHP-03 checked, not affected." The weather agent finds the (illustrative) winter storm watch over the US depot in Allentown on 16–17 Nov, with no collection planned there, and names what is not watched: the APAC depot in Singapore, the manufacturer in Switzerland and the supplier in India. The run record keeps the four findings (`watch`).
2. **Triage.** Patients first: a shipment with a confirmed disruption that would leave patients without treatment goes to the front ("SHP-IL-01 runs out on 27 Nov, 14 patients"). The rest follow by preparation date, the most urgent first, and the potential exposures the watch team found are listed for confirmation.
3. **One agent team per shipment.** Each shipment gets its own run, as above.
4. **Checking the plans together.** RegChain walks the plans in priority order and counts what each one holds: kits of a batch, places in a relabelling slot. If a less urgent plan loses its kits or slot to a more urgent one, RegChain moves it to its next passing option or another slot, withdraws its old drafts and drafts the new plan. If nothing passes, it escalates.
5. **One board** shows every plan, why it was re-planned and its approval, in priority order.

Every step appears live on screen, and every run can be exported as an audit record.

## Examples from the data

| Shipment | Why it needs action | What the agents find | Result |
|---|---|---|---|
| SHP-04 (UK) | Legacy label after the 28 Apr 2026 cutoff; the trial's authorisation route is "unknown" in IRT | The eTMF holds the MHRA letter (old rules). The UK depot has 48 kits of J-203 with the updated label. Preparation starts today, so relabelling on 16 Nov is too late unless the dispatch moves. | Swap to J-203 and correct the route in IRT. "Relabel and dispatch on 23 Nov" also passes. Delaying alone fails, because the label problem stays. |
| SHP-01 (UK) | Legacy label, and the dispatch falls on a Sunday | No other batch has enough kits. The 16 Nov relabelling slot finishes before preparation if the dispatch moves to Monday. | Relabel on 16 Nov and dispatch on Monday 23 Nov. |
| SHP-06 (UK) | Legacy label | On its own, the agents pick the 16 Nov slot. In the portfolio run, SHP-01 is more urgent and needs 10 of that slot's 20 places, and SHP-06 needs 14. | RegChain moves SHP-06 to the 18 Nov slot and withdraws the first drafts. |
| SHP-ES-10 (Spain) | Batch XZ417-26C has no QP release planned; site ES-08 has no pharmacy code | There is a QP slot on 2 Mar 2027, with kits at the depot two business days later. The eTMF has the site contact. The communications agent drafts the request in Spanish and English. | Book the QP release and ask for the code: drafts for ERP and the site portal. The shipment moves from Blocked to Confirm, because a booked release is not yet a signed one. |
| SHP-07 (UK) | Nothing blocks it; the post-cutoff label needs confirming against the approved specification | The ERP shows the updated label is approved. | Proceed, with a pre-dispatch confirmation draft for the depot. |
| SHP-03 (Germany) | No German label specification for the batch | The specification takes 15 business days and the site has 7 days of stock. | Nothing passes, so the agents escalate to Quality instead of guessing. |
| SHP-IL-01 (Israel) | Confirmed disruption: the courier cancelled the Brussels to Tel Aviv flight on 24 Nov 2026, the Belgian strike day (illustrative scenario) | The courier's booking system holds the cancellation (14 Nov, 08:10 UTC). The depot does not collect on 24 Nov. The courier flies the same lane from Amsterdam, Frankfurt and Luxembourg. The import approval names Tel Aviv (TLV) as the port of entry, which a European departure does not change. The Tel Aviv site has 13 days of stock, until 27 Nov: if nobody acts, the next free flight delivers on 29 Nov and 14 patients go 2 days without treatment. | Leave from Amsterdam: same dispatch day, same delivery date. Drafts go to the courier (booking change) and the depot (collection instruction). Luxembourg fails until someone turns on monitoring for Luxembourg. A 25 Nov dispatch fails: the kits would arrive on 30 Nov, after the stock runs out. The communications agent alerts the Clinical Supply lead. |

In the portfolio run on today's data, 19 shipments get 17 plans that pass, 2 escalations (SHP-03, SHP-05) and 2 re-plans (SHP-06, and SHP-IL-03 because SHP-IL-02 takes the Israel-only kits). Nothing changes in any validated system.

## Watching the team: Agents in action

The **Agents in action** page shows who does what. The master agent (the orchestrator, Claude Opus 5.5) sits on top and hands tasks to four specialists (Claude Sonnet 5.5). Under them are the systems they reach over MCP, and next to them the ClinRadar verifier, which is fixed code, not AI. Each step draws a line from the one who acts to the one it reaches: a task handed out, a system read, an answer, a report back, an option tested, a draft put in the inbox. The master agent's card shows how the work was split between the specialists.

The page replays the last run, with each shipment's own run placed where the master agent handed it out, or follows a run live. It replays at 1× to 8×, steps one at a time, filters the steps by agent, and opens a single shipment's run. After the first check it replays the scripted run automatically, because a scripted run finishes in seconds.

## How it is built

```mermaid
flowchart LR
  P[Shipment panel or<br/>Resolve all] --> O[Orchestrator<br/>claude-opus-5-5]
  O -->|delegate| S[Supply agent]
  O -->|delegate| L[Logistics agent]
  O -->|delegate| R[Records agent]
  O -->|delegate| C[Communications agent]
  S & L & R & C -.->|claude-sonnet-5-5| M
  O --> M[(MCP servers)]
  M --- IRT & ERP & Depot & eTMF & CTMS & Courier & Specs[ClinRadar rules,<br/>scope and signals] & Drafts[Draft inbox]
  O --> V[ClinRadar verifier<br/>fixed rules, no AI,<br/>counts what plans hold]
  V --> H[Clinical Supply approves<br/>server re-checks]
  H --> D[Each draft approved in its own system]
```

- **Eight MCP servers** (`regchain-ai/mcp-servers.mjs`), one per system. Each runs as its own process and is reached through the Model Context Protocol SDK. None of them receives the API key.
  - **ClinRadar**: shipment checks (including the route and import-approval checks), Country Specifications, option checks, commitments (what approved plans already hold), the monitoring scope and the external signals.
  - **IRT**: shipments, depot stock, site stock.
  - **ERP**: batches, label approvals, QP plans.
  - **Depot**: relabelling capacity, couriers, the facility's own status by day.
  - **eTMF**: trial authorisations, import approvals with their terms, site contacts.
  - **CTMS**: the active studies and, per country, whether the company supplies it.
  - **Courier**: a shipment's route with the day of each leg, the booking and tracking status, qualified alternative departures and whether their countries are monitored.
  - **Draft inbox**: create a draft for a named option, in IRT, ERP, the depot, the courier, the QMS, the eTMF or the site portal.

  A specification section with a change waiting for approval says so, so an agent never treats the old text as the whole rule.
- **The agent loop** (`regchain-ai/agent.mjs`). Claude's tool use, with the orchestrator delegating through a `delegate_to_agent` tool. Each specialist runs its own loop with only its own tools, and returns a written report. A run is capped at 16 orchestrator turns, 8 per specialist and 60 tool calls. The portfolio run (`resolvePortfolio`) runs the watch sweep first (`runWatchSweep`), then up to three shipments at a time in live mode.
- **The watch team.** Agent ids `weather`, `transport`, `security`, `regulatory`. Their tools are `specs.get_watch_brief` (sources, monitored countries and regions, coverage gaps, and for regulatory the changes and import approvals with the shipments each affects) and `specs.get_risk_signals` (or `specs.get_country_specification` for regulatory). `get_risk_signals` takes optional `hazard` and `region` filters; the loop pins a watch agent's reads to its own hazard whatever it asks for. Watch agents cannot delegate or draft. Every signal carries a `hazard` field (weather, transport, security or regulatory), set by fixed rules in `supplyshield.mjs` from its category and source. Their instructions: keep observed, potential and confirmed apart, name missing evidence and its owner, never invent facts, never treat a single unverified source as confirmed, no probabilities.
- **Models.** The orchestrator runs on Claude Opus 5.5 (`REGCHAIN_MODEL_ORCHESTRATOR`), the specialists on Claude Sonnet 5.5 (`REGCHAIN_MODEL_SPECIALIST`), and the watch team on Claude Haiku 5.5 (`claude-haiku-5-5`, `REGCHAIN_MODEL_WATCH`), because sweeping every monitored country is cheap, high-volume scanning. Watch agents run without extended thinking. Only Claude models are accepted for any of the three.
- **The rule engine** (`regchain-ai/rules.mjs`). The same checks as the Shipment checks page, plus the option check. The option check tests:
  - whether an option is possible: stock, label approval, slot dates and capacity, site stock against a delay, the eTMF record, QP lead time;
  - whether it is done in time: kits relabelled, label specifications ready and QP-released kits at the depot before preparation starts, not only before dispatch;
  - whether the shipment passes afterwards.

  Malformed dates make an option fail; they never stop the run.
- **Approvals** (`regchain-ai/approvals.mjs`). The server re-checks an option against the rules and the kits and slots other approved plans hold, refuses a stale or failing one, drafts the changes when someone picks an option other than the recommendation, and logs every approval and withdrawal.
- **The server** streams each step to the page (`/api/agent/run`, `/api/agent/portfolio-run`), keeps every version of every run, and refuses a second run while one is in progress.
- **Scripted walkthrough.** The same steps through the same MCP servers, with the decisions written in code instead of made by Claude. It works without an API key and serves as the baseline for tests.

## Compliance design

Clinical supply runs on validated systems: IRT, ERP, the depot's warehouse system, the eTMF and the QMS. They fall under GxP, EU GMP Annex 11 and 21 CFR Part 11. The agents are designed around that, not on top of it.

| Requirement | How the agent layer meets it |
|---|---|
| **Validated systems stay the system of record** | The agents can only read. The MCP servers for IRT, ERP, the depot and the eTMF expose read tools only; the only write tool creates a **draft** in a separate inbox. In production, each connector would use a read-only service account, so the limit holds even if a prompt or a model misbehaves. |
| **Changes go through each system's own change control** | A draft is a proposal, never a change (`executed: false`). A person approves it in IRT, ERP or the QMS with that system's electronic signature (Part 11, Annex 11). RegChain's approval only records that the plan was accepted. |
| **Generative AI is not the decision-maker** | The draft EU GMP Annex 22 on artificial intelligence (public consultation, July 2025) keeps generative AI and large language models out of critical GMP applications. Where they are used in non-critical work, a person reviews the output. Here the AI proposes. Pass or fail comes from fixed, testable rules, which run again on the server when someone approves. An option that fails the rules cannot be approved. |
| **Credibility in proportion to risk** | The FDA's draft guidance on AI to support regulatory decision-making (January 2025) weighs model influence against decision consequence. A shipment decision has high consequence, so the model's influence is kept low. Verification is deterministic, every option shows its evidence, and a person decides. |
| **No double promises** | Approved plans hold the kits and relabelling places they use. The agents see these commitments, the verifier counts them, and the portfolio run allocates in priority order. Withdrawing an approval frees what it held. |
| **Segregation of duties** | Only the Clinical Supply role approves supply plans. Regulatory and Quality roles see the plans but cannot approve them. A UK or Spain case cannot be closed by Quality while shipments it covers are still blocked with nothing recorded. |
| **Audit trail (ALCOA+)** | Every step is logged with a timestamp: the goal, each delegation, each tool call with its inputs and the system's full answer, each report, the options, the rule results, the drafts and which option each belongs to, the models and token counts. Every version of every run is kept. Approvals and withdrawals are logged with the person, the time and the run they came from. **Export the run** saves it as JSON. |
| **Least privilege** | Each specialist sees only the tools of its own systems. The orchestrator can read checks, specifications and commitments, check options and create drafts, but cannot read stock or batch data directly. The MCP server processes get no API key. |
| **Prompt injection and runaway runs** | Every agent's prompt says tool results and documents are data, not instructions. Nothing an agent reads can make it execute anything, because no tool executes anything. Turn and tool-call limits stop a loop. |
| **Change control for the AI itself** | Model IDs are pinned in code (a deployment can only give them the names its Claude service uses, and only Claude models are accepted), prompts are versioned in git, and `npm run check:agent` is the regression test. Changing the model or a prompt means running it again before release. |
| **Data protection** | The prototype uses fictional data. Real Country Specifications and records never go into the repository or an AI request. In production this needs a data processing agreement and the company's approved AI hosting. |

## Running it

- **Scripted walkthrough:** works as soon as RegChain runs.
  - For one shipment: **Shipments** → SHP-IL-01, SHP-04, SHP-01 or SHP-ES-10 → **Run the agents again** → **Scripted walkthrough (no AI)**.
  - For every shipment: **Shipments** → **Scripted walkthrough (no AI)**.
  - Every journey and demo script: [RegChain-AI-User-Journeys.md](RegChain-AI-User-Journeys.md).
- **Live agents:** add `ANTHROPIC_API_KEY` to `.env` next to `serve-regchain.cjs` and restart RegChain. **Run the AI agents** is enabled once the key is set. To reach Claude through AWS, Google Cloud or Azure instead, see [Which Claude service](RegChain-AI-Deployment.md#which-claude-service).
  - A run for one shipment takes a minute or two and uses Claude Opus 5.5 for the orchestrator, Claude Sonnet 5.5 for the specialists and Claude Haiku 5.5 for any watch agent it consults.
  - A live portfolio run of 19 shipments takes several minutes and costs more. Run it once before the demo; the page loads the last run.
- **Tests:** `npm run check:agent` makes no API call and uses a temporary cache, so approvals on the computer never change the results. It checks:
  - the rules match the page (14 blocked, 5 to confirm, 6 ready), and the Israel rules: the shared booklet refused from 3 Jan 2027, Israeli working days, three ways out, and the Brussels strike blocking SHP-IL-01;
  - the verifier rejects partial, impossible, too-late and malformed options;
  - commitments: kits and slots held by another plan are not offered again;
  - all eight MCP servers start, and only the draft inbox can write;
  - eight scripted runs end as expected (swap, relabel with a Monday dispatch, fix the data, escalate, proceed with a confirmation, leave from Amsterdam);
  - the watch team: four agents on Claude Haiku 5.5 with read-only ClinRadar tools; the `hazard` and `region` filters; the SHP-IL-01 run consults the transport watch agent before logistics;
  - the portfolio run: the four watch agents report before triage; 19 shipments, patients first (SHP-IL-01), then by preparation date; SHP-06 and SHP-IL-03 re-planned, nothing promised twice;
  - approvals: re-checked on the server, refused when stale or failing, withdrawals free their holds, and every step is logged;
  - the live loop end to end with a stand-in for Claude, including a withdrawn draft for an option that fails, and a live watch sweep whose reads stay pinned to each agent's hazard.
- `npm run check:supplyshield` checks the monitoring scope, the recommendations, the signal tiers and hazards, the watch summary, the route and option checks (Amsterdam passes, Luxembourg needs a monitoring decision, the depot does not collect on the strike day, an unmonitored Belgium makes SHP-IL-01 Confirm rather than Ready), the monitoring roles and the audit trail, and the state with no portfolio connected.

## Real and illustrative

- **Real:** the MCP protocol and servers, the agent loop with Claude's tool use, the rule engine, the portfolio allocation, the streaming, the approval and the audit record, and the official feeds ClinRadar reads (UK FCDO travel advice, GDACS).
- **Illustrative:** the systems behind the MCP servers are fictional data files (`demo-data/supply-operations.json`, `demo-data/supply-network.json`), not IRT, ERP, a depot, an eTMF, a CTMS or a courier. The Belgian strike and the Ben Gurion runway works are invented for the scenario and labelled so on screen.

## Before it could be used for real

1. **Connectors** to the real systems' APIs with read-only service accounts, owned and validated by each system's team.
2. **Draft delivery** into each system's own change workflow (for example an IRT change request, a QMS record), instead of RegChain's inbox.
3. **Holds in the systems themselves.** RegChain counts what approved plans hold; in production the depot and IRT would reserve the kits and slots once their drafts are approved.
4. **A validation package for the agent layer**:
   - intended use: decision support, non-critical, human in the loop;
   - risk assessment;
   - test sets with expected outcomes, of which `check:agent` is the start;
   - a periodic review of runs where people rejected the recommendation.
5. **Roles and sign-in**, so approvals come from authenticated users rather than a role picker.
6. **One live run recorded** for the venue, in case the internet fails.
