# TrialReady · RegChain AI

RegChain AI is a browser prototype for country regulatory and clinical supply intelligence. **Shipment checks** tests every planned shipment against its destination's Country Specification before it leaves the depot. Changes to the rules reach the specification through governed cases: open one from the regional overview to see evidence, study impact, regulatory review and Quality follow-up.

## Run locally

On Windows, open **Start-RegChain.cmd** from the repository folder. If Node.js is available, it starts the local dashboard at **http://127.0.0.1:4173/** and opens your default browser. Keep the launcher window open while using that address. Press **Ctrl+C** to stop it. Without Node.js, the launcher opens the standalone dashboard file in your browser.

From a terminal on any system with Node.js, run `node serve-regchain.cjs` from the repository folder and open **http://127.0.0.1:4173/**. Use the same address and browser profile to keep saved review decisions and replay settings across sessions. File-mode browser storage varies by browser and is separate from localhost.

The prototype uses a real UK rule change, a fictional trial portfolio, a fictional Spain scenario and simulated roles. The screens carry no demo labels; this README and the docs below say what is real and what is simulated. The configurable schedule re-runs recorded checks while the dashboard is open.

The page carries a copy of the data in `demo-data/`, so the full portfolio and the Spain scenario also show when the file is opened directly. After changing anything in `demo-data/`, run `npm run embed:data` (and `npm run check:data` to confirm the copy is current). The local server always reads the files themselves.

## Server, database and API

Served by RegChain, the dashboard keeps nothing important in the browser:

- the server holds the cases, decisions, publications, Quality tasks, shipment actions and change decisions in a SQLite database (`.regchain-data/`, ignored by Git);
- every step is checked on the server against the session's role;
- every step is written to an append-only, hash-chained audit trail;
- events go through an outbox, including to a mock Quality system.

A regulation pipeline snapshots the official sources, detects meaningful changes, resolves the evidence passages, records the AI extraction and assesses the portfolio with fixed rules. The `/v1` API follows section 9 of the specification. Its contract is at http://127.0.0.1:4173/v1/openapi.json, and its health at http://127.0.0.1:4173/v1/health.

`npm run check:server` tests the database, the workflow against the page's own code, the acceptance answer key, the pipeline and the API, without network or AI calls. `npm run check` runs every check. Details: [RegChain-AI-Data-And-API.md](RegChain-AI-Data-And-API.md).

## Running it for a team

By default RegChain serves one person on this computer, who picks a role with **Acting as**. For a team, set `REGCHAIN_AUTH=password`: named users sign in, each person holds one role, and the server checks that role on every request. Each sign-in, failure and sign-out is in the audit trail. The page, its data and every API route need a signed-in user.

- **Sign-in:** scrypt password hashes, lockout after repeated failures, sessions that end when idle and after 12 hours, and an HttpOnly, SameSite=Strict cookie.
- **Every response:** a Content Security Policy with a fresh script nonce per page, no framing, request IDs, JSON logs and a write rate limit.
- **Every request body:** checked against a schema before anything runs.
- **Operations:** a Docker image and Compose file, a CI workflow that runs every check, `npm run users` to manage people and `npm run backup` for a checked copy of the database.

`npm run check:security` starts the real server with named users and tests all of this. [RegChain-AI-Deployment.md](RegChain-AI-Deployment.md) covers settings, HTTPS, users, backups and upgrades. [RegChain-AI-Validation.md](RegChain-AI-Validation.md) outlines validation for GxP use and lists what a company still decides. [SECURITY.md](SECURITY.md) says how to report a vulnerability.

## AI step

The UK labeling case has a live AI check, at the top of its **Evidence & impact** tab. The local server fetches the official texts at run time: regulation 46 as in force on 27 April 2026 and from 28 April 2026 (legislation.gov.uk), Schedule 14 paragraph 6, and the MHRA guidance section on labelling transition (GOV.UK). Claude (`claude-opus-5-5`) drafts the change for `GB/IMP_LABELING`, and RegChain then checks the draft itself:

- every quote must appear word for word in the source it cites;
- the effective date must match the recorded rule (28 April 2026);
- the change status must agree with the text comparison.

If any check fails, Approve and Edit & approve are blocked for the Regulatory SME. When every check passes, the AI's draft becomes the proposal the SME reviews, as a new revision recorded in the audit trail. It never overwrites an SME's own edit or a case that is past review. The texts are never stored in the repository; the server keeps the last copy and the last result in `.regchain-cache/`, so a recorded check still shows without internet.

To turn it on:

1. Install Node.js 22.13 or later, which includes npm.
2. Create a file named `.env` next to `serve-regchain.cjs` containing `ANTHROPIC_API_KEY=` followed by your key. Git ignores this file.
3. Open **Start-RegChain.cmd**. The first time, it installs the Anthropic SDK with npm.

RegChain uses Claude models only. To reach them through AWS, Google Cloud or Microsoft Azure instead of Anthropic's API, set `REGCHAIN_AI_PROVIDER` as described in [Which Claude service](RegChain-AI-Deployment.md#which-claude-service).

`npm run check:ai` tests the source fetching and RegChain's checks without calling the API.

## First run and the agents at work

Open **http://127.0.0.1:4173/?empty** to start from an empty workspace (one-person mode only): plans and approvals are archived and the cases start again. The Overview then shows what RegChain is connected to and one button, **Run the first check**. It reads the official sources and finds three changes (UK labelling, a Spanish notice, an Israeli label rule), assesses what each one means, re-checks all 25 planned shipments and hands the 18 that need action to the agent team. The page then opens **Agents in action**.

**Agents in action**, in the menu, shows the team at work: the master agent ranks the shipments and hands tasks to the Supply, Logistics, Records and Communications agents; they read IRT, ERP, the depot and the eTMF over MCP; the RegChain verifier (fixed rules, no AI) tests every option. Replay any run step by step at 1× to 8×, filter the steps by agent, or pick one shipment. A live run streams in as it happens.

**Settings**, in the menu, holds the **Monitoring schedule** (how often and when the sources are checked, and whether the agents then prepare plans for blocked shipments) and the **AI connections** (the Claude service, each agent's model, the company systems over MCP, and requests for new connections that the Quality owner approves). Every change is kept in the audit trail; keys never pass through the page. See the [screen guide](RegChain-AI-Screen-Guide.md), section 12.

The Israel scenario ([RegChain-AI-Israel-Scenario.md](RegChain-AI-Israel-Scenario.md), illustrative) shows a booklet label that can no longer serve two countries: from 3 Jan 2027 Israel refuses the label shared with Greece and Cyprus, so the stock splits and the agents choose between Israel-only kits, relabelling and an earlier import.

## Agents

**Agent plans**, in the menu, lists every shipment that needs action, most urgent first. Each one opens a plan page where an orchestrator (Claude Opus 5.5) and four specialist agents (Claude Sonnet 5.5) work through the problem:

- They read IRT, ERP, the depot and the eTMF through six MCP servers, which are read-only except for a draft inbox.
- They propose two or three options and check each one against RegChain's rules.
- They draft the changes for people to approve.

Only options that pass the fixed rules can be approved, only by Clinical Supply, and the server checks each one again before recording it. Each draft still needs approval in its own validated system. Approvals and withdrawals are stored in the database with the audit trail, and every version of every run is kept in `.regchain-cache/`.

**Plan all with AI agents**, on Agent plans, runs the agents on every shipment that needs action, most urgent first. RegChain then checks the plans together so no kits or relabelling slot is promised twice: today SHP-06 moves to the 18 Nov slot because SHP-01 needs the 16 Nov one more urgently.

**Run the AI agents** needs the same `.env` key as the AI step. **Scripted walkthrough (no AI)** runs the same steps through the same MCP servers without calling Claude. To rehearse from a clean start, open **http://127.0.0.1:4173/?fresh** (clears decisions, keeps plans) or **?fresh=all** (also clears plans). Nothing is deleted: cleared approvals are kept in full in the audit trail, and runs are archived in `.regchain-cache/`. Starting fresh works only in the one-person mode. `npm run check:agent` tests the rules, the six MCP servers, scripted runs, the portfolio allocation, server-side approvals and the live loop with a stand-in for Claude, without calling the API. The systems behind the MCP servers are fictional data in `demo-data/supply-operations.json`. Design and compliance notes: [RegChain-AI-Agents.md](RegChain-AI-Agents.md).

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
