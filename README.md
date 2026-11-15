# TrialReady · RegChain AI

RegChain AI is a browser prototype for country regulatory and clinical supply intelligence. **Shipment checks** tests every planned shipment against its destination's Country Specification before it leaves the depot. Changes to the rules reach the specification through governed cases: open one from the regional overview to see evidence, study impact, regulatory review and Quality follow-up.

## Run locally

On Windows, open **Start-RegChain.cmd** from the repository folder. If Node.js is available, it starts the local dashboard at **http://127.0.0.1:4173/** and opens your default browser. Keep the launcher window open while using that address. Press **Ctrl+C** to stop it. Without Node.js, the launcher opens the standalone dashboard file in your browser.

From a terminal on any system with Node.js, run `node serve-regchain.cjs` from the repository folder and open **http://127.0.0.1:4173/**. Use the same address and browser profile to keep saved review decisions and replay settings across sessions. File-mode browser storage varies by browser and is separate from localhost.

The prototype uses a real UK rule change, a fictional trial portfolio, a fictional Spain scenario and simulated roles. The screens carry no demo labels; this README and the docs below say what is real and what is simulated. The configurable schedule re-runs recorded checks while the dashboard is open.

The page carries a copy of the data in `demo-data/`, so the full portfolio and the Spain scenario also show when the file is opened directly. After changing anything in `demo-data/`, run `npm run embed:data` (and `npm run check:data` to confirm the copy is current). The local server always reads the files themselves.

## AI step

The UK labeling case has a live AI check, at the top of its **Evidence & impact** tab. The local server fetches the official texts at run time: regulation 46 as in force on 27 April 2026 and from 28 April 2026 (legislation.gov.uk), Schedule 14 paragraph 6, and the MHRA guidance section on labelling transition (GOV.UK). Claude (`claude-opus-5-5`) drafts the change for `GB/IMP_LABELING`, and RegChain then checks the draft itself:

- every quote must appear word for word in the source it cites;
- the effective date must match the recorded rule (28 April 2026);
- the change status must agree with the text comparison.

If any check fails, Approve and Edit & approve are blocked for the Regulatory SME. When every check passes, the AI's draft becomes the proposal the SME reviews, as a new revision recorded in the audit trail. It never overwrites an SME's own edit or a case that is past review. The texts are never stored in the repository; the server keeps the last copy and the last result in `.regchain-cache/`, so a recorded check still shows without internet.

To turn it on:

1. Install Node.js 20.12 or later, which includes npm.
2. Create a file named `.env` next to `serve-regchain.cjs` containing `ANTHROPIC_API_KEY=` followed by your key. Git ignores this file.
3. Open **Start-RegChain.cmd**. The first time, it installs the Anthropic SDK with npm.

`npm run check:ai` tests the source fetching and RegChain's checks without calling the API.

## Agents

A blocked shipment's panel has **Resolve with agents**. It opens a page where an orchestrator (Claude Opus 5.5) and four specialist agents (Claude Sonnet 5.5) work through the problem:

- They read IRT, ERP, the depot and the eTMF through six MCP servers, which are read-only except for a draft inbox.
- They propose two or three options and check each one against RegChain's rules.
- They draft the changes for people to approve.

Only options that pass the fixed rules can be approved, only by Clinical Supply, and the server checks each one again before recording it. Each draft still needs approval in its own validated system. Every step, approval and withdrawal is logged, and every version of every run is kept in `.regchain-cache/`.

**Resolve all with agents**, on Shipment checks, runs the agents on every shipment that needs action, most urgent first. RegChain then checks the plans together so no kits or relabelling slot is promised twice: today SHP-06 moves to the 18 Nov slot because SHP-01 needs the 16 Nov one more urgently.

**Run the AI agents** needs the same `.env` key as the AI step. **Scripted walkthrough (no AI)** runs the same steps through the same MCP servers without calling Claude. `npm run check:agent` tests the rules, the six MCP servers, scripted runs, the portfolio allocation, server-side approvals and the live loop with a stand-in for Claude, without calling the API. The systems behind the MCP servers are fictional data in `demo-data/supply-operations.json`. Design and compliance notes: [RegChain-AI-Agents.md](RegChain-AI-Agents.md).

- [Agents: how they resolve blocked shipments within validated systems](RegChain-AI-Agents.md)
- [Product review, 15 Nov 2026: is the problem real, what was fixed, what is open](RegChain-AI-Product-Review.md)
- [Project plan: what is done and what is next](RegChain-AI-Project-Plan.md)
- [Demo scenario: one UK rule change, seven trials affected](RegChain-AI-Demo-Scenario.md)
- [Spain scenario: a fictional rule, flagged 107 days before it applies](RegChain-AI-Spain-Scenario.md)
- [Screen guide and gap review](RegChain-AI-Screen-Guide.md)
- [Dashboard mockup](RegChain-AI-Dashboard-Mockup.png)
- [Research notes](RegChain-AI-Dashboard-Research.md)
- [Master specification](RegChain-AI-Master-Specification.md)
