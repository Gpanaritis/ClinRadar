# TrialReady · ClinRadar

ClinRadar (formerly RegChain AI) is a browser prototype for external risk and country regulatory intelligence in global clinical supply.

- **Monitoring scope** comes only from the company's authorised active-trial portfolio. Countries with an operationally active trial are monitored automatically. Other countries are recommended with their evidence (depots, suppliers, transit routes, hubs, borders, sea neighbours, current official advice) and stay off until a person turns them on.
- **Signals** matches external events and regulatory changes to the company's own shipments, facilities, routes and deadlines. Each match is an observed event, a potential exposure, a confirmed disruption or not affected after check.
- **Shipments** tests every planned shipment against its destination's Country Specification and against the events on its route. AI agents propose recovery options, fixed rules check them, and a named person approves.

The product brief, how each of its twelve rules is built, the demonstration and what is real or illustrative are in [ClinRadar.md](ClinRadar.md). The evidence behind it is in [ClinRadar-Research.md](ClinRadar-Research.md). The files and settings keep the RegChain name (`serve-regchain.cjs`, `regchain-ai/`, `REGCHAIN_*`).

## Run locally

On Windows, open **Start-ClinRadar.cmd** from the repository folder. If Node.js is available, it starts the local dashboard at **http://127.0.0.1:4173/** and opens your default browser. Keep the launcher window open while using that address. Press **Ctrl+C** to stop it. Without Node.js, the launcher opens the standalone dashboard file in your browser.

From a terminal on any system with Node.js, run `node serve-regchain.cjs` from the repository folder and open **http://127.0.0.1:4173/**. Use the same address and browser profile to keep saved review decisions and replay settings across sessions. File-mode browser storage varies by browser and is separate from localhost.

The prototype uses a real UK rule change, real official feeds (UK FCDO travel advice and GDACS disaster alerts), a fictional trial portfolio and supply network, illustrative events and rules (labelled so on screen) and simulated roles. The screens carry no demo labels; this README and the docs below say what is real and what is simulated. Served by RegChain, the server runs the checks on the configurable schedule, polls the feeds between them and alerts Clinical Supply, whether or not anyone has the page open (see [Alerts and the schedule](#alerts-and-the-schedule)). Opened as a file, the page replays the recorded checks while it is open.

The page carries a copy of the data in `demo-data/`, so the full portfolio and the Spain scenario also show when the file is opened directly. After changing anything in `demo-data/`, run `npm run embed:data` (and `npm run check:data` to confirm the copy is current). The local server always reads the files themselves.

## Server, database and API

Served by RegChain, the dashboard keeps nothing important in the browser:

- the server holds the cases, decisions, publications, Quality tasks, shipment actions and change decisions in a SQLite database (`.regchain-data/`, ignored by Git);
- every step is checked on the server against the session's role;
- every step is written to an append-only, hash-chained audit trail;
- events go through an outbox, including to a mock Quality system;
- the server runs the scheduled checks itself and sends the alerts to Clinical Supply by email or chat webhook.

A regulation pipeline snapshots the official sources, detects meaningful changes, resolves the evidence passages, records the AI extraction and assesses the portfolio with fixed rules. The `/v1` API follows section 9 of the specification. Its contract is at http://127.0.0.1:4173/v1/openapi.json, and its health at http://127.0.0.1:4173/v1/health.

`npm run check:server` tests the database, the workflow against the page's own code, the acceptance answer key, the pipeline and the API, without network or AI calls. `npm run check` runs every check. Details: [RegChain-AI-Data-And-API.md](RegChain-AI-Data-And-API.md).

## Monitoring scope and external risk

ClinRadar reads the CTMS snapshot in `demo-data/supply-network.json` with the company's status policy in `config/supplyshield.yaml`, from the ClinRadar starter pack. Of the 22 studies in the snapshot, 18 count. It monitors the 16 countries with an operationally active trial, and EU rules apply to the 10 of them in the EU. It excludes 5 registered countries without an active site. Portugal's contradictory status is shown for confirmation.

It recommends 50 more countries, each with its evidence:

- 6 with a supply link: Belgium, Switzerland, India, Singapore, the United Arab Emirates and Luxembourg.
- Austria, where a suspended study still has product at its site.
- 14 next to an active-trial country with current official advice.
- 29 on proximity only.

Each recommended country has two switches, both off until a person turns them on: **External risk** for Clinical Supply, **Regulatory and customs** for the Regulatory SME. A switch needs a reason, and every change goes into the audit trail. A recommendation can also be dismissed with a reason. In the prepared workspace, Belgium's external-risk switch is on, as a decision P. Laine recorded on 2 Nov 2026.

The orchestrator agent works under the starter pack's master instructions (`ClinRadar-Master-Prompt.md`). [ClinRadar.md](ClinRadar.md) lists how each of the pack's 30 acceptance tests is covered.

**Run the check** reads the official feeds live for the monitored countries: UK FCDO travel advice through the GOV.UK content API (Open Government Licence) and GDACS alerts. A country that doesn't answer keeps its last good record. `npm run record:feeds` refreshes the recorded copy (`demo-data/recorded-feeds.json`) that the demo uses without internet. Only metadata is kept: the alert status, the update time and the change note.

The public API has read-only routes for ClinRadar: `/v1/monitoring-scope`, `/v1/signals` (optionally `?tier=confirmed`), `/v1/signals/{id}` and `/v1/shipments/{id}/risk`. `npm run check:supplyshield` tests the scope, the recommendations, the tiers, the option verifier, the roles, the audit trail, the state with no portfolio connected and the live-feed rules, without network or AI calls.

## Alerts and the schedule

**The server watches on its own.** On the monitoring schedule (Settings › Monitoring schedule, Athens time, weekdays at 06:00 by default) the server reads the official regulatory sources again, reads the live feeds for every country monitored for external risk, matches every signal to the shipments and raises the alerts. Between checks it polls the feeds every 30 minutes and reads the regulatory sources again every 24 hours (`config/supplyshield.yaml`). A check missed while the server was down runs once when it starts. Nobody needs the page open. `REGCHAIN_SCHEDULER=off` stops all of it.

**Alerts reach Clinical Supply with the evidence.** Each new confirmed disruption, potential exposure, rule change that holds shipments, or import approval that no longer covers a shipment raises one alert. It names the event, the shipment and leg, the record that confirmed it (or what is missing and who must confirm it), the patients behind it as a count, the sources with their times, the next step and a link to the signal. Today the Brussels strike gives a CRITICAL alert for SHP-IL-01: 14 patients in Tel Aviv, stock until 27 Nov, 2 days without treatment if nothing is done. All the alerts of one check go out together, by email (`REGCHAIN_ALERT_EMAIL_TO` and `REGCHAIN_SMTP_*`) and to a Teams or Slack webhook (`REGCHAIN_ALERT_WEBHOOK_URL`). Failed deliveries are tried again, and everything is in the audit trail. Without a channel, alerts are shown in ClinRadar only. **Settings › Alerts** shows the channels, the latest alerts and each delivery, and sends a test alert. Settings: [Alerts and the schedule](RegChain-AI-Deployment.md#alerts-and-the-schedule).

`npm run check:alerts` tests the alerts, the email (through a stand-in mail server on this computer), the Teams, Slack and JSON webhooks, retries, a whole check with every official site unreachable, and the schedule, without network or AI calls.

## Running it for a team

By default RegChain serves one person on this computer, who picks a role with **Acting as**. For a team, set `REGCHAIN_AUTH=password`: named users sign in, each person holds one role, and the server checks that role on every request. Each sign-in, failure and sign-out is in the audit trail. The page, its data and every API route need a signed-in user.

- **Sign-in:** scrypt password hashes, lockout after repeated failures, sessions that end when idle and after 12 hours, and an HttpOnly, SameSite=Strict cookie.
- **Every response:** a Content Security Policy with a fresh script nonce per page, no framing, request IDs, JSON logs and a write rate limit.
- **Every request body:** checked against a schema before anything runs.
- **Operations:** a Docker image and Compose file, a CI workflow that runs every check, `npm run users` to manage people and `npm run backup` for a checked copy of the database.

`npm run check:security` starts the real server with named users and tests all of this. [RegChain-AI-Deployment.md](RegChain-AI-Deployment.md) covers settings, HTTPS, users, backups and upgrades. [RegChain-AI-Validation.md](RegChain-AI-Validation.md) outlines validation for GxP use and lists what a company still decides. [SECURITY.md](SECURITY.md) says how to report a vulnerability.

## Launch page and sign-in

The public launch page lives in `sites/clinradar/` (static HTML, CSS and a small script, no external resources) and is served at **/site/**. It says what ClinRadar prevents, how it works, the Belgian strike example and how it supports validation, and it has a contact form. **Sign in** and **Open ClinRadar** go to `/`, which shows the sign-in page in password mode. There is no self sign-up: accounts are set up by an administrator.

- **Start it on Windows:** open **Start-ClinRadar-Site.cmd**. It starts ClinRadar in password mode (`REGCHAIN_AUTH=password`) at http://127.0.0.1:4173 and opens http://127.0.0.1:4173/site/. Plain HTTP is fine on this computer; the session cookie gets the Secure flag only behind HTTPS (`REGCHAIN_PUBLIC_ORIGIN=https://…`). If another ClinRadar is already running on port 4173, stop it first.
- **Demo accounts:** the launcher runs `npm run demo:accounts` first. It creates one account per role, if missing: `p.laine` (P. Laine, Clinical Supply), `a.novak` (A. Novak, Regulatory SME), `m.okafor` (M. Okafor, Quality owner) and `l.chen` (L. Chen, Quality verifier). New passwords are printed once and kept in `.regchain-data/demo-accounts.txt` (ignored by Git). `npm run demo:accounts -- --reset` gives them new passwords. `npm run users` manages any other account.
- **Contact form:** it posts JSON to `POST /api/contact`, which is public like the page. The server accepts same-site JSON only, checks the fields (name, company, work email, message, consent), limits the size and allows `REGCHAIN_CONTACTS_PER_HOUR` (10) messages per client address per hour. Each message is one JSON line in `.regchain-data/contact-requests.jsonl` with an ID and the time; the client address is not stored and no email is sent.
- **Sign-in page:** links back to the launch page (**About ClinRadar**) and says that there is no self sign-up.

`npm run check:security` tests the launch page and the contact form before sign-in, along with everything else in password mode.

## AI step

The UK labeling case has a live AI check, at the top of its **Evidence & impact** tab. The local server fetches the official texts at run time: regulation 46 as in force on 27 April 2026 and from 28 April 2026 (legislation.gov.uk), Schedule 14 paragraph 6, and the MHRA guidance section on labelling transition (GOV.UK). Claude (`claude-opus-5-5`) drafts the change for `GB/IMP_LABELING`, and RegChain then checks the draft itself:

- every quote must appear word for word in the source it cites;
- the effective date must match the recorded rule (28 April 2026);
- the change status must agree with the text comparison.

If any check fails, Approve and Edit & approve are blocked for the Regulatory SME. When every check passes, the AI's draft becomes the proposal the SME reviews, as a new revision recorded in the audit trail. It never overwrites an SME's own edit or a case that is past review. The texts are never stored in the repository; the server keeps the last copy and the last result in `.regchain-cache/`, so a recorded check still shows without internet.

To turn it on:

1. Install Node.js 22.13 or later, which includes npm.
2. Create a file named `.env` next to `serve-regchain.cjs` containing `ANTHROPIC_API_KEY=` followed by your key. Git ignores this file.
3. Open **Start-ClinRadar.cmd**. The first time, it installs the Anthropic SDK with npm.

RegChain uses Claude models only. To reach them through AWS, Google Cloud or Microsoft Azure instead of Anthropic's API, set `REGCHAIN_AI_PROVIDER` as described in [Which Claude service](RegChain-AI-Deployment.md#which-claude-service).

`npm run check:ai` tests the source fetching and RegChain's checks without calling the API.

## First run and the agents at work

Open **http://127.0.0.1:4173/?empty** to start from an empty workspace (one-person mode only). Plans and approvals are archived, the cases start again, the CTMS is disconnected and every monitoring decision is cleared; nothing is deleted from the audit trail. The Overview says that ClinRadar cannot determine its monitoring scope and monitors nothing. The first check then works through these steps:

1. It connects the CTMS and derives the scope.
2. It shows the recommended countries, all off, and invites you to turn on external-risk monitoring for Belgium, where the central EU depot is.
3. It reads the official sources and feeds.
4. It sorts the signals into tiers and re-checks all 25 planned shipments.
5. It hands the shipments that need action to the agent team, and the page opens **Agents in action**.

**Agents in action**, in the menu, shows the team at work: the master agent ranks the shipments and hands tasks to the Supply, Logistics, Records and Communications agents; they read IRT, ERP, the depot and the eTMF over MCP; the RegChain verifier (fixed rules, no AI) tests every option. Replay any run step by step at 1× to 8×, filter the steps by agent, or pick one shipment. A live run streams in as it happens.

**Settings**, in the menu, holds the **Monitoring schedule** (how often and when the sources are checked, and whether the agents then prepare plans for blocked shipments) and the **AI connections** (the Claude service, each agent's model, the company systems over MCP, and requests for new connections that the Quality owner approves). Every change is kept in the audit trail; keys never pass through the page. See the [screen guide](RegChain-AI-Screen-Guide.md), section 12.

The Israel scenario ([RegChain-AI-Israel-Scenario.md](RegChain-AI-Israel-Scenario.md), illustrative) shows a booklet label that can no longer serve two countries: from 3 Jan 2027 Israel refuses the label shared with Greece and Cyprus, so the stock splits and the agents choose between Israel-only kits, relabelling and an earlier import.

## Agents

**Shipments › Needs action** lists every shipment that needs action, most urgent first. Each one opens a plan page where an orchestrator (Claude Opus 5.5, with ClinRadar's instructions) and four specialist agents (Claude Sonnet 5.5) work through the problem:

- They read IRT, ERP, the depot, the eTMF, the CTMS and the courier through eight MCP servers, which are read-only except for a draft inbox.
- They propose two or three options and check each one against ClinRadar's rules. For a confirmed disruption these can include leaving from another qualified airport (`reroute`) or a later dispatch.
- They draft the changes for people to approve, in IRT, ERP, the depot, the courier, the QMS or the site portal.

Only options that pass the fixed rules can be approved, only by Clinical Supply, and the server checks each one again before recording it. Each draft still needs approval in its own validated system. Approvals and withdrawals are stored in the database with the audit trail, and every version of every run is kept in `.regchain-cache/`.

**Plan all with AI agents**, on Shipments, runs the agents on every shipment that needs action, most urgent first: 19 today, 17 with a plan and 2 escalated. ClinRadar then checks the plans together so that no kit or relabelling slot is promised twice. Today SHP-06 moves to the 18 Nov slot because SHP-01 needs the 16 Nov one more urgently. SHP-IL-01, whose flight the Brussels strike cancelled, leaves from Amsterdam instead.

**Run the AI agents** needs the same `.env` key as the AI step. **Scripted walkthrough (no AI)** runs the same steps through the same MCP servers without calling Claude. To rehearse from a clean start, open **http://127.0.0.1:4173/?fresh** (clears decisions, keeps plans) or **?fresh=all** (also clears plans). Nothing is deleted: cleared approvals are kept in full in the audit trail, and runs are archived in `.regchain-cache/`. Starting fresh works only in the one-person mode. `npm run check:agent` tests the rules, the eight MCP servers, scripted runs, the portfolio allocation, server-side approvals and the live loop with a stand-in for Claude, without calling the API. The systems behind the MCP servers are fictional data in `demo-data/supply-operations.json` and `demo-data/supply-network.json`. Design and compliance notes: [RegChain-AI-Agents.md](RegChain-AI-Agents.md).

- [ClinRadar: the brief, how each rule is built, the demonstration, what is real](ClinRadar.md)
- [Research: clinical supply failures, business continuity, competitors, and whether the problem is real](ClinRadar-Research.md)
- [Database, pipeline and API: the server side, how it works and how it is tested](RegChain-AI-Data-And-API.md)
- [Deployment: settings, Docker, HTTPS, users, backups and upgrades](RegChain-AI-Deployment.md)
- [Validation outline: intended use, GAMP 5, Part 11 and Annex 11, and what a company still decides](RegChain-AI-Validation.md)
- [User journeys and demo scenarios: every path, who takes it, and the clicks for each demo](RegChain-AI-User-Journeys.md)
- [Israel scenario: one label that can no longer serve two countries (illustrative)](RegChain-AI-Israel-Scenario.md)
- [Agents: how they resolve blocked shipments within validated systems](RegChain-AI-Agents.md)
- [Product review, 15 Nov 2026: is the problem real, what was fixed, what is open](RegChain-AI-Product-Review.md)
- [Project plan: what is done and what is next](RegChain-AI-Project-Plan.md)
- [Demo scenario: one UK rule change, seven trials affected](RegChain-AI-Demo-Scenario.md)
- [Spain scenario: a fictional rule, flagged 107 days before it applies](RegChain-AI-Spain-Scenario.md)
- [Screen guide and gap review](RegChain-AI-Screen-Guide.md)
- [Dashboard mockup](RegChain-AI-Dashboard-Mockup.png)
- [Research notes](RegChain-AI-Dashboard-Research.md)
- [Master specification](RegChain-AI-Master-Specification.md)
